const path = require("path");
// Load env two levels up (adjust if needed)
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const { ethers } = require("ethers");

// LI.FI SDK
const {
  createConfig: createLifiConfig,
  EVM,
  Solana,
  KeypairWalletAdapter,
  getRoutes,
  executeRoute,
} = require("@lifi/sdk");

// viem for EVM signer
const { createWalletClient, http, defineChain } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

// ------------------------------
// Solana -> Arbitrum (USDC)
// ------------------------------

// --- EVM (Arbitrum) signer ---
const arbitrum = defineChain({
  id: 42161,
  name: "Arbitrum One",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.ARBITRUM_ALCHEMY_MAINNET] } },
});

// Prefer PK_RECIPIENT_A for parity with your other script; fallback to WALLET_SECRET
const evmPk = process.env.PK_RECIPIENT_A || process.env.WALLET_SECRET;
if (!evmPk) {
  console.error(
    "Missing PK for Arbitrum signer (set PK_RECIPIENT_A or WALLET_SECRET)."
  );
  process.exit(1);
}
const evmAccount = privateKeyToAccount(evmPk);
let evmClient = createWalletClient({
  account: evmAccount,
  chain: arbitrum,
  transport: http(),
});

// --- Solana signer (backend only) ---
if (!process.env.WALLET_SOLANA_SECRET) {
  console.error(
    "Missing WALLET_SOLANA_SECRET (base58-encoded Solana secret key)."
  );
  process.exit(1);
}
const solAdapter = new KeypairWalletAdapter(process.env.WALLET_SOLANA_SECRET);

// --- Configure LI.FI with both providers ---
createLifiConfig({
  integrator: "BlockstatNodeJS",
  providers: [
    EVM({
      getWalletClient: async () => evmClient,
      switchChain: async () => evmClient, // only Arbitrum in this flow
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

  const solFrom = process.env.SOLANA_PUBKEY; // your Solana public key (from-address)
  if (!solFrom) {
    console.error("Missing SOLANA_PUBKEY (Solana fromAddress).");
    process.exit(1);
  }
  const arbTo = evmAccount.address; // Arbitrum destination

  console.log("Bridging USDC Solana → Arbitrum");
  console.log("  amount (human):", humanAmount);
  console.log("  amount (base) :", fromAmount);
  console.log("  from (SOL)    :", solFrom);
  console.log("  to (ARB)      :", arbTo);

  const params = {
    fromChainId: 1151111081099710, // Solana (LI.FI chain id)
    toChainId: 42161, // Arbitrum One
    fromTokenAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC (Solana mint)
    toTokenAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // USDC (Arbitrum)
    fromAmount,
    fromAddress: solFrom,
    toAddress: arbTo,
  };

  const { routes } = await getRoutes(params);
  if (!routes?.length) throw new Error("No routes returned.");

  const route = routes[0];
  console.log(`Selected route with ${route.steps.length} step(s)`);

  const executed = await executeRoute(route, {
    // auto-accept small exchange-rate changes (<= 0.5% worse)
    acceptExchangeRateUpdateHook: async (_toToken, oldAmt, newAmt) => {
      const o = BigInt(oldAmt),
        n = BigInt(newAmt);
      return (o - n) * 1000n <= o * 5n;
    },
    updateRouteHook(updated) {
      updated.steps?.forEach((s, i) =>
        s.execution?.process?.forEach((p) => {
          if (p.txHash) console.log(`Step ${i + 1} ${p.type} → ${p.txHash}`);
        })
      );
    },
  });

  console.log(
    "Final statuses:",
    executed.steps.map((s) => s.execution?.status)
  );
}

main().catch((err) => {
  console.error("❌ Bridge error:", err?.stack || err?.message || err);
  process.exit(1);
});
