// backend/keeper/withdrawPipeline.js
// CommonJS version – no "type": "module" required
const { spawn } = require("child_process");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const { ethers } = require("ethers");
const { runPython } = require("./python_runner.js");
const fs = require("fs");
const RUNNER = path.resolve(__dirname, "./withdrawRunner.js"); // adjust path if needed

/** ---------- Config: absolute paths to your scripts ---------- */
const P = {
  HL_CREATE_ORDERS: path.resolve(
    __dirname,
    "../../tools/hyperliquid/create_orders.py"
  ),
  DRIFT_REQUEST_WD: path.resolve(
    __dirname,
    "../../tools/drift/request_withdraw.mjs"
  ),
  DRIFT_WD: path.resolve(__dirname, "../../tools/drift/vaultNew.mjs"),
  HL_WITHDRAW: path.resolve(
    __dirname,
    "../../tools/hyperliquid/withdraw_HL.py"
  ),
  LIFI_BRIDGE: path.resolve(
    __dirname,
    "../../tools/bridge/lifi_bridge_arb.cjs"
  ),
  SEND_USDC_JS: path.resolve(__dirname, "../../backend/keeper/send_usdc.js"),
  SEND_USDC_PY: path.resolve(__dirname, "../../tools/hyperliquid/send_usdc.py"),
  SWAP_USDC_WBTC: path.resolve(
    __dirname,
    "../../tools/swap/swap_usdc_to_wbtc.js"
  ),
};

/** ---------- Helpers ---------- */
function run(cmd, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      shell: process.platform === "win32", // for Windows path handling
      env: { ...process.env, ...(opts.env || {}) },
      cwd: opts.cwd || undefined,
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))
    );
  });
}

// run a Node script and capture stdout/stderr
function runNode(file, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...(opts.env || {}) },
      cwd: opts.cwd || undefined,
    });
    let out = "",
      err = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve(out) : reject(new Error(err || `exit ${code}`))
    );
  });
}

// normalize getAddress for ethers v5/v6
function normalizeAddressMaybe(addr) {
  if (!addr) return null;
  const s = String(addr)
    .trim()
    .replace(/^["']|["']$/g, "");
  try {
    if (typeof ethers.getAddress === "function") return ethers.getAddress(s); // v6
    return ethers.utils.getAddress(s); // v5
  } catch {
    return null;
  }
}

// parse a base58-ish Solana tx signature from stdout
function parseTxSig(s) {
  // prefer an explicit "txSignature: <sig>" line if your mjs prints it
  const m1 = s.match(/txSignature:\s*([1-9A-HJ-NP-Za-km-z]{43,88})/);
  if (m1) return m1[1];

  // fallback: grab the first base58-looking blob that is NOT obviously a 32- or 44-char wallet you printed earlier
  const m2 = s.match(/([1-9A-HJ-NP-Za-km-z]{43,88})/);
  return m2 ? m2[1] : null;
}

// Get a CLI arg
function getArg(name, def = undefined) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((a) => a.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : def;
}

// read args
const usdcHumanRaw = getArg("usdc"); // "--usdc=123.45"
const usdcHuman = usdcHumanRaw != null ? Number(usdcHumanRaw) : undefined;

function runRunner(cmd, argsObj = {}) {
  const args = [
    RUNNER,
    cmd,
    ...Object.entries(argsObj).map(([k, v]) => `--${k}=${v}`),
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: "inherit" });
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`runner ${cmd} exited ${code}`))
    );
  });
}

