// vault.mjs
// One script to run Drift Vaults CLI with env defaults from ../../.env

// Usage:
// TO CHECK VAULT:   node vault.mjs view-vault --vault-address <VAULT_PUBKEY>
// TO DEPOSIT IN VAULT:
// node .\vault.mjs deposit `
//   --vault-address A1B9MVput3r1jS91iu8ckdDiMSugXbQeEtvJEQsUHsPi `
//   --deposit-authority BepvrzsLkmEF2ZwotqEsY8fKbCzQDaB228nPzfSirQDs `
//   --amount 5

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import os from "os";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env two levels up (Algostrats/.env)
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// Path to the TypeScript CLI inside the package
const CLI_TS = path.resolve(
  __dirname,
  "node_modules",
  "@drift-labs",
  "vaults-sdk",
  "cli",
  "cli.ts"
);

// Helpers
function hasFlag(argv, names) {
  return argv.some(
    (a, i) =>
      names.includes(a) ||
      names.some((n) => a.startsWith(n + "=")) ||
      names.includes(argv[i - 1]) // handles "--url <value>"
  );
}
function pushFlag(argv, name, value) {
  argv.push(name, value);
}

// If env provides a JSON array secret, write it to a temp file so the CLI can read it
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

(async function main() {
  let userArgs = process.argv.slice(2);
  if (userArgs.length === 0) userArgs = ["--help"];

  const cliArgs = [...userArgs];

  // 1) RPC URL
  if (!hasFlag(cliArgs, ["--url", "-u"])) {
    const rpc = process.env.RPC_URL || process.env.SOLANA_RPC;
    if (!rpc) {
      console.error(
        "❌ Missing RPC URL: set RPC_URL or SOLANA_RPC in ../../.env, or pass --url"
      );
      process.exit(1);
    }
    pushFlag(cliArgs, "--url", rpc);
  }

  // 2) Keypair (file path, base58, or JSON array)
  let tmpKeyFile = null;
  if (!hasFlag(cliArgs, ["--keypair", "-k"])) {
    let kp = process.env.WALLET_SOLANA_SECRET; // base58 or JSON array (your var)

    if (!kp) {
      console.error(
        "❌ Missing keypair: set KEYPAIR_PATH / SOLANA_KEYPAIR (file path) or SOLANA_SECRET / WALLET_SOLANA_SECRET (base58 or JSON array), or pass --keypair"
      );
      process.exit(1);
    }

    // If it looks like JSON array, materialize to a temp file
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
      // If it looks like a file path, warn if not found (otherwise it's base58 and that's fine)
      const looksLikePath =
        kp.includes("\\") || kp.includes("/") || kp.endsWith(".json");
      if (looksLikePath && !fs.existsSync(kp)) {
        console.warn(
          `⚠ Keypair path not found: ${kp}. If you meant a base58 secret, keep it as a plain string.`
        );
      }
    }

    pushFlag(cliArgs, "--keypair", kp);
  }

  // 3) Env (cluster)
  if (!hasFlag(cliArgs, ["--env"])) {
    pushFlag(cliArgs, "--env", process.env.ENV || "mainnet-beta");
  }

  // Run the SDK’s TS CLI via tsx (ensure devDep "tsx" is installed)
  const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
  const args = ["tsx", CLI_TS, ...cliArgs];

  const child = spawn(cmd, args, {
    stdio: "inherit",
    shell: true,
    env: process.env, // includes loaded .env
  });

  child.on("close", (code) => {
    // Clean up temp keypair file if we made one
    if (tmpKeyFile && fs.existsSync(tmpKeyFile)) {
      try {
        fs.unlinkSync(tmpKeyFile);
      } catch {}
    }
    process.exit(code ?? 0);
  });
})();
