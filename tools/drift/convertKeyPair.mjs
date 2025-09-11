// save as convert.js
import bs58 from "bs58";
import fs from "fs";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Resolve root .env (two levels up, adjust if needed)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const secret = process.env.WALLET_SOLANA_SECRET;
const keypair = bs58.decode(secret); // Uint8Array of 64 bytes
fs.writeFileSync("id.json", JSON.stringify(Array.from(keypair)));
