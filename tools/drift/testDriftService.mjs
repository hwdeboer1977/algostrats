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
  const [command, amountStr] = process.argv.slice(2); // e.g. "deposit" "1"
  const amount = amountStr ? BigInt(amountStr) : null;

  try {
    if (command === "monitor") {
      await monitorAndMaybeAdjustDrift(ctx);
      console.log(JSON.stringify({ ok: true, action: "monitor" }));
    } else if (command === "deposit") {
      if (!amount) throw new Error("amount required");
      await allocateToDrift(ctx, amount);
      console.log(
        JSON.stringify({
          ok: true,
          action: "deposit",
          amount: amount.toString(),
        })
      );
    } else if (command === "withdraw") {
      if (!amount) throw new Error("amount required");
      await requestDriftWithdraw(ctx, amount);
      console.log(
        JSON.stringify({
          ok: true,
          action: "withdraw",
          amount: amount.toString(),
        })
      );
    } else if (command === "finalize") {
      await finalizeDriftWithdraw(ctx);
      console.log(JSON.stringify({ ok: true, action: "finalize" }));
    } else {
      throw new Error(`Unknown command: ${command}`);
    }
  } catch (e) {
    console.error(JSON.stringify({ ok: false, error: e.message || String(e) }));
    process.exit(1);
  }
}

main();
