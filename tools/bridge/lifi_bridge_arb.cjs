const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const {
  createConfig: createLifiConfig,
  EVM,
  Solana,
  KeypairWalletAdapter,
  getRoutes,
  executeRoute,
} = require("@lifi/sdk");
const { createWalletClient, http, defineChain } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

// Bridge ARB → Solana → Arbitrum (USDC → USDC)

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

// --- Wire up LI.FI providers ---
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
  const params = {
    //fromChainId: 42161, // Arbitrum
    //toChainId: 1151111081099710, // Solana (LI.FI chain id)
    fromChainId: 1151111081099710, // Solana (LI.FI chain id)
    toChainId: 42161, // Arbitrum
    //fromTokenAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // USDC (Arb)
    //toTokenAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC (Sol)
    fromTokenAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC (Sol)
    toTokenAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // USDC (ARB)
    fromAmount: "1000000", // 1 USDC (6 dp)
    //fromAddress: evmAccount.address,
    //toAddress: process.env.SOLANA_PUBKEY,
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
