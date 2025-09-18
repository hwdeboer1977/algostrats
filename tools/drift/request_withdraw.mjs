// request_withdraw.mjs
// Usage:
//   node request_withdraw.mjs --usdc 5 --vault-address <VAULT> --authority <YOU>
//   node request_withdraw.mjs --usdc 5 --vault-address A1B9MVput3r1jS91iu8ckdDiMSugXbQeEtvJEQsUHsPi --authority BepvrzsLkmEF2ZwotqEsY8fKbCzQDaB228nPzfSirQDs
//
// What it does:
// - Runs read_position_info.mjs to get vaultEquity (base units), Your/Total shares
// - Computes USDC/share, converts --usdc to shares (ceil)
// - Calls: node vaultNew.mjs request-withdraw --amount <shares> (shares)

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Config (edit if your deposit token isn't USDC) ---
const DECIMALS = 6; // USDC on Solana

// Paths to your local scripts (same dir)
const READER = path.resolve(__dirname, "read_position_info.mjs");
const VAULT = path.resolve(__dirname, "vaultNew.mjs");

// --- CLI args ---
const args = process.argv.slice(2);
function getArg(name, alias) {
  const i = args.findIndex((a) => a === name || (alias && a === alias));
  if (i >= 0) return args[i + 1];
  // also support --name=value
  const kv = args.find(
    (a) => a.startsWith(name + "=") || (alias && a.startsWith(alias + "="))
  );
  if (kv) return kv.split("=").slice(1).join("=");
  return null;
}
function hasArg(name) {
  return args.some((a) => a === name || a.startsWith(name + "="));
}

const targetUsdcStr = getArg("--usdc", "-u");
const vaultAddress = getArg("--vault-address", "-v");
const authority = getArg("--authority", "-a");
const skipPref = hasArg("--skip-preflight");

if (!targetUsdcStr || !vaultAddress || !authority) {
  console.error(
    "Usage: node request_withdraw_by_usdc.mjs --usdc <NUM> --vault-address <VAULT> --authority <YOU> [--skip-preflight]"
  );
  process.exit(1);
}

const targetUsdc = Number(targetUsdcStr);
if (!Number.isFinite(targetUsdc) || targetUsdc <= 0) {
  console.error("❌ --usdc must be a positive number");
  process.exit(1);
}

// --- helpers ---
function runNode(scriptPath, params = []) {
  return new Promise((resolve, reject) => {
    const cmd = process.platform === "win32" ? "node.exe" : "node";
    const child = spawn(cmd, [scriptPath, ...params], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
      env: process.env,
    });
    let out = "",
      err = "";
    child.stdout.on("data", (c) => (out += c.toString()));
    child.stderr.on("data", (c) => (err += c.toString()));
    child.on("close", (code) => {
      if (code === 0) return resolve(out);
      // Some scripts print to stderr but still give useful output
      if (out) return resolve(out);
      reject(new Error(err || `Process failed with code ${code}`));
    });
  });
}

// Try to parse either:
// 1) vaultEquity (USDC, base units): 1648750006821
//    Your shares / Total shares   : 110036549 / 902900108386
// OR fall back to:
//    Balance (USD) : 200.933369
//    Your shares   : 110036549
function parseReaderOutput(text) {
  const lines = text.split(/\r?\n/);

  let vaultEquityBase = null;
  let yourShares = null;
  let totalShares = null;
  let balanceUsd = null;

  for (const L of lines) {
    if (/vaultEquity.*base units/i.test(L)) {
      const m = /:\s*([0-9][0-9, ]*)/i.exec(L);
      if (m) vaultEquityBase = Number(m[1].replace(/[, ]/g, ""));
    } else if (/Your shares\s*\/\s*Total shares/i.test(L)) {
      const m = /:\s*([0-9][0-9, ]*)\s*\/\s*([0-9][0-9, ]*)/i.exec(L);
      if (m) {
        yourShares = Number(m[1].replace(/[, ]/g, ""));
        totalShares = Number(m[2].replace(/[, ]/g, ""));
      }
    } else if (/Balance\s*\(USD\)/i.test(L)) {
      const m = /:\s*([0-9.]+)/i.exec(L);
      if (m) balanceUsd = Number(m[1]);
    } else if (/Your shares\s*:/i.test(L) && yourShares == null) {
      const m = /:\s*([0-9][0-9, ]*)/i.exec(L);
      if (m) yourShares = Number(m[1].replace(/[, ]/g, ""));
    }
  }

  // Compute price/share
  let pricePerShare = null;

  // Primary: equity/totalShares
  if (vaultEquityBase != null && totalShares) {
    const equityUsdc = vaultEquityBase / 10 ** DECIMALS;
    pricePerShare = equityUsdc / totalShares;
  }
  // Fallback: balanceUSD/yourShares
  if (
    (pricePerShare == null || !isFinite(pricePerShare)) &&
    balanceUsd != null &&
    yourShares
  ) {
    pricePerShare = balanceUsd / yourShares;
  }

  return {
    vaultEquityBase,
    yourShares,
    totalShares,
    balanceUsd,
    pricePerShare,
  };
}

function ceilDiv(a, b) {
  return Math.ceil(a / b);
}

async function main() {
  console.log("🔎 Reading vault stats from read_position_info.mjs ...");
  const readerOut = await runNode(READER, []);
  const stats = parseReaderOutput(readerOut);

  if (
    !stats.pricePerShare ||
    !isFinite(stats.pricePerShare) ||
    stats.pricePerShare <= 0
  ) {
    console.log(readerOut); // show raw for debugging
    throw new Error("Could not determine price per share from reader output.");
  }

  const sharesNeeded = ceilDiv(targetUsdc, stats.pricePerShare);

  console.log(
    `\n✅ Price/share: ${stats.pricePerShare.toFixed(12)} USDC/share`
  );
  if (stats.totalShares) {
    console.log(`Total shares: ${stats.totalShares.toLocaleString()}`);
  }
  if (stats.yourShares) {
    console.log(`Your shares : ${stats.yourShares.toLocaleString()}`);
  }
  console.log(`Requesting  ${targetUsdc} USDC -> ${sharesNeeded} shares\n`);

  // Build args for your vault wrapper
  const rwArgs = [
    "request-withdraw",
    "--vault-address",
    vaultAddress,
    "--authority",
    authority,
    "--amount",
    String(sharesNeeded),
  ];
  if (skipPref) rwArgs.push("--skip-preflight");

  console.log(
    "🚀 Calling vaultNew.mjs:",
    ["request-withdraw", `--amount ${sharesNeeded}`].join(" ")
  );
  const out = await runNode(VAULT, rwArgs);
  process.stdout.write(out);
  console.log("\nℹ️  After the redeem delay, run:");
  console.log(
    `    node vaultNew.mjs withdraw --vault-address ${vaultAddress} --authority ${authority}${
      skipPref ? " --skip-preflight" : ""
    }`
  );
}

main().catch((e) => {
  console.error("\n❌", e.message || e);
  process.exit(1);
});