// Get balance of USDC in Drift's vault
function parseBalanceUsd(text) {
  const m = /Balance\s*\(USD\)\s*:\s*([-\d.,]+)/i.exec(text);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

// Parse HL JSON summary (from Python stdout)
function parseHlUsd(out) {
  const defaults = {
    totalUsd: 0,
    cashUsd: 0,
    posPNL: 0,
    positionValue: 0,
    marginUsed: 0,
    effLev: 0,
  };

  const s = typeof out === "string" ? out : out?.stdout ?? "";
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return defaults;

  let j;
  try {
    j = JSON.parse(s.slice(start, end + 1)); // parse only the JSON block
  } catch (e) {
    console.error("parseHlUsd JSON error:", e);
    return defaults;
  }

  const eq = Number(j?.marginSummary?.accountValue ?? 0);
  const marginUsed = Number(j?.marginSummary?.totalMarginUsed ?? 0);
  const positionValue = Array.isArray(j?.openPositions)
    ? j.openPositions.reduce(
        (sum, p) => sum + Number(p?.position?.positionValue ?? 0),
        0
      )
    : 0;
  const posPNL = Array.isArray(j?.openPositions)
    ? j.openPositions.reduce(
        (sum, p) => sum + Number(p?.position?.unrealizedPnl ?? 0),
        0
      )
    : 0;

  const cashUsd = Math.max(0, eq - marginUsed);
  const effLev = marginUsed > 0 ? positionValue / marginUsed : 0;

  return { totalUsd: eq, cashUsd, posPNL, positionValue, marginUsed, effLev };
}

// --- Read Drift + HL positions
async function readPositions() {
  const driftScript = path.resolve(
    __dirname,
    "../../tools/drift/read_position_info.mjs"
  );
  const driftOut = await runNode(driftScript, []);
  const balanceUsd = parseBalanceUsd(driftOut);

  const hlRes = await runPython("summary");
  const { totalUsd, cashUsd, posPNL, positionValue, marginUsed, effLev } =
    parseHlUsd(hlRes);

  return {
    balanceUsd,
    totalUsd,
    cashUsd,
    posPNL,
    positionValue,
    marginUsed,
    effLev,
  };
}

// Keep HL at target ratio r after withdrawing W USD.
function splitHLWithdrawal({
  totalUsd, // E
  cashUsd, // C
  positionValue, // PV
  marginUsed, // M0
  effLev, // L
  targetRatio, // r
  withdrawUsd, // W
}) {
  const E = Number(totalUsd),
    C = Number(cashUsd),
    PV = Number(positionValue),
    M0 = Number(marginUsed);
  const L = Number(effLev) || 10;
  const r = Number(targetRatio);
  const W = Number(withdrawUsd);

  for (const [k, v] of Object.entries({ E, C, PV, M0, L, r, W })) {
    if (!Number.isFinite(v))
      throw new Error(`splitHLWithdrawal: bad ${k}=${v}`);
  }
  if (W > E + 1e-9) throw new Error(`withdraw ${W} > total ${E}`);

  const Mtarget = r * (E - W);
  const needRatio = Math.max(0, M0 - Mtarget);
  const needCash = Math.max(0, W - C);
  const deltaM = Math.max(needRatio, needCash);

  const closePosUsd = Math.min(PV, deltaM * L);
  const fromCash = Math.min(W, C);
  const freedCash = closePosUsd / L;
  const shortage = Math.max(0, W - (fromCash + freedCash));

  return { closePosUsd, fromCash, shortage };
}

// ---- ERC20 + SPL balance readers ----
const ERC20_ABI_MIN = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

// EVM (Arbitrum) ERC20 balance
async function readErc20Balance({ rpc, token, wallet }) {
  const { ethers } = require("ethers");
  const provider = new ethers.JsonRpcProvider(rpc); // v6
  const erc = new ethers.Contract(token, ERC20_ABI_MIN, provider);
  const [raw, dec] = await Promise.all([erc.balanceOf(wallet), erc.decimals()]);
  return Number(raw) / 10 ** Number(dec);
}

// Solana SPL USDC balance (Associated Token Account)
async function readSplBalance({ rpc, owner, mint }) {
  const { Connection, PublicKey } = require("@solana/web3.js");
  const {
    getAssociatedTokenAddress,
    getAccount,
  } = require("@solana/spl-token");

  const conn = new Connection(rpc, "confirmed");
  const ownerPk = new PublicKey(owner);
  const mintPk = new PublicKey(mint);
  const ata = await getAssociatedTokenAddress(mintPk, ownerPk, false);
  try {
    const acct = await getAccount(conn, ata, "confirmed");
    // acct.amount is bigint (raw, with mint decimals)
    // You can fetch mint decimals if you want exact; USDC=6 on Solana:
    const dec = 6;
    return Number(acct.amount) / 10 ** dec;
  } catch (e) {
    // no ATA -> zero balance
    return 0;
  }
}

// Step 1: Hyperliquid partial/full close
async function step1_closeHL(closePct) {
  const coin = getArg("coin", "ETH");
  const cliPct = getArg("closePct"); // optional CLI override
  const size = getArg("closeSize"); // absolute size alternative
  const slip = getArg("closeSlippage", "0.01");

  const pct = cliPct ?? closePct;

  const args = [P.HL_CREATE_ORDERS, "close", `coin=${coin}`];
  if (size) {
    args.push(`close_size=${size}`);
  } else if (pct != null) {
    args.push(`pct=${pct}`);
  }
  if (slip) args.push(`close_slippage=${slip}`);

  console.log(
    "▶ Step 1: Hyperliquid partial/full close:",
    ["python", ...args].join(" ")
  );
  await run("python", args);
}

// Step 2: Request/Initiate withdraw from Drift (24h redemption)
async function step2_requestWithdrawDrift(amountDrift) {
  const amount = Number(amountDrift);
  if (!Number.isFinite(amount) || amount <= 0)
    throw new Error("step2_requestWithdrawDrift: invalid amount");

  const driftVault = process.env.DRIFT_VAULT_ADDRESS;
  const driftAuthority = process.env.DRIFT_VAULT_AUTHORITY;
  console.log("▶ Step 2: Drift request withdraw…");
  const args = [
    P.DRIFT_REQUEST_WD,
    "--usdc",
    String(amount),
    "--vault-address",
    driftVault,
    "--authority",
    driftAuthority,
  ];
  console.log(
    "   node",
    args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")
  );
  await run("node", args, { cwd: path.dirname(P.DRIFT_REQUEST_WD) });
}

// Step 3: Finalize withdrawal from Drift (after 24h) — capture tx sig
async function step3_finalizeWithdrawDrift() {
  console.log("▶ Step 3: Drift finalize withdraw (after redemption delay)…");
  const out = await runNode(P.DRIFT_WD, ["withdraw"], {
    cwd: path.dirname(P.DRIFT_WD),
  });
  // Expect your vaultNew.mjs to print:  txSignature: <sig>
  const sig = parseTxSig(out || "");
  if (!sig) {
    console.error("Drift finalize stdout:\n", out);
    throw new Error(
      "Could not detect a transaction signature from finalize output."
    );
  }
  console.log("✅ Drift finalize txSignature:", sig);
  console.log(
    "🔎 Explorer:",
    `https://solscan.io/tx/${sig}  (add ?cluster=devnet for devnet)`
  );
}

// Step 4: Withdraw USDC from Hyperliquid
async function step4_withdrawHL(amountHL, opts = {}) {
  const amt = Number(amountHL);
  if (!Number.isFinite(amt) || amt <= 0)
    throw new Error("step4_withdrawHL: amountHL is required and must be > 0");

  const args = [P.HL_WITHDRAW, String(amt)];
  if (opts.pk) args.push("--pk", opts.pk);
  if (opts.dest) args.push("--dest", opts.dest);
  if (opts.config) args.push("--config", opts.config);
  if (opts.noWait) args.push("--no-wait");
  if (opts.testnet) args.push("--testnet");

  console.log(
    "▶ Step 4: Withdraw from Hyperliquid:",
    ["python", ...args].join(" ")
  );
  await run("python", args);
}

// Step 5: Bridge Solana → Arbitrum
async function step5_bridgeSolanaToArbitrum(amount, opts = {}) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0)
    throw new Error(
      "step5_bridgeSolanaToArbitrum: amount is required and must be > 0"
    );

  const script = P.LIFI_BRIDGE;
  const args = [script, String(amt)];

  const env = { ...process.env };
  if (opts.solPk) env.WALLET_SOLANA_SECRET = opts.solPk;
  if (opts.evmPk) env.WALLET_SECRET = opts.evmPk; // EVM private key
  if (opts.to) env.EVM_TO_ADDRESS = opts.to;

  console.log(
    "▶ Step 5 (Sol→Arb bridge):",
    ["node", script, String(amt)].join(" ")
  );
  await run("node", args, { cwd: path.dirname(script), env });
}

