// backend/keeper/withdrawPipeline.js
// CommonJS version – no "type": "module" required
const { spawn } = require("child_process");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const { ethers } = require("ethers");
const { runPython } = require("./python_runner.js");
const fs = require("fs");

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
    "../../tools/bridge/lifi_bridge_sol.cjs"
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

// Function to get arguments
function getArg(name, def = undefined) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((a) => a.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : def;
}

// read args
//const stage = getArg("stage", "init"); // "--stage=init"
const usdcHuman = getArg("usdc"); // "--usdc=123.45" (string or undefined)

// run a Node script and capture stdout
function runNode(file, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
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

// Helper to keep track of time after withdraw is initiated
// After 25 hours, finalization of withdrawal will start
const STATE_FILE = path.join(__dirname, ".withdraw_state.json");

function saveInitTimestamp(data = {}) {
  const payload = { startedAt: Date.now(), ...data };
  fs.writeFileSync(STATE_FILE, JSON.stringify(payload, null, 2));
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return null;
  }
}

// Detach a tiny Node process that sleeps 25h, then runs finalize.
// Works on Windows & *nix. Parent can exit safely.
const SCRIPT = path.resolve(__filename);

function scheduleFinalizeAfterHours(
  hours = process.env.REDEMPTION_DRIFT,
  visible = false
) {
  const delayMs = Math.round(hours * 60 * 60 * 1000);

  const code = `
    setTimeout(() => {
      const { spawn } = require('child_process');
      spawn(process.execPath, [${JSON.stringify(SCRIPT)}, '--stage=finalize'], {
        cwd: ${JSON.stringify(__dirname)},
        stdio: ${visible ? "'inherit'" : "'ignore'"},
        detached: ${visible ? "false" : "true"}
      })${visible ? "" : ".unref()"};
    }, ${delayMs});
  `;

  spawn(process.execPath, ["-e", code], {
    cwd: __dirname,
    stdio: visible ? "inherit" : "ignore",
    detached: !visible,
  })[visible ? "on" : "unref"]?.("close", () => {});
}

// Helper that we can call anywhere to see time left
function hoursLeft() {
  const st = readState();
  if (!st?.startedAt) return null;
  const elapsed = Date.now() - st.startedAt;
  const total = 25 * 60 * 60 * 1000;
  return Math.max(0, (total - elapsed) / (1000 * 60 * 60));
}

