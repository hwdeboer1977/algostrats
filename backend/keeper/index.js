// backend/keeper/index.js
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });
const { spawn } = require("child_process");
const { createEventPoller } = require("./eventPoller");

// Logging
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

// Poller config
const EVENT_POLL_MS = Number(process.env.EVENT_POLL_MS || 4000);
const REORG_BUFFER = Number(
  process.env.REORG_BUFFER || Math.max(CONFIRMATIONS - 1, 2)
);
const START_BLOCK = process.env.START_BLOCK
  ? Number(process.env.START_BLOCK)
  : null;

// Rebalance debounce (ms)
const REBALANCE_DEBOUNCE_MS = Number(
  process.env.REBALANCE_DEBOUNCE_MS || 30_000
);

// Sanity checks
if (!RPC_URL)
  throw new Error("Missing RPC_URL (ARBITRUM_ALCHEMY_MAINNET) in .env");
if (!VAULT_ADDRESS) throw new Error("Missing VAULT_ADDRESS in .env");
if (!KEEPER_PRIVATE_KEY) throw new Error("Missing KEEPER_PRIVATE_KEY in .env");
if (!process.env.WBTC_ADDRESS) throw new Error("Missing WBTC_ADDRESS in .env");
if (!process.env.USDC_ADDRESS) throw new Error("Missing USDC_ADDRESS in .env");
if (!process.env.CHAINLINK_BTC_USD)
  throw new Error("Missing CHAINLINK_BTC_USD in .env");

// ===== Helpers =====
const errMeta = (e, extra = {}) => ({
  ...extra,
  name: e?.name,
  error: e?.message || String(e),
  stack: e?.stack,
});

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

// ============ Wait finality ============
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
    logger.error("waitFinal.error", errMeta(e, { label, txHash }));
  }
}

// ============ Rebalance (debounced) ============
const checkAndMaybeRebalance = buildCheckAndMaybeRebalance({
  provider,
  vault,
  vaultWithSigner,
  vaultAddress: VAULT_ADDRESS,
  erc20Abi,
  wbtcEnvAddress: process.env.WBTC_ADDRESS || null,
});

let rebalanceTimer = null;
function scheduleRebalanceCheck(reason = "deposit") {
  if (rebalanceTimer) clearTimeout(rebalanceTimer);
  rebalanceTimer = setTimeout(() => {
    rebalanceTimer = null;
    logger.info("rebalance.start", { reason });
    checkAndMaybeRebalance()
      .then(() => logger.info("rebalance.done", { reason }))
      .catch((e) => logger.error("rebalance.error", errMeta(e, { reason })));
  }, REBALANCE_DEBOUNCE_MS);

  logger.info("rebalance.scheduled", { reason, ms: REBALANCE_DEBOUNCE_MS });
}

// --- Chainlink BTC/USD for USDC conversion (ONE copy, above handlers) ---
const chainlinkAbi = [
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
  "function decimals() view returns (uint8)",
];

const CHAINLINK_BTC_USD = process.env.CHAINLINK_BTC_USD;
const priceFeed = new ethers.Contract(
  CHAINLINK_BTC_USD,
  chainlinkAbi,
  provider
);

const USDC_DEC = 6;
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

// HOISTED function declaration (not const/arrow)
async function computeShortfallAndUsdc(shares) {
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

// ===== Deposit pipeline =====
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
      logger.error("pipeline.error", errMeta(e, { txHash: job.txHash }));
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

      const script = path.resolve(__dirname, "./withdrawPipeline.js");
      const args = [script, "--stage=init", `--usdc=${job.usdcHuman}`];

      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, args, {
          cwd: path.dirname(script),
          stdio: "inherit",
          env: { ...process.env },
        });
        child.once("error", (e) =>
          reject(new Error(`spawn withdrawPipeline failed: ${e.message}`))
        );
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
      logger.error(
        "withdraw.pipeline.error",
        errMeta(e, { txHash: job.txHash })
      );
    }
  }
  withdrawBusy = false;
}

// ===== Unified event handlers =====
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

async function onWithdrawInitiated({ args, log }) {
  const [user, shares, unlockAt] = args;
  logger.info("withdraw.initiated.detected", {
    txHash: log.transactionHash,
    user,
    shares: shares?.toString?.() ?? String(shares),
    unlockAt: Number(unlockAt),
  });

  await waitFinal(log.transactionHash, "WithdrawInitiated");

  try {
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
  } catch (e) {
    logger.error(
      "withdraw.computeShortfall.error",
      errMeta(e, { txHash: log.transactionHash })
    );
  }
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
    startBlock: START_BLOCK,
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
      logger.error("poller.stop.error", errMeta(e));
    }
    setTimeout(() => process.exit(0), 200);
  });

  logger.info("keeper.ready", {
    msg: "Listening for Vault deposits & withdrawals via unified poller…",
  });
}

main().catch((err) => {
  logger.error("keeper.crashed", errMeta(err));
  process.exit(1);
});

// Global error logs
process.on("unhandledRejection", (reason) => {
  logger.error("unhandledRejection", { reason: String(reason) });
});
process.on("uncaughtException", (err) => {
  logger.error("uncaughtException", errMeta(err));
});
