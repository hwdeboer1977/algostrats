require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

// Backend keeper to listen to deposit and withdraw events
// Other changes (different ratio, other recipient wallets) are not needed
// When admin changes these, the deposit, withdraw, rebalance functions do this on-chain

// Read from .env file
const RPC_URL = process.env.RPC_URL || "ws://127.0.0.1:8545";
const CONFIRMATIONS = Number(process.env.CONFIRMATIONS || 1);
const VAULT_ADDRESS = process.env.VAULT_ADDRESS;
const KEEPER_PRIVATE_KEY = process.env.OWNER_HARDHAT_PRIVATE_KEY;
const REBALANCE_DEBOUNCE_MS = Number(
  process.env.REBALANCE_DEBOUNCE_MS || 30000
);

// --- Drift monitor config ---
const DRIFT_POLL_MS = 10_000; // every 10s
let lastDriftUsd = 0;

// Check info from .env file
if (!VAULT_ADDRESS) {
  throw new Error("Missing VAULT_ADDRESS in .env");
}
if (!KEEPER_PRIVATE_KEY) throw new Error("Missing KEEPER_PRIVATE_KEY in .env");

// Load Vault ABI
const vaultAbiFile = path.join(__dirname, "./abi/Vault.json");
if (!fs.existsSync(vaultAbiFile)) {
  throw new Error("Missing ABI at backend/keeper/abi/Vault.json");
}
const vaultAbi = JSON.parse(fs.readFileSync(vaultAbiFile, "utf8")).abi;

// Minimal ERC20 ABI
const erc20Abi = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
];

// Set up provider
const provider = RPC_URL.startsWith("ws")
  ? new ethers.WebSocketProvider(RPC_URL)
  : new ethers.JsonRpcProvider(RPC_URL);

// Set up wallet
const wallet = new ethers.Wallet(KEEPER_PRIVATE_KEY, provider);
const vault = new ethers.Contract(VAULT_ADDRESS, vaultAbi, provider);
const vaultWithSigner = vault.connect(wallet);

// Simple debounce mechanism to avoid reacting too many times in a row when multiple events arrive close together.
let rebalanceTimer = null; // If null, there is no scheduled rebalance check yet.
function scheduleRebalanceCheck(reason = "deposit") {
  // If there’s already a pending timer, cancel it. This means we restart the clock whenever a new deposit event comes in.
  if (rebalanceTimer) clearTimeout(rebalanceTimer);

  // Start a fresh timer. After REBALANCE_DEBOUNCE_MS milliseconds (e.g. 30 seconds), it will:
  rebalanceTimer = setTimeout(() => {
    rebalanceTimer = null;
    checkAndMaybeRebalance().catch((e) =>
      console.error("checkAndMaybeRebalance error:", e)
    );
  }, REBALANCE_DEBOUNCE_MS);
  console.log(
    `⏲Scheduled rebalance check in ${REBALANCE_DEBOUNCE_MS}ms (reason: ${reason})`
  );
}

// Function to wait for confirmation (finalized tx)
async function waitFinal(txHash, label) {
  try {
    await provider.waitForTransaction(txHash, CONFIRMATIONS);
    console.log(`[finalized] ${label} @ ${txHash}`);
  } catch (e) {
    console.error(`waitForTransaction failed for ${label}:`, e.message);
  }
}

