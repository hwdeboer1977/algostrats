// testVaultCli.mjs
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import {
  viewVault,
  listDepositors,
  depositToVault,
  finalizeWithdraw, // finalize (no amount)
  requestWithdrawByAmount, // request partial withdraw (with amount)
} from "./driftVaultCli.mjs";

// Resolve root .env (two levels up; adjust if needed)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// Build ctx
const ctx = {
  cfg: {
    solanaRpc: process.env.SOLANA_RPC,
    driftVaultAddress: process.env.DRIFT_VAULT_ADDRESS,
    driftVaultDepositor: process.env.DRIFT_VAULT_DEPOSITOR, // PDA (not wallet)
    driftVaultAuthority: process.env.DRIFT_VAULT_AUTHORITY, // wallet pubkey
  },
};

console.log("driftVaultAddress:", ctx.cfg.driftVaultAddress);
console.log("driftVaultDepositor:", ctx.cfg.driftVaultDepositor);
console.log("driftVaultAuthority:", ctx.cfg.driftVaultAuthority);

async function main() {
  console.log("=== Testing Drift Vault CLI wrapper ===");

  // 1) View vault (read-only)
  const v = await viewVault({
    url: ctx.cfg.solanaRpc,
    vaultAddress: ctx.cfg.driftVaultAddress,
  });
  console.log("viewVault output:\n", v.stdout);

  // 2) List depositors (read-only)
  const d = await listDepositors({
    url: ctx.cfg.solanaRpc,
    vaultAddress: ctx.cfg.driftVaultAddress,
  });
  console.log("listDepositors output:\n", d.stdout);

  // 3) Deposit (CAUTION: real tx!) — uncomment to test
  // const dep = await depositToVault({
  //   url: ctx.cfg.solanaRpc,
  //   vaultAddress: ctx.cfg.driftVaultAddress,
  //   depositor: ctx.cfg.driftVaultDepositor, // deposit authority
  //   amount: "1000000", // example: 1 USDC if token has 6 decimals
  // });
  // console.log("depositToVault output:\n", dep.stdout);

  // 4) Request withdraw BY AMOUNT (partial; CAUTION: real tx!) — uncomment to test
  // const req = await requestWithdrawByAmount({
  //   url: ctx.cfg.solanaRpc,
  //   vaultAddress: ctx.cfg.driftVaultAddress,
  //   authority: ctx.cfg.driftVaultAuthority,     // wallet pubkey
  //   amount: "4000000", // example: 4 USDC in base units (6 decimals)
  // });
  // console.log("requestWithdrawByAmount output:\n", req.stdout);

  // 5) Finalize withdraw (after cooldown; CAUTION: real tx!) — uncomment to test
  // const fin = await finalizeWithdraw({
  //   url: ctx.cfg.solanaRpc,
  //   vaultAddress: ctx.cfg.driftVaultAddress,
  //   vaultDepositor: ctx.cfg.driftVaultDepositor, // PDA (not wallet)
  //   authority: ctx.cfg.driftVaultAuthority,
  // });
  // console.log("finalizeWithdraw output:\n", fin.stdout);
}

main().catch(console.error);
