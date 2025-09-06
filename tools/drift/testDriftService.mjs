// testDriftService.mjs
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import {
  allocateToDrift,
  requestDriftWithdraw,
  finalizeDriftWithdraw,
  monitorAndMaybeAdjustDrift,
} from "./driftService.mjs";

// Resolve root .env (two levels up, adjust if needed)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const ctx = {
  cfg: {
    solanaRpc: process.env.SOLANA_RPC,
    driftVaultAddress: process.env.DRIFT_VAULT_ADDRESS,
    driftVaultDepositor: process.env.DRIFT_VAULT_DEPOSITOR,
    driftVaultAuthority: process.env.DRIFT_VAULT_AUTHORITY, // wallet pubkey
  },
};

console.log("driftVaultAddress:", ctx.cfg.driftVaultAddress);
console.log("driftVaultDepositor:", ctx.cfg.driftVaultDepositor);
console.log("driftVaultAuthority:", ctx.cfg.driftVaultAuthority);

async function main() {
  console.log("=== Testing Drift Service ===");

  // Monitor (safe)
  //await monitorAndMaybeAdjustDrift(ctx);

  // Deposit (CAUTION: real tx)
  // await allocateToDrift(ctx, BigInt(1));

  // Withdraw flow:
  // Step 1: Request partial withdraw (e.g., 5 units)
  //await requestDriftWithdraw(ctx, BigInt(5));

  // Step 2: Finalize after cooldown (24 hours!)
  await finalizeDriftWithdraw(ctx);
}

main().catch(console.error);