// Step 6: Send USDC from wallet A to vault
async function step6_sendUSDC_A_to_owner(amountA = undefined, opts = {}) {
  const amountFromCli = getArg("sendA");
  const chosen = amountA ?? amountFromCli ?? process.env.AMOUNT ?? null;
  const amount = chosen != null ? Number(chosen) : null;

  const args = [P.SEND_USDC_JS];
  if (amount !== null) args.push(String(amount));
  if (opts.to) args.push(`--to=${opts.to}`);

  const env = { ...process.env };
  if (amount !== null) env.AMOUNT = String(amount);
  console.log(
    `▶ Step 6: Send USDC A${amount !== null ? ` (amount=${amount})` : ""}…`
  );
  await run("node", args, { env, cwd: path.dirname(P.SEND_USDC_JS) });
}

// Step 7: Send USDC from wallet B to vault
async function step7_sendUSDC_B_to_owner(amountB = undefined, opts = {}) {
  const amountFromCli = getArg("sendB");
  const chosen = amountB ?? amountFromCli ?? process.env.AMOUNT ?? null;
  const amount = chosen != null ? Number(chosen) : null;

  const args = [P.SEND_USDC_PY];
  if (amount !== null) args.push(String(amount));
  if (opts.to) args.push(`--to=${opts.to}`);

  const env = { ...process.env };
  if (amount !== null) env.AMOUNT = String(amount);
  console.log(
    `▶ Step 7: Send USDC from wallet B to vault${
      amount !== null ? ` (amount=${amount})` : ""
    }…`
  );
  await run("python", args, { env, cwd: path.dirname(P.SEND_USDC_PY) });
}

