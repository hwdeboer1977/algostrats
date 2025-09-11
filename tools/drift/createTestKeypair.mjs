// save as createTestKeypair.js
import fs from "fs";
import { Keypair } from "@solana/web3.js";

// Generate a brand-new random keypair
const kp = Keypair.generate();

// Write the secret key as JSON array (64 numbers)
fs.writeFileSync("id_test.json", JSON.stringify(Array.from(kp.secretKey)));

// Print the corresponding public key so you can fund it
console.log("New test wallet created:");
console.log("  Pubkey:", kp.publicKey.toBase58());
console.log("  Saved to id_test.json");
