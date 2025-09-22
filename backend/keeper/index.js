// backend/keeper/index.js
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { runPython } = require("./python_runner.js");
const { pathToFileURL } = require("url");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });
const { spawn } = require("child_process");
const { createEventPoller } = require("./eventPoller");

// Logging (separate file for keeper)
const { makeLogger } = require("./logger");
const logger = makeLogger("keeper");

// Import modular scripts
const { buildCheckAndMaybeRebalance } = require("./rebalance");
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
if (!process.env.WBTC_ADDRESS) throw new Error("Missing WBTC_ADDRESS in .env");
if (!process.env.USDC_ADDRESS) throw new Error("Missing USDC_ADDRESS in .env");
if (!process.env.CHAINLINK_BTC_USD)
  throw new Error("Missing CHAINLINK_BTC_USD in .env");

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

// WBTC & USDC contracts
const wbtc = new ethers.Contract(process.env.WBTC_ADDRESS, erc20Abi, provider);
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

// --- Chainlink BTC/USD for USDC conversion (ONE copy, above handlers) ---
const chainlinkAbi = [
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
  "function decimals() view returns (uint8)",
];

const CHAINLINK_BTC_USD = process.env.CHAINLINK_BTC_USD;
if (!CHAINLINK_BTC_USD) throw new Error("Missing CHAINLINK_BTC_USD in .env");

const priceFeed = new ethers.Contract(
  CHAINLINK_BTC_USD,
  chainlinkAbi,
  provider
);

const USDC_DEC = 6;
// WBTC has 8; your Vault overrides decimals() to asset decimals, but shortfall math is in asset units anyway.
const ASSET_DEC = 8;

function pow10(n) {
  return 10n ** BigInt(n);
}

async function getBtcUsd() {
  const [, answer] = await priceFeed.latestRoundData();
  const pxDec = Number(await priceFeed.decimals());
  if (answer <= 0) throw new Error("Chainlink BTC/USD invalid");
  return { pxRaw: BigInt(answer), pxDec };
}

// HOISTED function declaration (not const/arrow) so handlers can call it even if defined below them in the file.
async function computeShortfallAndUsdc(shares) {
  // shares -> WBTC owed
  const owed = await vault.previewRedeem(shares); // WBTC raw
  const idle = await vault.idleAssets(); // WBTC raw
  const shortfall = owed > idle ? owed - idle : 0n;
  if (shortfall === 0n) return { shortfall, usdcRaw: 0n };

  const { pxRaw, pxDec } = await getBtcUsd();
  // USDC raw = shortfall * BTCUSD * 10^USDC / (10^ASSET * 10^pxDec)
  let usdcRaw =
    (shortfall * pxRaw * pow10(USDC_DEC)) / (pow10(ASSET_DEC) * pow10(pxDec));

  // buffer (e.g. +2%)
  const bufferBps = Number(process.env.BUFFER_BPS || 102);
  usdcRaw = (usdcRaw * BigInt(bufferBps)) / 100n;

  return { shortfall, usdcRaw };
}

// Call modular script to check whether keeper should rebalance ----
const checkAndMaybeRebalance = buildCheckAndMaybeRebalance({
  provider,
  vault,
  vaultWithSigner,
  vaultAddress: VAULT_ADDRESS,
  erc20Abi,
  wbtcEnvAddress: process.env.WBTC_ADDRESS || null,
  logger,
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

// Optional: Hyperliquid runner
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

// Optional: Drift snapshot
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

// Optional monitors
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

// ===== Deposit pipeline (unchanged) =====
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
  logger,
});

// Small deposit queue
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

// ===== Withdraw queue (spawns withdrawPipeline.js) =====
const processedWithdraws = new Set();
const withdrawQueue = [];
let withdrawBusy = false;

function enqueueWithdraw(job) {
  if (processedWithdraws.has(job.txHash)) {
    logger.info("withdraw.skip_duplicate", { txHash: job.txHash });
    return;
  }
  processedWithdraws.add(job.txHash);
  withdrawQueue.push(job);
  logger.info("withdraw.enqueue", {
    txHash: job.txHash,
    user: job.user,
    shares: job.shares?.toString?.() ?? String(job.shares),
    usdc: job.usdcHuman,
    queued: withdrawQueue.length,
  });
  if (!withdrawBusy) processWithdrawQueue();
}