// Step 8: Swap USDC → WBTC and send to vault (or recipient)
async function step8_swapUSDCtoWBTC(amountSwap = undefined, opts = {}) {
  const amountFromCli = getArg("swapAmount");
  const toFromCli = getArg("to");
  const slippageFromCli = getArg("slippage");

  const chosen = amountSwap ?? amountFromCli ?? null;
  const amount = chosen != null ? Number(chosen) : null;
  if (!(amount > 0)) {
    console.log("▶ Step 8: No valid amount provided; skipping swap.");
    return;
  }

  // v6-safe normalization
  function normalizeAddressMaybe(addr) {
    if (!addr) return null;
    const cleaned = String(addr)
      .replace(/^[\s"'`]+|[\s"'`]+$/g, "")
      .trim();
    try {
      return typeof ethers.getAddress === "function"
        ? ethers.getAddress(cleaned)
        : ethers.utils.getAddress(cleaned);
    } catch {
      return null;
    }
  }

  let toResolved = opts.to ?? toFromCli ?? process.env.VAULT_ADDRESS ?? null;
  toResolved = normalizeAddressMaybe(toResolved);

  const slippage = opts.slippage ?? slippageFromCli ?? process.env.SLIPPAGE_BPS;

  const args = [P.SWAP_USDC_WBTC, String(amount)];
  if (slippage) args.push("--slippage", String(slippage));
  if (toResolved) {
    args.push("--to", toResolved); // <-- space form
    args.push("--allowContractRecipient=1"); // <-- allow contract dests
  }

  const env = { ...process.env, AMOUNT: String(amount) };

  // DEBUG: see exactly what we send
  console.log("[step8] argv →", args.map((s) => JSON.stringify(s)).join(" "));

  await run("node", args, {
    env,
    cwd: path.dirname(P.SWAP_USDC_WBTC),
    shell: false, // <-- critical on Windows
  });
}

async function withdrawPerProtocol(usdcHumanInput) {
  console.log("Determining how much to withdraw from both protocols");

  // Shares to take out of protocols (coerce + validate)
  const SHARE_DRIFT = Number(process.env.SHARE_DRIFT ?? 0.5);
  const SHARE_HL = Number(process.env.SHARE_HL ?? 0.5);
  if (!Number.isFinite(SHARE_DRIFT) || !Number.isFinite(SHARE_HL))
    throw new Error("Invalid SHARE_DRIFT/SHARE_HL env");
  const sumShares = SHARE_DRIFT + SHARE_HL;
  if (Math.abs(sumShares - 1) > 1e-6) {
    console.warn(`⚠️ SHARE_DRIFT + SHARE_HL = ${sumShares} ≠ 1; normalizing.`);
  }
  // normalize in case of drift
  const driftShare = SHARE_DRIFT / sumShares;
  const hlShare = SHARE_HL / sumShares;

  const {
    balanceUsd, // Drift vault USD
    totalUsd, // HL total equity
    cashUsd, // HL cash
    posPNL,
    positionValue,
    marginUsed,
    effLev,
  } = await readPositions();

  console.log(
    balanceUsd,
    totalUsd,
    cashUsd,
    posPNL,
    positionValue,
    marginUsed,
    effLev
  );

  const neededUsdcDrift = Number(usdcHumanInput) * driftShare;
  const neededUsdcHL = Number(usdcHumanInput) * hlShare;

  const availDrift = Number(balanceUsd ?? 0);
  const availTotalHL = Number(totalUsd ?? 0);
  const availCashHL = Number(cashUsd ?? 0);
  const availPosValHL = Number(positionValue ?? 0);

  console.log("need: drift=", neededUsdcDrift, "hl=", neededUsdcHL);
  console.log("avail: drift=", availDrift);
  console.log(
    "avail total HL=",
    availTotalHL,
    "avail cash hl=",
    availCashHL,
    "avail positionValue hl=",
    availPosValHL
  );

  const { closePosUsd, fromCash, shortage } = splitHLWithdrawal({
    totalUsd,
    cashUsd,
    positionValue,
    marginUsed,
    effLev,
    targetRatio: 0.2,
    withdrawUsd: neededUsdcHL,
  });

  console.log(
    "Close position:",
    closePosUsd,
    "Withdraw from Cash: ",
    fromCash,
    "Shortage: ",
    shortage
  );

  function pctFromNotional(closePosUsd, positionValue) {
    if (
      !Number.isFinite(closePosUsd) ||
      !Number.isFinite(positionValue) ||
      positionValue <= 0
    )
      return 0;
    const pct = (closePosUsd / positionValue) * 100;
    return Math.max(0, Math.min(100, Number(pct.toFixed(4))));
  }

  const closePct = pctFromNotional(closePosUsd, positionValue);

  console.log(
    `→ Close ${closePct}% of HL position (≈ $${closePosUsd.toFixed(
      2
    )} notional), fromCash=${fromCash.toFixed(2)}, shortage=${shortage.toFixed(
      2
    )}`
  );

  // If you want the close to actually run, uncomment:
  if (closePct > 0) {
    await step1_closeHL(closePct);
  } else {
    console.log(
      "No HL close needed (cash covers withdraw and ratio within band)."
    );
  }

  return { neededUsdcDrift, neededUsdcHL };
}

/** ---------- Orchestration ---------- */
async function main() {
  const stage = getArg("stage", "init");
  //const stage = getArg("stage", "finalize");
  console.log(">>> PIPELINE START");
  console.log(">>> __filename:", __filename);
  console.log(">>> cwd:", process.cwd());
  console.log(">>> argv:", process.argv.slice(2));
  console.log(">>> Stage =", stage);

  const reqId = getArg("reqId", `req_${Date.now()}`);
  console.log(reqId);

  if (stage === "init") {
    console.log("Starting the withdrawal process");

    if (!(usdcHuman > 0)) {
      console.error("Provide --usdc=<amount>, e.g., --usdc=123.45");
      process.exit(1);
    }

    console.log("USDC needed:", usdcHuman);

    const { neededUsdcDrift, neededUsdcHL } = await withdrawPerProtocol(
      usdcHuman
    );

    console.log("Withdraw needed from Drift: ", neededUsdcDrift);
    console.log("Withdraw needed from HL: ", neededUsdcHL);

    await step2_requestWithdrawDrift(neededUsdcDrift);
    await step4_withdrawHL(neededUsdcHL);

    await runRunner("init", {
      reqId,
      hours: process.env.REDEMPTION_DRIFT || 25,
      note: "drift+hl withdraw",
    });

    console.log(`📝 scheduled finalize for ${reqId}`);
    console.log("INIT stage done.");
    return;
  }

  if (stage === "finalize") {
    await step3_finalizeWithdrawDrift();

    // Read live balances
    const solRpc = process.env.SOLANA_RPC;
    const solOwner = process.env.DRIFT_VAULT_AUTHORITY; // Solana pubkey that receives USDC
    const usdcMintSol =
      process.env.USDC_MINT_SOL ||
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

    const solUsdc = await readSplBalance({
      rpc: solRpc,
      owner: solOwner,
      mint: usdcMintSol,
    });

    console.log("Balance on Solana wallet: ", solUsdc);

    // (Keep post-finalize steps commented until you wire exact amounts)
    // const neededUsdcDrift = 8;
    const neededUsdcDrift = solUsdc;
    await step5_bridgeSolanaToArbitrum(neededUsdcDrift, {
      evmPk: process.env.PK_RECIPIENT_A,
      to: process.env.WALLET_RECIPIENT_A,
    });

    // Read balances Arbitrum
    const arbRpc = process.env.ARBITRUM_ALCHEMY_MAINNET;
    const usdcArb =
      process.env.USDC_ADDRESS || "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
    const walletA = process.env.WALLET_RECIPIENT_A; // bridge destination
    const walletB = process.env.WALLET_RECIPIENT_B; // HL withdraw destination

    const arbUsdcA = await readErc20Balance({
      rpc: arbRpc,
      token: usdcArb,
      wallet: walletA,
    });
    const arbUsdcB = await readErc20Balance({
      rpc: arbRpc,
      token: usdcArb,
      wallet: walletB,
    });

    console.log("USDC on wallet A: ", arbUsdcA);
    console.log("USDC on wallet B: ", arbUsdcB);

    await step6_sendUSDC_A_to_owner(arbUsdcA);
    await step7_sendUSDC_B_to_owner(arbUsdcB);

    const OWNER_ADDRESS = process.env.WALLET_ADDRESS;
    const VAULT_ADDRESS = process.env.VAULT_ADDRESS;

    console.log("OWNER_ADDRESS: ", OWNER_ADDRESS);
    console.log("VAULT_ADDRESS: ", VAULT_ADDRESS);

    const arbUsdcOwner = await readErc20Balance({
      rpc: arbRpc,
      token: usdcArb,
      wallet: OWNER_ADDRESS,
    });
    console.log("USDC to swap on Arbitrum: ", arbUsdcOwner);

    //const arbUsdcOwner = neededUsdcDrift + neededUsdcHL;
    await step8_swapUSDCtoWBTC(arbUsdcOwner, {
      to: VAULT_ADDRESS,
      //to: OWNER_ADDRESS,
      slippage: 75,
    });

    console.log("FINALIZE stage done.");
    return;
  }

  throw new Error(
    `Unknown --stage=${stage}. Use --stage=init or --stage=finalize`
  );
}

main().catch((err) => {
  console.error("❌ Pipeline failed:", err);
  process.exit(1);
});
