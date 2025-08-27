import { Connection, PublicKey } from "@solana/web3.js";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

// SCRIPT TO DERIVE VAULTDEPOSITOR PDA
// How to Run:
//      1. node .\derive_depositor.mjs A1B9MVput3r1jS91iu8ckdDiMSugXbQeEtvJEQsUHsPi
//      2. save VaultDepositor PDA (here: HAV28fu2797q662tZEjETQg1MmoLZjd8CGLejzuMJJuy)
//      3. node .\vault.mjs view-vault-depositor --vault-depositor-address HAV28fu2797q662tZEjETQg1MmoLZjd8CGLejzuMJJuy

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// Usage: node derive_depositor.mjs <VAULT_ADDRESS> [AUTHORITY_PUBKEY]
const [, , VAULT, AUTH_OVERRIDE] = process.argv;

if (!VAULT) {
  console.error(
    "Usage: node derive_depositor.mjs <VAULT_ADDRESS> [AUTHORITY_PUBKEY]"
  );
  process.exit(1);
}

const RPC = process.env.SOLANA_RPC || process.env.RPC_URL;
if (!RPC) throw new Error("Set SOLANA_RPC or RPC_URL in .env");

const authorityStr = AUTH_OVERRIDE || process.env.SOLANA_PUBKEY;
if (!authorityStr)
  throw new Error(
    "Provide your authority pubkey via arg or SOLANA_PUBKEY in .env"
  );

const vaultPk = new PublicKey(VAULT);
const authorityPk = new PublicKey(authorityStr);

const connection = new Connection(RPC, "confirmed");

// The vault account's owner *is* the Vaults program ID
const acctInfo = await connection.getAccountInfo(vaultPk);
if (!acctInfo) throw new Error("Vault account not found");
const vaultsProgramId = acctInfo.owner;

// PDA: ["vault_depositor", vault, authority]
const [vaultDepositor] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault_depositor"), vaultPk.toBuffer(), authorityPk.toBuffer()],
  vaultsProgramId
);

console.log("Authority:        ", authorityPk.toBase58());
console.log("VaultDepositor PDA:", vaultDepositor.toBase58());
