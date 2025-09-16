// backend/keeper/index.js
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { runPython } = require("./python_runner.js");
const { pathToFileURL } = require("url");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });
const { spawn } = require("child_process");
const { Connection, PublicKey } = require("@solana/web3.js");
const { getAssociatedTokenAddressSync } = require("@solana/spl-token");

// Logging (separate file for keeper)
const { makeLogger } = require("./logger");
const logger = makeLogger("keeper");

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
  const t0 = Date.now();
  try {
    logger.info("waitFinal.start", {
      label,
      txHash,
      confirmations: CONFIRMATIONS,
    });
    await provider.waitForTransaction(txHash, CONFIRMATIONS);
    logger.info("waitFinal.finalized", { label, txHash, ms: Date.now() - t0 });
  } catch (e) {
    logger.error("waitFinal.error", { label, txHash, error: e.message });
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
  logger, // pass logger down if your module accepts it
});

// Debounce wrapper remains local
let rebalanceTimer = null;
function scheduleRebalanceCheck(reason = "deposit") {
  if (rebalanceTimer) clearTimeout(rebalanceTimer);
  rebalanceTimer = setTimeout(() => {
    rebalanceTimer = null;
    logger.info("rebalance.trigger", { reason });
    checkAndMaybeRebalance().catch((e) =>
      logger.error("rebalance.error", { error: e.message || String(e) })
    );
  }, REBALANCE_DEBOUNCE_MS);
  logger.info("rebalance.scheduled", { reason, in_ms: REBALANCE_DEBOUNCE_MS });
}

// Hyperliquid runner (kept as-is)
let pyBusy = false;
async function runHL(action, kvArgs) {
  if (pyBusy) {
    logger.warn("hl.skip_busy", { action });
    return;
  }
  pyBusy = true;
  try {
    const res = await runPython(action, kvArgs);
    logger.info("hl.ok", { action, result: res });
    return res;
  } catch (e) {
    logger.error("hl.error", { action, error: e.message });
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
    logger.info("monitor.hl", {
      openPositions: hl?.openPositions?.length ?? 0,
    });
  } catch (e) {
    logger.error("monitor.hl.error", { error: e.message });
  }

  try {
    const drift = await fetchDriftSnapshot();
    last.drift = drift;
    logger.info("monitor.drift", {
      equity: drift?.fmt?.balance ?? "?",
      roiPct: drift?.roiPct ?? null,
    });
  } catch (e) {
    logger.error("monitor.drift.error", { error: e.message });
  }
}

async function startSequentialMonitor() {
  if (seqMonitorRunning) return;
  seqMonitorRunning = true;
  logger.info("monitor.start", { interval_ms: MONITOR_INTERVAL_MS });

  while (!stopSequentialMonitor) {
    const t0 = Date.now();
    await monitorHLThenDriftOnce(); // always HL first, then Drift
    const elapsed = Date.now() - t0;
    const wait = Math.max(0, MONITOR_INTERVAL_MS - elapsed);
    await sleep(wait);
  }

  seqMonitorRunning = false;
  logger.info("monitor.stopped");
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
  logger, // let the pipeline log to keeper log as well
});

const processedDeposits = new Set();
const pipelineQueue = [];
let pipelineBusy = false;

function enqueuePipeline(job) {
  if (processedDeposits.has(job.txHash)) {
    logger.info("pipeline.skip_duplicate", { txHash: job.txHash });
    return;
  }
  processedDeposits.add(job.txHash);
  pipelineQueue.push(job);
  logger.info("pipeline.enqueue", {
    txHash: job.txHash,
    caller: job.caller,
    owner: job.owner,
    assets: job.assets?.toString?.() ?? String(job.assets),
    shares: job.shares?.toString?.() ?? String(job.shares),
    queued: pipelineQueue.length,
  });
  if (!pipelineBusy) processQueue();
}

async function processQueue() {
  pipelineBusy = true;
  while (pipelineQueue.length) {
    const job = pipelineQueue.shift();
    const t0 = Date.now();
    try {
      logger.info("pipeline.start", { txHash: job.txHash });
      await depositPipeline(job);
      logger.info("pipeline.done", { txHash: job.txHash, ms: Date.now() - t0 });
    } catch (e) {
      logger.error("pipeline.error", {
        txHash: job.txHash,
        error: e.message || String(e),
      });
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
    logger.info("deposit.detected", {
      txHash: log.transactionHash,
      caller,
      owner,
      assets: assets?.toString?.() ?? String(assets),
      shares: shares?.toString?.() ?? String(shares),
    });

    // Step 1: Rebalance initiated
    await waitFinal(log.transactionHash, "Deposit");
    scheduleRebalanceCheck("deposit");

    // Step 2+: enqueue pipeline (swap/bridge/HL/Drift)
    enqueuePipeline({
      txHash: log.transactionHash,
      caller,
      owner,
      assets,
      shares,
    });
  },
});

// ===== Main =====
async function main() {
  logger.info("keeper.starting", {
    rpc: RPC_URL,
    vault: VAULT_ADDRESS,
    confirmations: CONFIRMATIONS,
  });
  logger.info("keeper.signer", { address: await wallet.getAddress() });

  await poller.start();
  logger.info("poller.started", {
    eventPollMs: EVENT_POLL_MS,
    reorgBuffer: REORG_BUFFER,
    startBlock: START_BLOCK,
  });

  process.on("SIGINT", () => {
    logger.warn("sigint.received", { msg: "stopping deposit poller…" });
    try {
      poller.stop();
    } catch (e) {
      logger.error("poller.stop.error", { error: e.message });
    }
    setTimeout(() => process.exit(0), 200);
  });

  // Optional background monitor
  // await startSequentialMonitor();

  logger.info("keeper.ready", {
    msg: "Listening for Vault deposits via modular HTTP poller…",
  });
}

main().catch((err) => {
  logger.error("keeper.crashed", { error: err.message || String(err) });
  process.exit(1);
});

// Log any unhandled errors so they don't get lost
process.on("unhandledRejection", (reason) => {
  logger.error("unhandledRejection", { reason: String(reason) });
});
process.on("uncaughtException", (err) => {
  logger.error("uncaughtException", { error: err.message, stack: err.stack });
});
