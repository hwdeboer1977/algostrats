// backend/keeper/withdrawPipeline.js
// CommonJS version – no "type": "module" required
const { spawn } = require("child_process");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const { ethers } = require("ethers");

/** ---------- Config: absolute paths to your scripts ---------- */
const P = {
  HL_CREATE_ORDERS:
    "C:\\Users\\hwdeb\\Documents\\blockstat_solutions_github\\Algostrats\\tools\\hyperliquid\\create_orders.py",
  DRIFT_REQUEST_WD:
    "C:\\Users\\hwdeb\\Documents\\blockstat_solutions_github\\Algostrats\\tools\\drift\\request_withdraw.mjs",
  HL_WITHDRAW:
    "C:\\Users\\hwdeb\\Documents\\blockstat_solutions_github\\Algostrats\\tools\\hyperliquid\\withdraw_HL.py",
  LIFI_BRIDGE:
    "C:\\Users\\hwdeb\\Documents\\blockstat_solutions_github\\Algostrats\\tools\\bridge\\lifi_bridge_sol.cjs",
  SEND_USDC_JS:
    "C:\\Users\\hwdeb\\Documents\\blockstat_solutions_github\\Algostrats\\backend\\keeper\\send_usdc.js",
  SEND_USDC_PY:
    "C:\\Users\\hwdeb\\Documents\\blockstat_solutions_github\\Algostrats\\tools\\hyperliquid\\send_usdc.py",
  SWAP_USDC_WBTC:
    "C:\\Users\\hwdeb\\Documents\\blockstat_solutions_github\\Algostrats\\tools\\swap\\swap_usdc_to_wbtc.js",
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

function getArg(name, def = undefined) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((a) => a.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : def;
}

/** ---------- CLI flags we will need ----------

--stage=init | finalize

HL close (step 1): python create_orders.py close coin=ETH pct=10
--coin=ETH --pct=10         
--coin=ETH --close_size=0.003
--coin=ETH --pct=10 close_slippage=0.005

Drift step 2:
-- node request_withdraw_by_usdc.mjs --usdc 5 --vault-address <VAULT> --authority <YOU>

Drift step 3:
-- node vaultNews.mjs withdraw --vault-depositor-address --vault-address --authority

Bridge:
-- node lifi_bridge_arb.cjs --amount 5

HL Withdraw:
-- python withdraw_HL.py <amountUSDC>

 
Send amount USDC wallet B -> vault
-- node send_usdc.js --amount

Send amount USDC wallet B -> vault
-- python send_usdc.py --amount          

Swap (step 8):
-- node swap_usdc_to_wbtc.js <amount>
---------------------------------------------------------------- */

// Close a position on Hyperliquid, default 10%
// Pass closePct explicitly, or override via --closePct / --closeSize in CLI
const closePctInput = 100;
async function step1_closeHL(closePct = closePctInput) {
  const coin = getArg("coin", "ETH");
  const cliPct = getArg("closePct"); // optional CLI override
  const size = getArg("closeSize"); // alternative: absolute size
  const slip = getArg("closeSlippage", "0.01");

  // Use CLI pct if given, else function arg
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

async function step2_requestWithdrawDrift() {
  // Adjust flags to what your request_withdraw.mjs expects
  const amount = getArg("driftAmount", "all");
  const mode = getArg("driftMode", "partial"); // or 'full'
  console.log("▶ Step 2: Drift request withdraw…");
  await run("node", [
    P.DRIFT_REQUEST_WD,
    "--action=request",
    `--amount=${amount}`,
    `--mode=${mode}`,
  ]);
}

async function step3_finalizeWithdrawDrift() {
  console.log("▶ Step 3: Drift finalize withdraw (after redemption delay)…");
  await run("node", [P.DRIFT_REQUEST_WD, "--action=finalize"]);
}

// Withdraw a specific amount (USDC) from Hyperliquid to the EOA.
// amountHL: number|string  -> required (HL min is 5 USDC per your script)
// opts: { pk?, dest?, config?, noWait?, testnet? }
async function step4_withdrawHL(amountHL, opts = {}) {
  if (amountHL == null) {
    throw new Error("step4_withdrawHL: amountHL is required (e.g., 100)");
  }
  const args = [
    P.HL_WITHDRAW, // path to withdraw_HL.py
    String(amountHL), // <-- FIRST positional arg
  ];

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

// Bridge USDC from Solana → Arbitrum using LiFi
// amount: string|number (e.g. "100" or "all")
async function step5_bridgeSolanaToArbitrum(amount) {
  if (amount == null)
    throw new Error("step5_bridgeSolanaToArbitrum: amount is required");
  const script = P.LIFI_BRIDGE; // points to ...\tools\bridge\lifi_bridge_arb.cjs
  console.log("▶ Step 5:", ["node", script, String(amount)].join(" "));
  await run("node", [script, String(amount)], { cwd: path.dirname(script) });
}

// Step 6: Send USDC from wallet A to vault
// Prefer function arg > CLI (--sendA=) > env (AMOUNT) > default (omit -> script default)
async function step6_sendUSDC_A_to_vault(amountA = undefined, opts = {}) {
  const amountFromCli = getArg("sendA"); // e.g. --sendA=2
  const amount = amountA ?? amountFromCli ?? process.env.AMOUNT ?? null;

  const args = [P.SEND_USDC_JS];
  if (amount !== null) args.push(String(amount)); // <-- POSitional, not --amount=2
  if (opts.to) args.push(`--to=${opts.to}`);

  const env = { ...process.env };
  if (amount !== null) env.AMOUNT = String(amount); // belt & suspenders
  console.log(
    `▶ Step 6: Send USDC A${amount !== null ? ` (amount=${amount})` : ""}…`
  );

  await run("node", args, { env, cwd: path.dirname(P.SEND_USDC_JS) });
}

// Step 7: Send USDC from wallet B to vault
// Prefers function arg > CLI (--sendB=) > env AMOUNT
async function step7_sendUSDC_B_to_vault(amountB = undefined, opts = {}) {
  const amountFromCli = getArg("sendB"); // e.g. --sendB=2
  const amount = amountB ?? amountFromCli ?? process.env.AMOUNT ?? null;

  const args = [P.SEND_USDC_PY];
  if (amount !== null) args.push(String(amount)); // positional for Python script
  if (opts.to) args.push(`--to=${opts.to}`); // if your py script supports --to

  const env = { ...process.env };
  if (amount !== null) env.AMOUNT = String(amount); // extra safety

  console.log(
    `▶ Step 7: Send USDC from wallet B to vault${
      amount !== null ? ` (amount=${amount})` : ""
    }…`
  );
  await run("python", args, { env, cwd: path.dirname(P.SEND_USDC_PY) });
}

// Step 8: Uniswap swap USDC -> WBTC
// Prefer function arg; fall back to CLI (--swapAmount=) if you want.
async function step8_swapUSDCtoWBTC(amountSwap = undefined, opts = {}) {
  const amountFromCli = getArg("swapAmount"); // optional CLI: --swapAmount=2
  const amount = amountSwap ?? amountFromCli ?? null;
  if (amount == null) {
    console.log(
      "▶ Step 8: No amount provided; skipping swap to avoid accidental default."
    );
    return;
  }

  const args = [P.SWAP_USDC_WBTC, String(amount)]; // <-- positional arg
  // If your swap script supports flags, you *may* also add: args.push(`--amount=${amount}`);
  if (opts.slippage) args.push(`--slippage=${opts.slippage}`);
  if (opts.to) args.push(`--to=${opts.to}`);

  const env = { ...process.env, AMOUNT: String(amount) }; // backup for scripts that read env

  console.log(`▶ Step 8: Uniswap swap USDC -> WBTC (amount=${amount})…`);
  await run("node", args, { env, cwd: path.dirname(P.SWAP_USDC_WBTC) });
}

/** ---------- Orchestration ---------- */
async function main() {
  const stage = getArg("stage", "init"); // 'init' or 'finalize'

  if (stage === "init") {
    // You can reorder or omit steps based on your live flow.
    // HL close position
    //await step1_closeHL();

    // Initiate Drift withdrawal STILL TO TEST!!
    //await step2_requestWithdrawDrift();

    // HL withdrawal
    // const amountHL = 10;
    // await step4_withdrawHL(amountHL);

    console.log("✅ INIT stage done.");
    return;
  }

  if (stage === "finalize") {
    // Bridge from Solana to Arbitrum
    //const amountBridge = 6;
    //await step5_bridgeSolanaToArbitrum(amountBridge);

    // Send USDC from wallet A and B
    //const amountA = 2;
    //await step6_sendUSDC_A_to_vault(amountA);
    //const amountB = 2;
    //await step7_sendUSDC_B_to_vault(amountB);

    // Swap to wBTC on Uniswap
    // const amountSwap = 2;
    // await step8_swapUSDCtoWBTC(amountSwap);
    console.log("✅ FINALIZE stage done.");
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
