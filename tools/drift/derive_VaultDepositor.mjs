import { Connection, PublicKey } from "@solana/web3.js";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

// SCRIPT TO DERIVE VAULTDEPOSITOR PDA
// How to Run:
//      1. node .\derive_VaultDepositor.mjs A1B9MVput3r1jS91iu8ckdDiMSugXbQeEtvJEQsUHsPi
//      2. save VaultDepositor PDA (here: HAV28fu2797q662tZEjETQg1MmoLZjd8CGLejzuMJJuy)
//      3. node .\vault.mjs view-vault-depositor --vault-depositor-address HAV28fu2797q662tZEjETQg1MmoLZjd8CGLejzuMJJuy

// Check vault: node .\vault.mjs view-vault --vault-address A1B9MVput3r1jS91iu8ckdDiMSugXbQeEtvJEQsUHsPi
// derive_VaultDepositor.mjs
// Derive the VaultDepositor PDA for a given vault + authority.
// Usage:
//   node derive_VaultDepositor.mjs <VAULT_ADDRESS> [AUTHORITY_PUBKEY]
// Example:
//   node derive_VaultDepositor.mjs A1B9MV... C1sCbr...

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env (expects SOLANA_RPC or RPC_URL, and optionally DRIFT_VAULT_AUTHORITY)
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// ---- CLI args ----
const [, , VAULT, AUTH_OVERRIDE] = process.argv;
if (!VAULT) {
  console.error(
    "Usage: node derive_VaultDepositor.mjs <VAULT_ADDRESS> [AUTHORITY_PUBKEY]"
  );
  process.exit(1);
}

// ---- RPC endpoint ----
const RPC = process.env.SOLANA_RPC || process.env.RPC_URL;
if (!RPC) {
  throw new Error("Set SOLANA_RPC or RPC_URL in ../../.env");
}

// ---- Authority selection ----
// Prefer arg override; else fall back to env DRIFT_VAULT_AUTHORITY
const authorityStr = AUTH_OVERRIDE || process.env.DRIFT_VAULT_AUTHORITY2;
if (!authorityStr) {
  throw new Error(
    "Provide authority pubkey via arg or DRIFT_VAULT_AUTHORITY in ../../.env"
  );
}

// ---- Parse keys ----
const vaultPk = new PublicKey(VAULT);
const authorityPk = new PublicKey(authorityStr);

// ---- Connect ----
const connection = new Connection(RPC, "confirmed");

// ---- Get program id from vault account owner ----
// (The vault account is owned by the Drift Vaults program.)
const acctInfo = await connection.getAccountInfo(vaultPk);
if (!acctInfo) {
  throw new Error(`Vault account not found: ${vaultPk.toBase58()}`);
}
const vaultsProgramId = acctInfo.owner;

// ---- Derive PDA ----
// Seeds must EXACTLY match the program’s seeds:
//   ["vault_depositor", vaultPubkey, authorityPubkey]
const [vaultDepositorPda, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault_depositor"), vaultPk.toBuffer(), authorityPk.toBuffer()],
  vaultsProgramId
);

// ---- Output ----
console.log("RPC:               ", RPC);
console.log("Program ID:        ", vaultsProgramId.toBase58());
console.log("Vault:             ", vaultPk.toBase58());
console.log("Authority:         ", authorityPk.toBase58());
console.log("VaultDepositor PDA:", vaultDepositorPda.toBase58());
console.log("Bump:              ", bump);