async function processWithdrawQueue() {
  withdrawBusy = true;
  while (withdrawQueue.length) {
    const job = withdrawQueue.shift();
    const t0 = Date.now();
    try {
      logger.info("withdraw.pipeline.start", { txHash: job.txHash });

      // spawn your existing withdrawPipeline.js with --stage=init --usdc=<X>
      const script = path.resolve(__dirname, "./withdrawPipeline.js");
      const args = [script, "--stage=init", `--usdc=${job.usdcHuman}`];

      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, args, {
          cwd: path.dirname(script),
          stdio: "inherit",
          env: { ...process.env },
        });
        child.once("error", reject);
        child.once("exit", (code) =>
          code === 0
            ? resolve()
            : reject(new Error(`withdrawPipeline exited ${code}`))
        );
      });

      logger.info("withdraw.pipeline.done", {
        txHash: job.txHash,
        ms: Date.now() - t0,
      });
    } catch (e) {
      logger.error("withdraw.pipeline.error", {
        txHash: job.txHash,
        error: e.message || String(e),
      });
    }
  }
  withdrawBusy = false;
}

// ===== Unified event handlers =====

// --- Deposit (ERC-4626) ---
async function onDeposit({ args, log }) {
  const [caller, owner, assets, shares] = args;
  logger.info("deposit.detected", {
    txHash: log.transactionHash,
    caller,
    owner,
    assets: assets?.toString?.() ?? String(assets),
    shares: shares?.toString?.() ?? String(shares),
  });

  await waitFinal(log.transactionHash, "Deposit");
  scheduleRebalanceCheck("deposit");

  enqueuePipeline({
    txHash: log.transactionHash,
    caller,
    owner,
    assets,
    shares,
  });
}

// --- Withdraw initiated (custom event) ---
async function onWithdrawInitiated({ args, log }) {
  const [user, shares, unlockAt] = args;
  logger.info("withdraw.initiated.detected", {
    txHash: log.transactionHash,
    user,
    shares: shares?.toString?.() ?? String(shares),
    unlockAt: Number(unlockAt),
  });

  await waitFinal(log.transactionHash, "WithdrawInitiated");

  const { shortfall, usdcRaw } = await computeShortfallAndUsdc(shares);
  const usdcHuman = ethers.formatUnits(usdcRaw, USDC_DEC);

  logger.info("withdraw.shortfall", {
    wbtcShortfall: ethers.formatUnits(shortfall, ASSET_DEC),
    usdcNeeded: usdcHuman,
  });

  const minUsdc = Number(process.env.MIN_USDC || 0);
  if (Number(usdcHuman) < minUsdc) {
    logger.info("withdraw.skip_min", { usdcHuman, minUsdc });
    return;
  }

  enqueueWithdraw({
    txHash: log.transactionHash,
    user,
    shares,
    unlockAt,
    usdcHuman,
  });
}

// Events config for unified poller
const events = [
  {
    name: "Deposit",
    signature: "Deposit(address,address,uint256,uint256)",
    handler: onDeposit,
  },
  {
    name: "WithdrawInitiated",
    signature: "WithdrawInitiated(address,uint256,uint256)",
    handler: onWithdrawInitiated,
  },
];

// ===== Main =====
async function main() {
  logger.info("keeper.starting", {
    rpc: RPC_URL,
    vault: VAULT_ADDRESS,
    confirmations: CONFIRMATIONS,
  });
  logger.info("keeper.signer", { address: await wallet.getAddress() });

  const poller = createEventPoller({
    provider,
    contract: vault,
    address: VAULT_ADDRESS,
    events,
    confirmations: CONFIRMATIONS,
    eventPollMs: EVENT_POLL_MS,
    reorgBuffer: REORG_BUFFER,
    startBlock: START_BLOCK, // or `(await provider.getBlockNumber()) - 2000` for backfill
    logger,
  });

  await poller.start();
  logger.info("poller.started", {
    eventPollMs: EVENT_POLL_MS,
    reorgBuffer: REORG_BUFFER,
    startBlock: START_BLOCK,
  });

  process.on("SIGINT", () => {
    logger.warn("sigint.received", { msg: "stopping unified poller…" });
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
    msg: "Listening for Vault deposits & withdrawals via unified poller…",
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
