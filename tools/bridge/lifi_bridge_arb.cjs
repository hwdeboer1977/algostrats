const path = require("path");
// Load environment variables from .env file two levels up
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const { ethers } = require("ethers");

// Import LI.FI SDK components
const {
  createConfig: createLifiConfig,
  EVM,
  Solana,
  KeypairWalletAdapter,
  getRoutes,
  executeRoute,
} = require("@lifi/sdk");

// Import viem for EVM chain interactions
const { createWalletClient, http, defineChain } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

// ---------------------------------------------------------
// Example: Bridge USDC between Arbitrum ↔ Solana using LI.FI
// ---------------------------------------------------------

// --- EVM (Arbitrum) signer ---
const arbitrum = defineChain({
  id: 42161,
  name: "Arbitrum One", // Arbitrum chain ID
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.ARBITRUM_ALCHEMY_MAINNET] } },
});

// Create an EVM account object from private key
const evmAccount = privateKeyToAccount(process.env.WALLET_SECRET);

// Create a wallet client for EVM
let evmClient = createWalletClient({
  account: evmAccount,
  chain: arbitrum,
  transport: http(),
});

// --- Solana signer (backend only) ---
const solAdapter = new KeypairWalletAdapter(process.env.WALLET_SOLANA_SECRET);

// --- Configure LI.FI SDK with both providers ---
createLifiConfig({
  integrator: "BlockstatNodeJS",
  providers: [
    EVM({
      getWalletClient: async () => evmClient,
      switchChain: async () => evmClient, // only Arbitrum needed for this flow
    }),
    Solana({
      getWalletAdapter: async () => solAdapter,
    }),
  ],
});

async function main() {
  // CLI: node bridge_sol_to_arb.js <amountUSDC>
  const humanAmount = process.argv[2] ?? "5";
  // USDC = 6 decimals on both chains
  const fromAmount = ethers.parseUnits(humanAmount, 6).toString();
  // Parameters for bridge/route

  const params = {
    fromChainId: 1151111081099710, // Solana (LI.FI chain id)
    toChainId: 42161, // Arbitrum
    fromTokenAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC (Sol)
    toTokenAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // USDC (ARB)
    fromAmount: fromAmount, // USDC (6 dp)
    fromAddress: process.env.SOLANA_PUBKEY,
    toAddress: evmAccount.address,
  };

  const { routes } = await getRoutes(params);
  if (!routes?.length) throw new Error("No routes returned.");

  const route = routes[0];
  console.log(`Selected route with ${route.steps.length} step(s)`);

  const executed = await executeRoute(route, {
    acceptExchangeRateUpdateHook: async (_toToken, oldAmt, newAmt) => {
      const o = BigInt(oldAmt),
        n = BigInt(newAmt);
      return (o - n) * 1000n <= o * 5n; // auto-accept <= 0.5% worse
    },
    updateRouteHook(updated) {
      updated.steps?.forEach((s, i) =>
        s.execution?.process?.forEach(
          (p) =>
            p.txHash && console.log(`Step ${i + 1} ${p.type} → ${p.txHash}`)
        )
      );
    },
  });

  console.log(
    "Final statuses:",
    executed.steps.map((s) => s.execution?.status)
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