// Get balance of USDC in Drift's vault
function parseBalanceUsd(text) {
  const m = /Balance\s*\(USD\)\s*:\s*([-\d.,]+)/i.exec(text);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

// Get balance and positions Hyperliquid
// put near your other utils
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

// --- NEW: single helper to collect both numbers ---
async function readPositions() {
  const driftScript = path.resolve(
    __dirname,
    "../../tools/drift/read_position_info.mjs"
  );
  const driftOut = await runNode(driftScript, []);
  const balanceUsd = parseBalanceUsd(driftOut);

  const hlRes = await runPython("summary");
  const hlStdout =
    hlRes && typeof hlRes.stdout === "string" ? hlRes.stdout : "";

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
// policy “keep margin ratio = same% after the withdraw.”
function splitHLWithdrawal({
  totalUsd, // E
  cashUsd, // C
  positionValue, // PV (used only to cap)
  marginUsed, // M0  <-- add this
  effLev, // L
  targetRatio, // r
  withdrawUsd, // W
}) {
  const E = totalUsd,
    C = cashUsd,
    PV = positionValue,
    M0 = marginUsed;
  const L = effLev || 10,
    r = targetRatio,
    W = withdrawUsd;

  for (const [k, v] of Object.entries({ E, C, PV, M0, L, r, W })) {
    if (!Number.isFinite(v))
      throw new Error(`splitHLWithdrawal: bad ${k}=${v}`);
  }
  if (W > E + 1e-9) throw new Error(`withdraw ${W} > total ${E}`);

  // Target margin after withdraw: r * (E - W)
  const Mtarget = r * (E - W);
  const needRatio = Math.max(0, M0 - Mtarget); // margin to release for ratio
  const needCash = Math.max(0, W - C); // margin to release for cash deficit
  const deltaM = Math.max(needRatio, needCash);

  // Close notional equal to margin to release * leverage, capped by current notional
  const closePosUsd = Math.min(PV, deltaM * L);
  const fromCash = Math.min(W, C);
  const freedCash = closePosUsd / L;
  const shortage = Math.max(0, W - (fromCash + freedCash));

  return { closePosUsd, fromCash, shortage };
}

/** ---------- CLI flags we will need ----------
--stage=init | finalize
... (your comment block unchanged)
---------------------------------------------------------------- */

// Step 1: Close a position on Hyperliquid, default 10%
// Pass closePct explicitly, or override via --closePct / --closeSize in CLI
// const closePctInput = 100;
// async function step1_closeHL(closePct = closePctInput) {
async function step1_closeHL(closePct) {
  const coin = getArg("coin", "ETH");
  const cliPct = getArg("closePct"); // optional CLI override
  const size = getArg("closeSize"); // alternative: absolute size
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

// Function to request/Initiate withdraw from Drift (24 hour redemption period)
async function step2_requestWithdrawDrift(amountDrift) {
  const amount = amountDrift;
  const driftVault = process.env.DRIFT_VAULT_ADDRESS;
  const driftAuthority = process.env.DRIFT_VAULT_AUTHORITY;
  console.log("▶ Step 2: Drift request withdraw…");
  const args = [
    P.DRIFT_REQUEST_WD,
    "--usdc",
    amount,
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

// Function to finalize the withdrawal from Drift (after 24 hours)
async function step3_finalizeWithdrawDrift() {
  console.log("▶ Step 3: Drift finalize withdraw (after redemption delay)…");
  const args = [P.DRIFT_WD, "withdraw"];
  console.log(
    "   node",
    args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")
  );
  await run("node", args, { cwd: path.dirname(P.DRIFT_WD) }); // <-- fixed reference
}

// Function ot withdraw USDC from Hyperliquid
async function step4_withdrawHL(amountHL, opts = {}) {
  if (amountHL == null)
    throw new Error("step4_withdrawHL: amountHL is required (e.g., 100)");
  const args = [P.HL_WITHDRAW, String(amountHL)];
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

// Function to bridge back from Solana to Arbitrum
async function step5_bridgeSolanaToArbitrum(amount) {
  if (amount == null)
    throw new Error("step5_bridgeSolanaToArbitrum: amount is required");
  const script = P.LIFI_BRIDGE;
  console.log("▶ Step 5:", ["node", script, String(amount)].join(" "));
  await run("node", [script, String(amount)], { cwd: path.dirname(script) });
}

// Function to send USDC from wallet A to the vault
async function step6_sendUSDC_A_to_vault(amountA = undefined, opts = {}) {
  const amountFromCli = getArg("sendA");
  const amount = amountA ?? amountFromCli ?? process.env.AMOUNT ?? null;

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

// Function to send USDC from wallet B to the vault
async function step7_sendUSDC_B_to_vault(amountB = undefined, opts = {}) {
  const amountFromCli = getArg("sendB");
  const amount = amountB ?? amountFromCli ?? process.env.AMOUNT ?? null;

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

// Function to swap back from USDC to wBTC
async function step8_swapUSDCtoWBTC(amountSwap = undefined, opts = {}) {
  const amountFromCli = getArg("swapAmount");
  const amount = amountSwap ?? amountFromCli ?? null;
  if (amount == null) {
    console.log(
      "▶ Step 8: No amount provided; skipping swap to avoid accidental default."
    );
    return;
  }

  const args = [P.SWAP_USDC_WBTC, String(amount)];
  if (opts.slippage) args.push(`--slippage=${opts.slippage}`);
  if (opts.to) args.push(`--to=${opts.to}`);

  const env = { ...process.env, AMOUNT: String(amount) };
  console.log(`▶ Step 8: Uniswap swap USDC -> WBTC (amount=${amount})…`);
  await run("node", args, { env, cwd: path.dirname(P.SWAP_USDC_WBTC) });
}

/** ---------- Orchestration ---------- */
async function main() {
  const stage = getArg("stage", "init"); // 'init' or 'finalize'
  //const stage = getArg("stage", "finalize"); // ''init' or 'finalize'

  // Keep track of hours left (for redemption)
  const hLeft = hoursLeft();
  if (hLeft !== null) {
    console.log(`⏳ Auto-finalize ETA: ${hLeft.toFixed(2)} hours`);
  }

  // Initial stage
  if (stage === "init") {
    console.log("Starting the withdrawal process");

    if (!usdcHuman) {
      console.error("Provide --usdc=<human>");
      process.exit(1);
    }

    // Optional: guard to avoid scheduling multiple timers if one is pending
    const existing = readState();
    if (existing?.startedAt) {
      console.log(
        "⚠️ Withdraw already scheduled; overwriting previous schedule."
      );
    }

    // Record start + any context you want to reuse later
    saveInitTimestamp({ usdcHuman });

    // Fire-and-forget timer to auto-run finalize in 25h
    scheduleFinalizeAfterHours(process.env.REDEMPTION_DRIFT, true);

    console.log("⏳ Withdraw initiated. Auto-finalize scheduled in ~25 hours.");

    // Amount of USDC needed
    console.log("USDC needed:", usdcHuman);

    // Shares to take out of protocols
    const SHARE_DRIFT = process.env.SHARE_DRIFT;
    const SHARE_HL = process.env.SHARE_HL;

    // Read current positions/balances (Drift + HL)
    const {
      balanceUsd, // Balance USD in Drift vault
      totalUsd, // Total balance USD in HL
      cashUsd, // Total available USD in HL
      posPNL, // Unrealized PNL
      positionValue, // Position value
      marginUsed, // Margin used = positionValue/leverage
      effLev, // leverage
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

    // Calculate amount USDC per protocol
    const neededUsdcDrift = usdcHuman * SHARE_DRIFT;
    const neededUsdcHL = usdcHuman * SHARE_HL;

    // Available balances (from readers above)
    const availDrift = Number(balanceUsd ?? 0); // Drift "Balance (USD)"
    const availTotalHL = Number(totalUsd ?? 0); // HL "total_usd"
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

    // If the vault is at a loss ==> share price is lower so user gets less wBTC
    // It may never be the case that a user tries to withdraw 'too much' USDC
    const { closePosUsd, fromCash, shortage } = splitHLWithdrawal({
      totalUsd,
      cashUsd,
      positionValue,
      marginUsed, // <-- pass this
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

    // turn USD-notional into percentage of current position
    function pctFromNotional(closePosUsd, positionValue) {
      if (
        !Number.isFinite(closePosUsd) ||
        !Number.isFinite(positionValue) ||
        positionValue <= 0
      )
        return 0;
      const pct = (closePosUsd / positionValue) * 100;
      // clamp and round a bit for CLI
      return Math.max(0, Math.min(100, Number(pct.toFixed(4))));
    }

    const closePct = pctFromNotional(closePosUsd, positionValue);

    console.log(
      `→ Close ${closePct}% of HL position (≈ $${closePosUsd.toFixed(
        2
      )} notional), fromCash=${fromCash.toFixed(
        2
      )}, shortage=${shortage.toFixed(2)}`
    );

    if (closePct > 0) {
      //await step1_closeHL(closePct); // your existing function
    } else {
      console.log(
        "No HL close needed (cash covers withdraw and ratio within band)."
      );
    }

    // Request withdraw Drift
    await step2_requestWithdrawDrift(neededUsdcDrift);

    // Withdraw from HL
    await step4_withdrawHL(neededUsdcHL);

    console.log("INIT stage done.");
    return;
  }

  // Stage 2: Finalize (after redemption period)
  if (stage === "finalize") {
    await step3_finalizeWithdrawDrift();
    // const amountBridge = 6;
    await step5_bridgeSolanaToArbitrum(neededUsdcDrift);
    // const amountA = 2;
    await step6_sendUSDC_A_to_vault(neededUsdcDrift);
    // const amountB = 2;
    await step7_sendUSDC_B_to_vault(neededUsdcHL);
    const amountSwap = neededUsdcDrift + neededUsdcHL;
    await step8_swapUSDCtoWBTC(amountSwap);

    console.log("FINALIZE stage done.");

    try {
      fs.unlinkSync(STATE_FILE);
    } catch {}

    return;
  }

  throw new Error(
    `Unknown --stage=${stage}. Use --stage=calc --stage=init or --stage=finalize`
  );
}

main().catch((err) => {
  console.error("❌ Pipeline failed:", err);
  process.exit(1);
});
