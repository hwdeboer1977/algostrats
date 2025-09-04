require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const RPC_URL = process.env.RPC_URL || "ws://127.0.0.1:8545";
const CONFIRMATIONS = Number(process.env.CONFIRMATIONS || 1);
const VAULT_ADDRESS = process.env.VAULT_ADDRESS;

if (!VAULT_ADDRESS) {
  throw new Error("Missing VAULT_ADDRESS in .env");
}

const vaultAbiFile = path.join(__dirname, "./abi/Vault.json");
if (!fs.existsSync(vaultAbiFile)) {
  throw new Error("Missing ABI at backend/keeper/abi/Vault.json");
}
const vaultAbi = JSON.parse(fs.readFileSync(vaultAbiFile, "utf8")).abi;

async function main() {
  console.log("🚀 Keeper starting...");
  console.log("RPC_URL:", RPC_URL);
  console.log("🔗 Vault:", VAULT_ADDRESS);
  console.log("⏳ Confirmations:", CONFIRMATIONS);

  const provider = RPC_URL.startsWith("ws")
    ? new ethers.WebSocketProvider(RPC_URL)
    : new ethers.JsonRpcProvider(RPC_URL);

  if (provider instanceof ethers.JsonRpcProvider) {
    provider.pollingInterval = 1000;
  }

  const vault = new ethers.Contract(VAULT_ADDRESS, vaultAbi, provider);

  async function finalizeTx(txHash, label) {
    try {
      await provider.waitForTransaction(txHash, CONFIRMATIONS);
      console.log(`✅ [finalized] ${label} @ ${txHash}`);
    } catch (e) {
      console.error(`⚠️ waitForTransaction failed for ${label}:`, e.message);
    }
  }

  vault.on("Deposit", async (...args) => {
    const event = args[args.length - 1];
    const [caller, owner, assets, shares] = args;
    console.log(
      `📥 Deposit (pending)\n  tx: ${event.log.transactionHash}\n  caller: ${caller}\n  owner: ${owner}\n  assets: ${assets}\n  shares: ${shares}`
    );
    finalizeTx(event.log.transactionHash, "Deposit");
  });

  console.log("👂 Listening for Vault events…");
}

main().catch((err) => {
  console.error("❌ Keeper crashed:", err);
  process.exit(1);
});
