const path = require("path");
// Load environment variables from .env file two levels up
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

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
// Example: Bridge USDC between Solana ↔ Arbitrum using LI.FI
// ---------------------------------------------------------

// --- EVM (Arbitrum) signer ---
const arbitrum = defineChain({
  id: 42161,
  name: "Arbitrum One",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.ARBITRUM_ALCHEMY_MAINNET] } },
});
const evmAccount = privateKeyToAccount(process.env.WALLET_SECRET);
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
  // Parameters for bridge/route
  const params = {
    fromChainId: 42161, // Arbitrum
    toChainId: 1151111081099710, // Solana (LI.FI chain id)
    fromTokenAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // USDC (Arb)
    toTokenAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC (Sol)
    fromAmount: "1000000", // 1 USDC (6 dp)
    fromAddress: evmAccount.address,
    toAddress: process.env.SOLANA_PUBKEY,
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
