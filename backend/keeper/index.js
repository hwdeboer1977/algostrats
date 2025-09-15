const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { runPython } = require("./python_runner.js");
const { pathToFileURL } = require("url");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });
const { spawn } = require("child_process");
const { Connection, PublicKey } = require("@solana/web3.js");
const { getAssociatedTokenAddressSync } = require("@solana/spl-token");

// Import these scripts (keeps code modular)
const { buildCheckAndMaybeRebalance } = require("./rebalance");
const { createDepositPoller } = require("./depositPoller");
const { buildDepositPipeline } = require("./depositPipeline");

// ===== ENV =====
const RPC_URL = process.env.ARBITRUM_ALCHEMY_MAINNET;
const CONFIRMATIONS = Number(process.env.CONFIRMATIONS || 1);
const VAULT_ADDRESS = process.env.VAULT_ADDRESS;
const KEEPER_PRIVATE_KEY = process.env.KEEPER_MAINNET_PRIVATE_KEY;
const REBALANCE_DEBOUNCE_MS = Number(
  process.env.REBALANCE_DEBOUNCE_MS || 30_000
);

// Poller config
const EVENT_POLL_MS = Number(process.env.EVENT_POLL_MS || 4000);
const REORG_BUFFER = Number(
  process.env.REORG_BUFFER || Math.max(CONFIRMATIONS - 1, 2)
);
const START_BLOCK = process.env.START_BLOCK
  ? Number(process.env.START_BLOCK)
  : null;

// Other config
const MONITOR_INTERVAL_MS = Number(process.env.MONITOR_INTERVAL_MS || 60_000);

// Sanity checks
if (!RPC_URL)
  throw new Error("Missing RPC_URL (ARBITRUM_ALCHEMY_MAINNET) in .env");
if (!VAULT_ADDRESS) throw new Error("Missing VAULT_ADDRESS in .env");
if (!KEEPER_PRIVATE_KEY) throw new Error("Missing KEEPER_PRIVATE_KEY in .env");

// Load Vault ABI (JSON array)
const vaultAbiFile = path.join(__dirname, "./abi/Vault.json");
if (!fs.existsSync(vaultAbiFile)) {
  throw new Error(`Missing ABI at ${vaultAbiFile}`);
}
let vaultAbi;
try {
  const raw = fs.readFileSync(vaultAbiFile, "utf8").trim();
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed))
    throw new Error("Vault.json is not a JSON array (ABI).");
  vaultAbi = parsed;
} catch (err) {
  throw new Error(`Failed to load ABI: ${err.message}`);
}

// Minimal ERC20 ABI
const erc20Abi = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
];

// Provider & contracts
const provider = RPC_URL.startsWith("ws")
  ? new ethers.WebSocketProvider(RPC_URL)
  : new ethers.JsonRpcProvider(RPC_URL);

const wallet = new ethers.Wallet(KEEPER_PRIVATE_KEY, provider);
const vault = new ethers.Contract(VAULT_ADDRESS, vaultAbi, provider);
const vaultWithSigner = vault.connect(wallet);

// WBTC contract
const wbtc = new ethers.Contract(process.env.WBTC_ADDRESS, erc20Abi, provider);

// USDC contract
const usdc = new ethers.Contract(process.env.USDC_ADDRESS, erc20Abi, provider);

// ============ Helpers ============
async function waitFinal(txHash, label) {
  try {
    await provider.waitForTransaction(txHash, CONFIRMATIONS);
    console.log(`[finalized] ${label} @ ${txHash}`);
  } catch (e) {
    console.error(`waitForTransaction failed for ${label}:`, e.message);
  }
}

// Call modular script to check whether keeper should rebalance ----
const checkAndMaybeRebalance = buildCheckAndMaybeRebalance({
  provider,
  vault,
  vaultWithSigner,
  vaultAddress: VAULT_ADDRESS,
  erc20Abi,
  wbtcEnvAddress: process.env.WBTC_ADDRESS || null,
});

// Debounce wrapper remains local
let rebalanceTimer = null;
function scheduleRebalanceCheck(reason = "deposit") {
  if (rebalanceTimer) clearTimeout(rebalanceTimer);
  rebalanceTimer = setTimeout(() => {
    rebalanceTimer = null;
    checkAndMaybeRebalance().catch((e) =>
      console.error("checkAndMaybeRebalance error:", e)
    );
  }, REBALANCE_DEBOUNCE_MS);
  console.log(
    `⏲ Scheduled rebalance check in ${REBALANCE_DEBOUNCE_MS}ms (reason: ${reason})`
  );
}

// Hyperliquid runner (kept as-is)
let pyBusy = false;
async function runHL(action, kvArgs) {
  if (pyBusy) {
    console.log("🔒 HL call skipped: previous call still running");
    return;
  }
  pyBusy = true;
  try {
    const res = await runPython(action, kvArgs);
    console.log("✅ HL result:", res);
    return res;
  } catch (e) {
    console.error("❌ HL error:", e.message);
  } finally {
    pyBusy = false;
  }
}

// Drift snapshot (kept as-is)
async function fetchDriftSnapshot() {
  const mjsPath = path.resolve(
    __dirname,
    "../../tools/drift/read_position_info.mjs"
  );
  const fileUrl = pathToFileURL(mjsPath).href;

  const mod = await import(fileUrl);
  if (typeof mod.getDriftSnapshot !== "function") {
    throw new Error(
      "getDriftSnapshot() not exported from read_position_info.mjs"
    );
  }
  return mod.getDriftSnapshot();
}

