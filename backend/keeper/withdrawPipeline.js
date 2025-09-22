// backend/keeper/withdrawPipeline.js
// CommonJS version – no "type": "module" required
const { spawn } = require("child_process");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const { ethers } = require("ethers");

/** ---------- Config: absolute paths to your scripts ---------- */
const P = {
  HL_CREATE_ORDERS:
    //"C:\\Users\\hwdeb\\Documents\\blockstat_solutions_github\\Algostrats\\tools\\hyperliquid\\create_orders.py",
    path.resolve(__dirname, "../../tools/hyperliquid/create_orders.py"),
  DRIFT_REQUEST_WD:
    // "C:\\Users\\hwdeb\\Documents\\blockstat_solutions_github\\Algostrats\\tools\\drift\\request_withdraw.mjs",
    path.resolve(__dirname, "../../tools/drift/request_withdraw.mjs"),
  DRIFT_WD:
    // "C:\\Users\\hwdeb\\Documents\\blockstat_solutions_github\\Algostrats\\tools\\drift\\vaultNew.mjs",
    path.resolve(__dirname, "../../tools/drift/vaultNew.mjs"),
  HL_WITHDRAW:
    // "C:\\Users\\hwdeb\\Documents\\blockstat_solutions_github\\Algostrats\\tools\\hyperliquid\\withdraw_HL.py",
    path.resolve(__dirname, "../../tools/hyperliquid/withdraw_HL.py"),
  LIFI_BRIDGE:
    // "C:\\Users\\hwdeb\\Documents\\blockstat_solutions_github\\Algostrats\\tools\\bridge\\lifi_bridge_sol.cjs",
    path.resolve(__dirname, "../../tools/bridge/lifi_bridge_sol.cjs"), // <-- ensure filename matches your actual file
  SEND_USDC_JS:
    // "C:\\Users\\hwdeb\\Documents\\blockstat_solutions_github\\Algostrats\\backend\\keeper\\send_usdc.js",
    path.resolve(__dirname, "../../backend/keeper/send_usdc.js"),
  SEND_USDC_PY:
    // "C:\\Users\\hwdeb\\Documents\\blockstat_solutions_github\\Algostrats\\tools\\hyperliquid\\send_usdc.py",
    path.resolve(__dirname, "../../tools/hyperliquid/send_usdc.py"),
  SWAP_USDC_WBTC:
    // "C:\\Users\\hwdeb\\Documents\\blockstat_solutions_github\\Algostrats\\tools\\swap\\swap_usdc_to_wbtc.js",
    path.resolve(__dirname, "../../tools/swap/swap_usdc_to_wbtc.js"),
};

// ❌ removed the stray expression line that broke parsing:
// path.resolve(__dirname, "../../tools/swap/swap_wbtc_to_usdc.cjs"),

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

function getArg(name, def = undefined) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((a) => a.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : def;
}

/** ---------- CLI flags we will need ----------
--stage=init | finalize
... (your comment block unchanged)
---------------------------------------------------------------- */

// Close a position on Hyperliquid, default 10%
// Pass closePct explicitly, or override via --closePct / --closeSize in CLI
const closePctInput = 100;
async function step1_closeHL(closePct = closePctInput) {
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

async function step3_finalizeWithdrawDrift() {
  console.log("▶ Step 3: Drift finalize withdraw (after redemption delay)…");
  const args = [P.DRIFT_WD, "withdraw"];
  console.log(
    "   node",
    args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")
  );
  await run("node", args, { cwd: path.dirname(P.DRIFT_WD) }); // <-- fixed reference
}

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

async function step5_bridgeSolanaToArbitrum(amount) {
  if (amount == null)
    throw new Error("step5_bridgeSolanaToArbitrum: amount is required");
  const script = P.LIFI_BRIDGE;
  console.log("▶ Step 5:", ["node", script, String(amount)].join(" "));
  await run("node", [script, String(amount)], { cwd: path.dirname(script) });
}

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
  //const stage = getArg("stage", "init"); // 'init' or 'finalize'
  const stage = getArg("stage", "finalize"); // 'init' or 'finalize'

  if (stage === "init") {
    // await step1_closeHL();

    // const amountDrift = 5;
    // await step2_requestWithdrawDrift(amountDrift);

    // const amountHL = 10;
    // await step4_withdrawHL(amountHL);

    console.log("INIT stage done.");
    return;
  }

  if (stage === "finalize") {
    await step3_finalizeWithdrawDrift();
    // const amountBridge = 6;
    // await step5_bridgeSolanaToArbitrum(amountBridge);
    // const amountA = 2;
    // await step6_sendUSDC_A_to_vault(amountA);
    // const amountB = 2;
    // await step7_sendUSDC_B_to_vault(amountB);
    // const amountSwap = 2;
    // await step8_swapUSDCtoWBTC(amountSwap);

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
