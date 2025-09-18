// send_usdc_arbitrum.js
const { ethers } = require("ethers");
const path = require("path");
const dotenv = require("dotenv");

// Load .env from current folder or parent if needed
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// Minimal ERC20 ABI
const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

async function main() {
  const rpcUrl = process.env.ARBITRUM_ALCHEMY_MAINNET;
  const pk = process.env.PK_RECIPIENT_A;
  const to = process.env.WALLET_ADDRESS;

  //const amountHuman = "1";
  // amount:  default 1 USDC
  const amountHuman = process.argv[2] ?? "1";
  //console.log(amountHuman);

  if (!rpcUrl || !pk || !to || !amountHuman) {
    throw new Error(
      "Missing env: ARBITRUM_RPC_URL, PRIVATE_KEY, TO, AMOUNT are required."
    );
  }
  const tokenAddress = process.env.USDC_ADDRESS;

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(pk, provider);

  // Sanity check chain
  const { chainId, name } = await provider.getNetwork();
  if (chainId !== 42161n) {
    throw new Error(
      `Connected to ${name} (chainId=${chainId}), but need Arbitrum One (42161).`
    );
  }

  const token = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);

  const [dec, sym] = await Promise.all([token.decimals(), token.symbol()]);
  const amount = ethers.parseUnits(amountHuman, dec);

  // Balance check
  const bal = await token.balanceOf(wallet.address);
  if (bal < amount) {
    throw new Error(
      `Insufficient ${sym} balance. Have ${ethers.formatUnits(
        bal,
        dec
      )}, need ${amountHuman}.`
    );
  }

  console.log(
    `Sending ${amountHuman} ${sym} from ${wallet.address} -> ${to} on Arbitrum…`
  );
  // Estimate & send
  const gasEstimate = await token.transfer.estimateGas(to, amount);
  const tx = await token.transfer(to, amount, { gasLimit: gasEstimate });
  console.log("Tx sent:", tx.hash);

  const receipt = await tx.wait();
  console.log(`✅ Confirmed in block ${receipt.blockNumber}`);
}

main().catch((e) => {
  console.error("Error:", e.message ?? e);
  process.exit(1);
});
