// vaultNew.mjs — Convenience wrapper for Drift Vaults TS CLI
// - Auto-fills flags from ../../.env
// - Derives VaultDepositor PDA for withdraw if missing
// - Prints tx signature and treats common Solana preflight noise as success
// - Supports DRIFT_SKIP_PREFLIGHT=1 to add --skip-preflight
//
// Requires: @drift-labs/vaults-sdk, tsx, @solana/web3.js

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import os from "os";
import dotenv from "dotenv";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env two levels up (Algostrats/.env)
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// --- ENV DEFAULTS ---
const ENV_RPC = process.env.SOLANA_RPC || process.env.RPC_URL || "";
const ENV_ENV = process.env.ENV || "mainnet-beta";
const ENV_VAULT = process.env.DRIFT_VAULT_ADDRESS || "";
const ENV_AUTH = process.env.DRIFT_VAULT_AUTHORITY || ""; // pubkey string
const ENV_AMOUNT = process.env.DRIFT_DEFAULT_AMOUNT || ""; // e.g. "5"
const ENV_SKIP_PREFLIGHT = process.env.DRIFT_SKIP_PREFLIGHT === "1";
const ENV_WALLET_SECRET =
  process.env.KEYPAIR_PATH || // optional explicit file path
  process.env.SOLANA_KEYPAIR ||
  process.env.WALLET_SOLANA_SECRET || // base58 or JSON array (keypair file content)
  "";

// Path to the TypeScript CLI inside the package
const CLI_TS = path.resolve(
  __dirname,
  "node_modules",
  "@drift-labs",
  "vaults-sdk",
  "cli",
  "cli.ts"
);

