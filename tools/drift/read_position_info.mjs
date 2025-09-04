// read_position_info.mjs
import { execFile } from "child_process";
import { promisify } from "util";
import { Connection, PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import pkg from "@drift-labs/vaults-sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const { getDriftVaultProgram, VAULT_PROGRAM_ID } = pkg;
const execFileP = promisify(execFile);

// --- Config (addresses) ---
const RPC_URL = process.env.SOLANA_RPC;
const VAULT_ADDRESS = new PublicKey(
  "A1B9MVput3r1jS91iu8ckdDiMSugXbQeEtvJEQsUHsPi"
);
const DEPOSITOR_ADDRESS = new PublicKey(
  "HAV28fu2797q662tZEjETQg1MmoLZjd8CGLejzuMJJuy"
);

// Path to your existing CLI script (adjust if needed)
const CLI_PATH = path.resolve(__dirname, "./vault.mjs"); // same folder; change if elsewhere
// --------------------------

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
  for (const k of keys)
    if (obj?.[k] !== undefined && obj[k] !== null) return toBigInt(obj[k]);
  return 0n;
}

async function getVaultEquityUSDCfromCLI(vaultAddr) {
  // call: node vault.mjs view-vault --vault-address <addr>
  const { stdout, stderr } = await execFileP(
    process.execPath,
    [CLI_PATH, "view-vault", "--vault-address", vaultAddr],
    {
      env: { ...process.env, RPC_URL: RPC_URL },
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    }
  );
  const out = `${stdout}\n${stderr}`;

  // Look for: "vaultEquity (USDC):   $1205938.597703"
  const m = out.match(
    /vaultEquity\s*\(USDC\)\s*:\s*\$?\s*([0-9,]+(?:\.[0-9]+)?)/i
  );
  if (!m) {
    throw new Error(
      `Couldn't find "vaultEquity (USDC)" in CLI output.\n--- CLI output ---\n${out}`
    );
  }
  const usd = parseFloat(m[1].replace(/,/g, ""));
  // Return in base units (6 dp, USDC)
  return BigInt(Math.round(usd * 1e6));
}

// === NEW: library exports your keeper can call ===

/**
 * Returns a detailed snapshot (useful for dashboards/logs).
 * All monetary values are base-6 (USDC) BigInt unless stated otherwise.
 */
export async function getDriftSnapshot() {
  const connection = new Connection(RPC_URL, "confirmed");
  const program = await getDriftVaultProgram(connection);

  const vault = await program.account.vault.fetch(VAULT_ADDRESS);
  const depositor = await program.account.vaultDepositor.fetch(
    DEPOSITOR_ADDRESS
  );

  // decimals
  let decimals = 6;
  try {
    const mintPk = new PublicKey(
      vault.depositMint?.toString?.() || vault.depositMint
    );
    const mintInfo = await getMint(connection, mintPk);
    decimals = mintInfo.decimals ?? 6;
  } catch {
    decimals = vault.depositMintDecimals ?? decimals;
  }

  const totalShares = bnPick(
    vault,
    "totalShares",
    "totalVaultShares",
    "vaultShares"
  );
  const yourShares = bnPick(depositor, "vaultShares", "shares");
  const netDeposits =
    bnPick(depositor, "netDeposits") ||
    bnPick(depositor, "totalDeposits") - bnPick(depositor, "totalWithdraws");

  const vaultEquityUSDCBase = await getVaultEquityUSDCfromCLI(
    VAULT_ADDRESS.toBase58()
  );

  const SCALE = 1_000_000_000n;
  const ppsScaled =
    totalShares > 0n ? (vaultEquityUSDCBase * SCALE) / totalShares : SCALE;
  const yourBalance = (yourShares * ppsScaled) / SCALE;
  const earnings = yourBalance - netDeposits;
  const roiPct = Number(
    netDeposits > 0n ? (Number(earnings) / Number(netDeposits)) * 100 : 0
  );

  return {
    programId: VAULT_PROGRAM_ID.toBase58(),
    vaultAddress: VAULT_ADDRESS.toBase58(),
    depositorAddress: DEPOSITOR_ADDRESS.toBase58(),
    vaultEquityUSDCBase, // BigInt base-6
    totalShares, // BigInt
    yourShares, // BigInt
    netDeposits, // BigInt base-6
    yourBalance, // BigInt base-6
    earnings, // BigInt base-6
    roiPct, // Number
    decimals,
    fmt: {
      netDeposits: fmtBase(netDeposits, decimals),
      balance: fmtBase(yourBalance, decimals),
      earnings: fmtBase(earnings, decimals),
      equityUSD: (Number(vaultEquityUSDCBase) / 1e6).toFixed(6),
    },
  };
}

// keep your CLI output when run directly:
if (import.meta.main) {
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
      console.error("read_position_info_from_cli failed:", e);
    }
  })();
}