// Optional monitors (unchanged)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let seqMonitorRunning = false;
let stopSequentialMonitor = false;
const last = { hl: null, drift: null };

async function monitorHLThenDriftOnce() {
  try {
    const hl = await runHL("summary");
    last.hl = hl;
    console.log("[HL] positions:", hl?.openPositions?.length ?? 0);
  } catch (e) {
    console.error("[HL] monitor error:", e.message);
  }

  try {
    const drift = await fetchDriftSnapshot();
    last.drift = drift;
    console.log(
      `[Drift] equity: ${drift?.fmt?.balance ?? "?"} USD, ROI: ${
        drift?.roiPct?.toFixed?.(2) ?? "?"
      }%`
    );
  } catch (e) {
    console.error("[Drift] monitor error:", e.message);
  }
}

async function startSequentialMonitor() {
  if (seqMonitorRunning) return;
  seqMonitorRunning = true;
  console.log(
    `Starting sequential monitor (HL → Drift) every ${MONITOR_INTERVAL_MS}ms`
  );

  while (!stopSequentialMonitor) {
    const t0 = Date.now();
    await monitorHLThenDriftOnce();
    const elapsed = Date.now() - t0;
    const wait = Math.max(0, MONITOR_INTERVAL_MS - elapsed);
    await sleep(wait);
  }

  seqMonitorRunning = false;
  console.log("Sequential monitor stopped.");
}

const depositPipeline = buildDepositPipeline({
  wbtc,
  usdc,
  wallets: {
    A: process.env.WALLET_RECIPIENT_A,
    B: process.env.WALLET_RECIPIENT_B,
  },
  privateKeys: { A: process.env.PK_RECIPIENT_A, B: process.env.PK_RECIPIENT_B },
  scripts: {
    swap: path.resolve(__dirname, "../../tools/swap/swap_wbtc_to_usdc.cjs"),
    bridge: path.resolve(__dirname, "../../tools/bridge/lifi_bridge_sol.cjs"),
    hlDeposit: path.resolve(__dirname, "../../tools/hyperliquid/deposit_HL.py"),
    hlOpen: path.resolve(__dirname, "../../tools/hyperliquid/create_orders.py"),
    driftVault: path.resolve(__dirname, "../../tools/drift/vaultNew.mjs"),
  },
  solana: {
    rpc: process.env.SOLANA_RPC,
    owner: process.env.SOLANA_PUBKEY,
    usdcMint:
      process.env.SOLANA_USDC_MINT ||
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  },
  provider,
});

const processedDeposits = new Set();
const pipelineQueue = [];
let pipelineBusy = false;

function enqueuePipeline(job) {
  if (processedDeposits.has(job.txHash)) return;
  processedDeposits.add(job.txHash);
  pipelineQueue.push(job);
  if (!pipelineBusy) processQueue();
}

async function processQueue() {
  pipelineBusy = true;
  while (pipelineQueue.length) {
    const job = pipelineQueue.shift();
    try {
      await depositPipeline(job);
    } catch (e) {
      console.error("pipeline error:", e);
    }
  }
  pipelineBusy = false;
}

// Event listener for deposits into smart contract ----
const poller = createDepositPoller({
  provider,
  vault,
  vaultAddress: VAULT_ADDRESS,
  confirmations: CONFIRMATIONS,
  eventPollMs: EVENT_POLL_MS,
  reorgBuffer: REORG_BUFFER,
  startBlock: START_BLOCK,
  onDeposit: async ({ args, log }) => {
    const [caller, owner, assets, shares] = args;
    console.log(
      `Deposit (log)\n  tx: ${log.transactionHash}\n  caller: ${caller}\n  owner: ${owner}\n  assets: ${assets}\n  shares: ${shares}`
    );

    // Step 1: Rebalance initiated
    await waitFinal(log.transactionHash, "Deposit");
    scheduleRebalanceCheck("deposit");

    enqueuePipeline({
      txHash: log.transactionHash,
      caller,
      owner,
      assets,
      shares,
    });

    // Step 2: Swap wBTC to USDC
    // C:\Users\hwdeb\Documents\blockstat_solutions_github\Algostrats\tools\swap\swap_wbtc_to_usdc.cjs AMOUNTWBTC

    // Step 3: Bridge USDC to Solana (only for recipient wallet A)

    // Step 4: Open position in vault for wallet A on Drift
    // Step 5: 0pen position HL for wallet B

    // If you later want to run swap/bridge/HL/Drift pipeline directly:
    // await pipelineAfterDeposit({ caller, owner, assets, shares, log });
  },
});

// ===== Main =====
async function main() {
  console.log("Keeper starting…");
  console.log("RPC_URL:", RPC_URL);
  console.log("Vault:", VAULT_ADDRESS);
  console.log("Signer:", await wallet.getAddress());
  console.log("Confirmations:", CONFIRMATIONS);

  await poller.start();

  process.on("SIGINT", () => {
    console.log("SIGINT received, stopping deposit poller…");
    poller.stop();
    setTimeout(() => process.exit(0), 200);
  });

  // Optional:
  // await startSequentialMonitor();

  console.log("Listening for Vault deposits via modular HTTP poller…");
}

main().catch((err) => {
  console.error("❌ Keeper crashed:", err);
  process.exit(1);
});