// ---------- Helpers ----------
function hasFlag(argv, names) {
  return argv.some(
    (a, i) =>
      names.includes(a) ||
      names.some((n) => a.startsWith(n + "=")) ||
      names.includes(argv[i - 1])
  );
}
function getFlagValue(argv, names) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (names.includes(a)) return argv[i + 1];
    const hit = names.find((n) => a.startsWith(n + "="));
    if (hit) return a.slice(hit.length + 1);
  }
  return null;
}
function pushFlag(argv, name, value) {
  argv.push(name, value);
}
function maybeMaterializeJsonKeypair(secret) {
  try {
    const arr = JSON.parse(secret);
    if (!Array.isArray(arr)) return null;
    const tmp = path.join(os.tmpdir(), `drift_vault_kp_${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify(arr));
    return tmp;
  } catch {
    return null;
  }
}

// Base58-ish patterns to sniff tx signatures in CLI output
const BASE58_RE = /[1-9A-HJ-NP-Za-km-z]{43,88}/gim;
const SIG_LINE_RE = /signature\s*[:=]\s*([1-9A-HJ-NP-Za-km-z]{43,88})/i;
const EXPLORER_URL_RE = /\/tx\/([1-9A-HJ-NP-Za-km-z]{43,88})/i;

// Benign Solana noises we want to ignore if a tx actually went through
const BENIGN_ERR = [
  /This transaction has already been processed/i, // preflight re-send
  /Forwarder error:\s*1002/i, // common forwarder code
  /HTTP 503|Service Unavailable/i, // transient RPC 503s
];

// ---------- PDA Derivation ----------
async function deriveVaultDepositorPda(rpc, vaultStr, authorityStr) {
  if (!rpc) throw new Error("RPC is required to derive PDA.");
  const connection = new Connection(rpc, "confirmed");
  const vaultPk = new PublicKey(vaultStr);
  const authorityPk = new PublicKey(authorityStr);

  // Owner of the vault account is the Vaults Program ID
  const acctInfo = await connection.getAccountInfo(vaultPk);
  if (!acctInfo) throw new Error(`Vault account not found: ${vaultStr}`);
  const programId = acctInfo.owner;

  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("vault_depositor"),
      vaultPk.toBuffer(),
      authorityPk.toBuffer(),
    ],
    programId
  );
  return pda.toBase58();
}

// ---------- Wallet Pubkey (optional: for sanity check) ----------
function tryGetWalletPubkeyFromSecret(secret) {
  try {
    if (secret.trim().startsWith("[")) {
      const arr = Uint8Array.from(JSON.parse(secret));
      return Keypair.fromSecretKey(arr).publicKey.toBase58();
    }
    return null; // base58 string alone isn't enough to reconstruct file format
  } catch {
    return null;
  }
}

(async function main() {
  let userArgs = process.argv.slice(2);
  if (userArgs.length === 0) {
    // default to help if no subcommand
    userArgs = ["--help"];
  }

  const subcmd = userArgs[0]; // e.g. 'deposit', 'request-withdraw', 'withdraw'
  const cliArgs = [...userArgs];

  // 0) Inject core defaults: --url, --keypair, --env
  if (!hasFlag(cliArgs, ["--url", "-u"])) {
    if (!ENV_RPC) {
      console.error(
        "❌ Missing RPC URL: set RPC_URL or SOLANA_RPC in ../../.env, or pass --url"
      );
      process.exit(1);
    }
    pushFlag(cliArgs, "--url", ENV_RPC);
  }

  let tmpKeyFile = null;
  if (!hasFlag(cliArgs, ["--keypair", "-k"])) {
    let kp = ENV_WALLET_SECRET;
    if (!kp) {
      console.error(
        "❌ Missing keypair: set KEYPAIR_PATH / SOLANA_KEYPAIR (file path) or WALLET_SOLANA_SECRET (base58 or JSON array), or pass --keypair"
      );
      process.exit(1);
    }
    if (kp.trim().startsWith("[")) {
      const tmp = maybeMaterializeJsonKeypair(kp);
      if (!tmp) {
        console.error(
          "❌ Provided JSON secret is invalid. Use a valid array or base58 string."
        );
        process.exit(1);
      }
      tmpKeyFile = tmp;
      kp = tmpKeyFile;
    } else {
      const looksLikePath =
        kp.includes("\\") || kp.includes("/") || kp.endsWith(".json");
      if (looksLikePath && !fs.existsSync(kp)) {
        console.warn(
          `⚠ Keypair path not found: ${kp}. If you meant a base58 secret, keep it as a plain string in WALLET_SOLANA_SECRET.`
        );
      }
    }
    pushFlag(cliArgs, "--keypair", kp);
  }

  if (!hasFlag(cliArgs, ["--env"])) {
    pushFlag(cliArgs, "--env", ENV_ENV);
  }

  // 1) Convenience default flags per subcommand
  // Common: add --vault-address if missing
  if (!hasFlag(cliArgs, ["--vault-address"]) && ENV_VAULT) {
    pushFlag(cliArgs, "--vault-address", ENV_VAULT);
  }

  // deposit: needs --deposit-authority and --amount
  if (subcmd === "deposit") {
    if (!hasFlag(cliArgs, ["--deposit-authority"]) && ENV_AUTH) {
      pushFlag(cliArgs, "--deposit-authority", ENV_AUTH);
    }
    if (!hasFlag(cliArgs, ["--amount"]) && ENV_AMOUNT) {
      pushFlag(cliArgs, "--amount", String(ENV_AMOUNT));
    }
  }

  // request-withdraw: needs --authority and --amount
  if (subcmd === "request-withdraw") {
    if (!hasFlag(cliArgs, ["--authority"]) && ENV_AUTH) {
      pushFlag(cliArgs, "--authority", ENV_AUTH);
    }
    if (!hasFlag(cliArgs, ["--amount"]) && ENV_AMOUNT) {
      pushFlag(cliArgs, "--amount", String(ENV_AMOUNT));
    }
  }

  // withdraw: needs --vault-depositor-address (or derive it if missing), plus --vault-address and --authority
  if (subcmd === "withdraw") {
    // Ensure we have vault & authority (either flags or env)
    if (!hasFlag(cliArgs, ["--vault-address"]) && !ENV_VAULT) {
      console.error(
        "❌ withdraw: provide --vault-address or set DRIFT_VAULT_ADDRESS in .env"
      );
      process.exit(1);
    }
    if (!hasFlag(cliArgs, ["--authority"]) && !ENV_AUTH) {
      console.error(
        "❌ withdraw: provide --authority or set DRIFT_VAULT_AUTHORITY in .env"
      );
      process.exit(1);
    }
    if (!hasFlag(cliArgs, ["--authority"]) && ENV_AUTH) {
      pushFlag(cliArgs, "--authority", ENV_AUTH);
    }

    // Derive PDA if not provided
    if (!hasFlag(cliArgs, ["--vault-depositor-address"])) {
      const vaultAddr = getFlagValue(cliArgs, ["--vault-address"]) || ENV_VAULT;
      const authority = getFlagValue(cliArgs, ["--authority"]) || ENV_AUTH;

      try {
        const pda = await deriveVaultDepositorPda(
          ENV_RPC,
          vaultAddr,
          authority
        );
        pushFlag(cliArgs, "--vault-depositor-address", pda);
        console.log(`ℹ Derived depositor PDA: ${pda}`);
      } catch (e) {
        console.error("❌ Failed to derive VaultDepositor PDA:", e.message);
        process.exit(1);
      }
    }
  }

  // 2) Skip-preflight convenience
  if (!hasFlag(cliArgs, ["--skip-preflight"]) && ENV_SKIP_PREFLIGHT) {
    cliArgs.push("--skip-preflight");
  }

  // 3) Spawn the SDK’s TS CLI via tsx
  const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
  const args = ["tsx", CLI_TS, ...cliArgs];

  let lastSeenSignature = null;
  const sniffForSignature = (s) => {
    const m1 = s.match(SIG_LINE_RE);
    if (m1?.[1]) lastSeenSignature = m1[1];
    const m2 = s.match(EXPLORER_URL_RE);
    if (m2?.[1]) lastSeenSignature = m2[1];
    const b = s.match(BASE58_RE);
    if (b && b.length > 0) lastSeenSignature = b[b.length - 1];
  };

  const child = spawn(cmd, args, {
    stdio: ["inherit", "pipe", "pipe"],
    shell: true,
    env: process.env,
  });

  let outBuf = "";
  let errBuf = "";

  child.stdout.on("data", (chunk) => {
    const s = chunk.toString();
    process.stdout.write(s);
    sniffForSignature(s);
    outBuf += s;
  });

  child.stderr.on("data", (chunk) => {
    const s = chunk.toString();
    // write stderr but we still sniff + buffer for benign-filter logic
    // process.stderr.write(s);
    // swallow benign Solana noise; print everything else
    if (!BENIGN_ERR.some((re) => re.test(s))) {
      process.stderr.write(s);
    }
    sniffForSignature(s);
    errBuf += s;
  });

  child.on("close", (code) => {
    if (tmpKeyFile && fs.existsSync(tmpKeyFile)) {
      try {
        fs.unlinkSync(tmpKeyFile);
      } catch {}
    }

    if (lastSeenSignature) {
      console.log(`\n✅ Transaction signature: ${lastSeenSignature}`);
      console.log(
        `🔎 Explorer: https://solscan.io/tx/${lastSeenSignature}  (add ?cluster=devnet for devnet)`
      );
    }

    let exitCode = code ?? 0;

    // If non-zero but we saw a sig OR only benign RPC issues appeared, treat as success
    const isBenign = BENIGN_ERR.some(
      (re) => re.test(outBuf) || re.test(errBuf)
    );
    if (exitCode !== 0 && (lastSeenSignature || isBenign)) {
      console.log(
        "ℹ️  Benign Solana RPC/preflight noise suppressed; treating as success."
      );
      exitCode = 0;
    }

    process.exit(exitCode);
  });
})();
