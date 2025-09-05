// services/driftVaultCli.mjs
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to your wrapper script
const VAULT_WRAPPER = path.resolve(__dirname, "../drift/vault.mjs");

function run(args = []) {
  return new Promise((resolve, reject) => {
    const cmd = process.platform === "win32" ? "node.exe" : "node";
    const child = spawn(cmd, [VAULT_WRAPPER, ...args], {
      env: process.env,
      shell: true,
    });

    let out = "";
    let err = "";
    child.stdout?.on("data", (d) => (out += d.toString()));
    child.stderr?.on("data", (d) => (err += d.toString()));

    child.on("close", (code) => {
      if (code === 0) return resolve({ stdout: out, stderr: err });
      reject(new Error(err || `vault.mjs exited with code ${code}`));
    });
  });
}

// ===== Read helpers =====
export async function viewVault({ url, vaultAddress }) {
  const args = ["view-vault", "--vault-address", vaultAddress];
  if (url) args.push("--url", url);
  return run(args);
}

export async function listDepositors({ url, vaultAddress }) {
  const args = ["list-vault-depositors", "--vault-address", vaultAddress];
  if (url) args.push("--url", url);
  return run(args);
}

// ===== Write helpers =====
export async function depositToVault({ url, vaultAddress, depositor, amount }) {
  const args = [
    "deposit",
    "--vault-address",
    vaultAddress,
    "--deposit-authority",
    depositor,
    "--amount",
    String(amount),
  ];
  if (url) args.push("--url", url);
  return run(args);
}

/**
 * Step 1 (partial allowed): request withdrawal BY AMOUNT.
 * CLI example: `request-withdraw --vault-address <VAULT> --authority <WALLET> --amount <AMOUNT>`
 * NOTE: <AMOUNT> should be in the token units expected by the CLI (e.g., USDC with 6 decimals? or plain units).
 */
export async function requestWithdrawByAmount({
  url,
  vaultAddress,
  authority,
  amount,
}) {
  const args = [
    "request-withdraw",
    "--vault-address",
    vaultAddress,
    "--authority",
    authority,
    "--amount",
    String(amount),
  ];
  if (url) args.push("--url", url);
  return run(args);
}

/**
 * Step 2 (no amount): finalize previously requested withdrawal after the cooldown.
 * CLI example: `withdraw --vault-depositor-address <DEPOSITOR> --vault-address <VAULT> --authority <WALLET>`
 */
export async function finalizeWithdraw({
  url,
  vaultAddress,
  vaultDepositor,
  authority,
}) {
  const args = [
    "withdraw",
    "--vault-depositor-address",
    vaultDepositor,
    "--vault-address",
    vaultAddress,
    "--authority",
    authority,
  ];
  if (url) args.push("--url", url);
  return run(args);
}

// Backward-compat alias (kept so old imports won't break). This *does not* take amount.
export const withdrawFromVault = finalizeWithdraw;
