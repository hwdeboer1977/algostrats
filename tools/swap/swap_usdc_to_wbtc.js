// CommonJS + ethers v5 + AlphaRouter (Uniswap Smart Order Router)
// USDC -> WBTC on Arbitrum (42161)

const path = require("path");
const dotenv = require("dotenv");
const { ethers } = require("ethers");
const JSBI = require("jsbi");
const { AlphaRouter, SwapType } = require("@uniswap/smart-order-router");
const {
  Token,
  ChainId,
  CurrencyAmount,
  TradeType,
  Percent,
} = require("@uniswap/sdk-core");

// Resolve root .env (two levels up; adjust if needed)
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// ---- Addresses (lowercase) ----
const SWAP_ROUTER02 = "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45"; // SwapRouter02 on Arbitrum
const WBTC_ADDR = "0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f"; // WBTC (8 decimals)
const USDC_ADDR = "0xaf88d065e77c8cc2239327c5edb3a432268e5831"; // USDC (6 decimals)

// ---- Env knobs ----
const RPC_URL =
  process.env.ARBITRUM_ALCHEMY_MAINNET || "https://arb1.arbitrum.io/rpc";
const PRIVATE_KEY = process.env.WALLET_SECRET;

// Get amount as input from the frontend (USDC, 6dp)
const AMOUNT_USDC = process.argv[2] || "1"; // e.g. "1" USDC

const SLIPPAGE_BPS = Number(process.env.SLIPPAGE_BPS || 75); // 0.75%
const DEADLINE_SECS = Number(process.env.DEADLINE_SECS || 1200); // 20 min

if (!PRIVATE_KEY) throw new Error("Set PRIVATE_KEY in .env (WALLET_SECRET).");

async function main() {
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  // ---- Token metadata ----
  const USDC = new Token(
    ChainId.ARBITRUM_ONE,
    USDC_ADDR,
    6,
    "USDC",
    "USD Coin"
  );
  const WBTC = new Token(
    ChainId.ARBITRUM_ONE,
    WBTC_ADDR,
    8,
    "WBTC",
    "Wrapped BTC"
  );

  // Parse input amount (USDC) -> raw JSBI
  const amountInRaw = ethers.utils
    .parseUnits(AMOUNT_USDC, USDC.decimals)
    .toString();
  const inputAmount = CurrencyAmount.fromRawAmount(
    USDC,
    JSBI.BigInt(amountInRaw)
  );

  // ---- Router route (V3 only, SwapRouter02 calldata) ----
  const router = new AlphaRouter({ chainId: ChainId.ARBITRUM_ONE, provider });
  const route = await router.route(inputAmount, WBTC, TradeType.EXACT_INPUT, {
    type: SwapType.SWAP_ROUTER_02,
    recipient: wallet.address,
    slippageTolerance: new Percent(SLIPPAGE_BPS, 10_000),
    deadline: Math.floor(Date.now() / 1000) + DEADLINE_SECS,
  });

  if (!route || !route.methodParameters) {
    throw new Error("No viable route found for USDC -> WBTC.");
  }
  const { methodParameters, gasPriceWei, quote } = route;
  const calldata = methodParameters.calldata;
  const value = methodParameters.value; // usually '0x0' for ERC20->ERC20
  console.log("Route computed via AlphaRouter.");
  if (quote)
    console.log("Router quote (out WBTC):", quote.toFixed?.() || String(quote));
  console.log("Estimated gas (wei):", gasPriceWei?.toString?.() || "n/a");

  // ---- Approve USDC -> SwapRouter02 if needed ----
  const usdc = new ethers.Contract(
    USDC_ADDR,
    [
      "function decimals() view returns (uint8)",
      "function allowance(address owner, address spender) view returns (uint256)",
      "function approve(address spender, uint256 amount) returns (bool)",
    ],
    wallet
  );

  const allowance = await usdc.allowance(wallet.address, SWAP_ROUTER02);
  if (allowance.lt(ethers.BigNumber.from(amountInRaw))) {
    console.log("🔑 Approving USDC -> SwapRouter02…");
    const txA = await usdc.approve(SWAP_ROUTER02, amountInRaw);
    console.log("   tx:", txA.hash);
    await txA.wait(1);
  } else {
    console.log("✅ Allowance sufficient; skipping approve.");
  }

  // ---- Send swap tx to SwapRouter02 with returned calldata/value ----
  const feeData = await provider.getFeeData();
  // Sensible fallbacks for Arbitrum (tiny tips are fine)
  const maxPriority =
    feeData.maxPriorityFeePerGas || ethers.utils.parseUnits("0.01", "gwei");
  const maxFee = feeData.maxFeePerGas || ethers.utils.parseUnits("0.1", "gwei");

  const tx = await wallet.sendTransaction({
    to: SWAP_ROUTER02,
    data: calldata,
    value: ethers.BigNumber.from(value),
    maxPriorityFeePerGas: maxPriority,
    maxFeePerGas: maxFee,
  });

  console.log("🚀 Swap submitted:", tx.hash);
  const rcpt = await tx.wait(1);
  console.log("✅ Confirmed in block", rcpt.blockNumber);
}

main().catch((e) => {
  console.error("❌ Error:", e.stack || e.message || e);
  process.exit(1);
});