// Core logic: read on-chain balance + threshold; preflight; submit tx if OK
async function checkAndMaybeRebalance() {
  console.log("Checking balances & threshold…");

  // 1) Get the underlying asset from the ERC-4626 vault
  let assetAddr;
  try {
    assetAddr = await vault.asset(); // standard ERC-4626
  } catch {
    // fallback: if your Vault exposes a public variable like 'asset()' under another name, you can hardcode env WBTC_ADDRESS
    assetAddr = process.env.WBTC_ADDRESS;
  }
  if (!assetAddr)
    throw new Error(
      "Cannot resolve underlying asset address (vault.asset() or WBTC_ADDRESS)."
    );

  const asset = new ethers.Contract(assetAddr, erc20Abi, provider);

  // 2) Read on-chain balance held by the vault & the on-chain threshold
  const [dec, balance, minChunk] = await Promise.all([
    asset.decimals().catch(() => 8),
    asset.balanceOf(VAULT_ADDRESS),
    vault.rebalanceMin().catch(() => 0n), // public variable getter
  ]);

  console.log(`   - Vault WBTC balance: ${balance}`);
  console.log(`   - rebalanceMin:       ${minChunk}`);

  // 3) If below threshold, skip
  if (minChunk > 0n && balance < minChunk) {
    console.log("Below rebalanceMin; skipping.");
    return;
  }

  // Pick how much to move — here we send the full buffer
  const amount = balance;

  // 4) Preflight: static call to ensure it won't revert
  try {
    if (vaultWithSigner.rebalance?.staticCall) {
      await vaultWithSigner.rebalance.staticCall(amount);
    } else {
      // ethers v5-ish fallback
      await provider.call({
        to: VAULT_ADDRESS,
        data: vault.interface.encodeFunctionData("rebalance", []),
      });
    }
  } catch (e) {
    console.log(
      "rebalance() preflight reverted; skipping for now.\n    Reason:",
      e.shortMessage || e.message
    );
    return;
  }

  // 5) Submit the real tx
  console.log("Conditions met. Submitting rebalance()…");
  try {
    const tx = await vaultWithSigner.rebalance(amount); // EIP-1559 defaults
    console.log("rebalance() sent:", tx.hash);
    const rcpt = await tx.wait(); // wait 1 conf by default (on HH it’s instant)
    console.log(`rebalance() confirmed in block ${rcpt.blockNumber}`);
  } catch (e) {
    console.error("rebalance() tx failed:", e.shortMessage || e.message);
  }
}

// Use script drift/read_position_info.mjs to get info on current vault position
// Simple polling loop
async function fetchDriftSnapshot() {
  const mod = await import(
    "file:///C:/Users/hwdeb/Documents/blockstat_solutions_github/Algostrats/tools/drift/read_position_info.mjs"
  );
  if (typeof mod.getDriftSnapshot !== "function") {
    throw new Error(
      "getDriftSnapshot() not exported from read_position_info.mjs"
    );
  }
  return await mod.getDriftSnapshot();
}

async function pollDrift() {
  try {
    const s = await fetchDriftSnapshot();

    console.log(
      [
        "=== Drift Vault Snapshot ===",
        `Program ID : ${s.programId}`,
        `Vault      : ${s.vaultAddress}`,
        `Depositor  : ${s.depositorAddress}`,
        "",
        `vaultEquity (USDC, base units): ${s.vaultEquityUSDCBase.toString()}`,
        `Your shares / Total shares   : ${s.yourShares.toString()} / ${s.totalShares.toString()}`,
        `Net Deposits                 : ${s.fmt.netDeposits}`,
        `Balance (USD)                : ${s.fmt.balance}`,
        `Earnings (USD)               : ${s.fmt.earnings}`,
        `ROI                          : ${s.roiPct.toFixed(2)}%`,
      ].join("\n")
    );

    // Nudge your rebalance scheduler (debounced)
    scheduleRebalanceCheck("driftUpdate");
  } catch (e) {
    console.error("Drift poll error:", e.message);
  }
}

async function main() {
  console.log("Keeper starting…");
  console.log("RPC_URL:", RPC_URL);
  console.log("Vault:", VAULT_ADDRESS);
  console.log("Signer:", await wallet.getAddress());
  console.log("Confirmations:", CONFIRMATIONS);

  // Listen to deposit events
  vault.on("Deposit", async (...args) => {
    const event = args[args.length - 1];
    const [caller, owner, assets, shares] = args;
    console.log(
      `Deposit (pending)\n  tx: ${event.log.transactionHash}\n  caller: ${caller}\n  owner: ${owner}\n  assets: ${assets}\n  shares: ${shares}`
    );
    // Wait for finality, then schedule a rebalance check
    await waitFinal(event.log.transactionHash, "Deposit");
    scheduleRebalanceCheck("deposit");
  });

  // Listen to withdraw event
  // PM
  // Start Drift polling
  setInterval(pollDrift, DRIFT_POLL_MS);

  console.log("Listening for Vault deposits + monitoring Drift…");
}

main().catch((err) => {
  console.error("❌ Keeper crashed:", err);
  process.exit(1);
});
