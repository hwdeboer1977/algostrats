// read_position_info.mjs
// Snapshot a Drift Vault: equity (scraped from your CLI wrapper output), shares, depositor balance,
// net deposits, earnings, ROI. Safe for Node 18/20/22 (ESM).
//
// Usage:
//   node read_position_info.mjs
//
// Requirements:
// - ./vaultNew.mjs in the same folder (your wrapper).
// - .env at ../../.env with at least: SOLANA_RPC (or RPC_URL)
// - Optionally DRIFT_VAULT_ADDRESS and DRIFT_VAULT_DEPOSITOR

import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import dotenv from "dotenv";
import { Connection, PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import pkg from "@drift-labs/vaults-sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env two levels up (Algostrats/.env)
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const { getDriftVaultProgram, VAULT_PROGRAM_ID } = pkg;
const execFileP = promisify(execFile);

// --- Config (addresses) ---
const RPC_URL = process.env.SOLANA_RPC || process.env.RPC_URL;
if (!RPC_URL) {
  throw new Error("Missing SOLANA_RPC (or RPC_URL) in .env");
}

const VAULT_ADDRESS = new PublicKey(
  process.env.DRIFT_VAULT_ADDRESS ||
    "A1B9MVput3r1jS91iu8ckdDiMSugXbQeEtvJEQsUHsPi"
);

const DEPOSITOR_ADDRESS = new PublicKey(
  process.env.DRIFT_VAULT_DEPOSITOR ||
    "HAV28fu2797q662tZEjETQg1MmoLZjd8CGLejzuMJJuy"
);

// Path to your wrapper CLI (same folder)
const CLI_PATH = path.resolve(__dirname, "./vaultNew.mjs");

// ---------- Helpers ----------
const toBigInt = (x) =>
  typeof x === "bigint"
    ? x
    : typeof x === "number"
    ? BigInt(Math.trunc(x))
    : typeof x === "string"
    ? BigInt(x.replace(/[_,]/g, ""))
    : x && typeof x.toString === "function"
    ? BigInt(x.toString())
    : 0n;

function fmtBase(amountBase, decimals) {
  const a = toBigInt(amountBase);
  const base = 10n ** BigInt(decimals);
  const whole = a / base;
  const frac = (a % base)
    .toString()
    .padStart(decimals, "0")
    .slice(0, 6)
    .replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

function bnPick(obj, ...keys) {
  for (const k of keys) {
    if (obj?.[k] !== undefined && obj[k] !== null) return toBigInt(obj[k]);
  }
  return 0n;
}

const toNumUSD = (bi, decimals = 6) => Number(bi) / 10 ** decimals;

// ---------- CLI call (regex parse only) ----------
async function readVaultEquityFromCLI(vaultAddrBase58) {
  // No --json (CLI doesn't support it). We'll parse human output.
  const args = [CLI_PATH, "view-vault", "--vault-address", vaultAddrBase58];

  let stdout = "";
  let stderr = "";

  try {
    const res = await execFileP(process.execPath, args, {
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
      // If you need to force envs to the child, uncomment:
      // env: { ...process.env, RPC_URL: RPC_URL, SOLANA_RPC: RPC_URL, ANCHOR_PROVIDER_URL: RPC_URL }
    });
    stdout = (res.stdout || "").trim();
    stderr = (res.stderr || "").trim();
  } catch (e) {
    stdout = (e.stdout || "").trim();
    stderr = (e.stderr || "").trim();
  }

  const raw = `${stdout}\n${stderr}`.trim();
  if (!raw) {
    throw new Error("view-vault produced no output.");
  }

  // Try several flexible patterns; keep the one that matches your CLI output.
  const patterns = [
    /vault\s*equity.*?\(USDC\)\s*:\s*\$?\s*([\d,]+(?:\.\d+)?)/i,
    /vaultEquity\s*\(USDC\)\s*:\s*\$?\s*([\d,]+(?:\.\d+)?)/i,
    /USDC\s*equity\s*:\s*\$?\s*([\d,]+(?:\.\d+)?)/i,
    /equity\s*\(USDC\)\s*:\s*\$?\s*([\d,]+(?:\.\d+)?)/i,
  ];

  for (const re of patterns) {
    const m = raw.match(re);
    if (m) {
      const usd = parseFloat(m[1].replace(/,/g, ""));
      if (Number.isFinite(usd)) {
        return { equityUsdNumber: usd, raw };
      }
    }
  }

  // If we reach here, we couldn't find the line.
  throw new Error(
    `Couldn't find "vaultEquity (USDC)" in CLI output.\n--- RAW ---\n${raw}`
  );
}

// ---------- Public API ----------
/**
 * Returns a detailed snapshot (useful for dashboards/logs).
 * All monetary values are base-6 (USDC) BigInt unless stated otherwise.
 */
export async function getDriftSnapshot() {
  // RPC + program
  const connection = new Connection(RPC_URL, "confirmed");
  const program = await getDriftVaultProgram(connection);

  // Fetch accounts
  const vault = await program.account.vault.fetch(VAULT_ADDRESS);
  const depositor = await program.account.vaultDepositor.fetch(
    DEPOSITOR_ADDRESS
  );

  // Determine decimals (prefer on-chain mint decimals)
  let decimals = 6;
  try {
    const mintPk = new PublicKey(
      vault.depositMint?.toString?.() || vault.depositMint
    );
    const mintInfo = await getMint(connection, mintPk);
    if (Number.isFinite(mintInfo?.decimals)) decimals = mintInfo.decimals;
  } catch {
    if (Number.isFinite(vault?.depositMintDecimals)) {
      decimals = vault.depositMintDecimals;
    }
  }
  if (!Number.isFinite(decimals) || decimals <= 0) decimals = 6;

  // Pick share fields (SDK versions vary)
  const totalShares = bnPick(
    vault,
    "totalShares",
    "totalVaultShares",
    "vaultShares"
  );
  const yourShares = bnPick(depositor, "vaultShares", "shares");

  // Net deposits: some versions expose netDeposits directly; otherwise deposits - withdraws
  let netDeposits = bnPick(depositor, "netDeposits");
  if (netDeposits === 0n) {
    netDeposits =
      bnPick(depositor, "totalDeposits") - bnPick(depositor, "totalWithdraws");
  }

  // Pull vault equity (USD) via CLI wrapper. Convert to base-6 USDC.
  const { equityUsdNumber } = await readVaultEquityFromCLI(
    VAULT_ADDRESS.toBase58()
  );
  const vaultEquityUSDCBase = BigInt(Math.round(equityUsdNumber * 1e6));

  // Compute price-per-share (scaled to avoid fp error) and balances
  const SCALE = 1_000_000_000n;
  const ppsScaled =
    totalShares > 0n ? (vaultEquityUSDCBase * SCALE) / totalShares : SCALE;
  const yourBalance = (yourShares * ppsScaled) / SCALE;
  const earnings = yourBalance - netDeposits;

  // ROI % (use Number after scaling down to USD)
  const roiPct =
    toNumUSD(netDeposits, 6) > 0
      ? (toNumUSD(earnings, 6) / toNumUSD(netDeposits, 6)) * 100
      : 0;

  return {
    programId: VAULT_PROGRAM_ID.toBase58(),
    vaultAddress: VAULT_ADDRESS.toBase58(),
    depositorAddress: DEPOSITOR_ADDRESS.toBase58(),
    decimals, // deposit token decimals
    vaultEquityUSDCBase, // BigInt base-6
    totalShares, // BigInt
    yourShares, // BigInt
    netDeposits, // BigInt base-6
    yourBalance, // BigInt base-6
    earnings, // BigInt base-6
    roiPct, // Number
    fmt: {
      netDeposits: fmtBase(netDeposits, decimals),
      balance: fmtBase(yourBalance, decimals),
      earnings: fmtBase(earnings, decimals),
      equityUSD: (Number(vaultEquityUSDCBase) / 1e6).toFixed(6),
    },
  };
}

// ---------- Main guard (ESM) ----------
function isMainModule() {
  try {
    return pathToFileURL(process.argv[1]).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  (async () => {
    try {
      const s = await getDriftSnapshot();
      console.log("Program ID :", s.programId);
      console.log("Vault      :", s.vaultAddress);
      console.log("Depositor  :", s.depositorAddress);
      console.log("");
      console.log(
        "vaultEquity (USDC, base units):",
        s.vaultEquityUSDCBase.toString()
      );
      console.log(
        "Your shares / Total shares   :",
        s.yourShares.toString(),
        "/",
        s.totalShares.toString()
      );
      console.log("Net Deposits                 :", s.fmt.netDeposits);
      console.log("Balance (USD)                :", s.fmt.balance);
      console.log("Earnings (USD)               :", s.fmt.earnings);
      console.log(`ROI                          : ${s.roiPct.toFixed(2)}%`);
    } catch (e) {
      console.error("read_position_info.mjs failed:");
      if (e.stdout) console.error("STDOUT:\n" + e.stdout);
      if (e.stderr) console.error("STDERR:\n" + e.stderr);
      console.error(e.stack || e.message || e);
      process.exit(1);
    }
  })();
}
