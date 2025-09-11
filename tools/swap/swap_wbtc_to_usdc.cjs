// CommonJS + ethers v5 + AlphaRouter (Uniswap Smart Order Router)
// WBTC -> USDC on Arbitrum (42161)
const path = require("path");
const dotenv = require("dotenv");
const { ethers } = require("ethers");
const JSBI = require("jsbi");
const {
  AlphaRouter,
  SwapType,
  Protocol,
} = require("@uniswap/smart-order-router");
const {
  Token,
  ChainId,
  CurrencyAmount,
  TradeType,
  Percent,
} = require("@uniswap/sdk-core");

// Resolve root .env (two levels up; adjust if needed)
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// ---- Addresses (lowercase to avoid checksum fuss in string handling) ----
const SWAP_ROUTER02 = "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45"; // SwapRouter02 on Arbitrum
const WBTC_ADDR = "0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f"; // 8 decimals
const USDC_ADDR = "0xaf88d065e77c8cc2239327c5edb3a432268e5831"; // 6 decimals

// ---- Env knobs ----
const RPC_URL =
  process.env.ARBITRUM_ALCHEMY_MAINNET || "https://arb1.arbitrum.io/rpc";
const PRIVATE_KEY = process.env.WALLET_SECRET;

// Get amount as input from the frontend
const AMOUNT_WBTC = process.argv[2] || "0.00001";
const SLIPPAGE_BPS = Number(process.env.SLIPPAGE_BPS || 75);
const DEADLINE_SECS = Number(process.env.DEADLINE_SECS || 1200);

if (!PRIVATE_KEY) throw new Error("Set PRIVATE_KEY in .env");

async function main() {
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  // ---- Token metadata (SDK-core Tokens) ----
  const WBTC = new Token(
    ChainId.ARBITRUM_ONE,
    WBTC_ADDR,
    8,
    "WBTC",
    "Wrapped BTC"
  );
  const USDC = new Token(
    ChainId.ARBITRUM_ONE,
    USDC_ADDR,
    6,
    "USDC",
    "USD Coin"
  );

  // Parse input amount -> raw JSBI
  const amountInRaw = ethers.utils
    .parseUnits(AMOUNT_WBTC, WBTC.decimals)
    .toString();
  const inputAmount = CurrencyAmount.fromRawAmount(
    WBTC,
    JSBI.BigInt(amountInRaw)
  );

  // ---- Build router & compute route (V3 only, SwapRouter02 calldata) ----
  const router = new AlphaRouter({ chainId: ChainId.ARBITRUM_ONE, provider });
  const route = await router.route(inputAmount, USDC, TradeType.EXACT_INPUT, {
    type: SwapType.SWAP_ROUTER_02, // return calldata for SwapRouter02
    recipient: wallet.address,
    slippageTolerance: new Percent(SLIPPAGE_BPS, 10_000), // e.g., 0.75%
    deadline: Math.floor(Date.now() / 1000) + DEADLINE_SECS,
  });

  if (!route || !route.methodParameters)
    throw new Error("No viable route found.");
  const { methodParameters, gasPriceWei } = route;
  const calldata = methodParameters.calldata;
  const value = methodParameters.value; // hex string (e.g., '0x0')
  console.log("Route computed via AlphaRouter."); // aligns with docs routing guide
  console.log("Estimated gas (wei):", gasPriceWei?.toString?.() || "n/a");

  // ---- Approve WBTC -> SwapRouter02 if needed ----
  const erc20 = new ethers.Contract(
    WBTC_ADDR,
    [
      "function decimals() view returns (uint8)",
      "function allowance(address owner, address spender) view returns (uint256)",
      "function approve(address spender, uint256 amount) returns (bool)",
    ],
    wallet
  );

  const allowance = await erc20.allowance(wallet.address, SWAP_ROUTER02);
  if (allowance.lt(ethers.BigNumber.from(amountInRaw))) {
    console.log("🔑 Approving WBTC -> SwapRouter02…");
    const txA = await erc20.approve(SWAP_ROUTER02, amountInRaw);
    console.log("   tx:", txA.hash);
    await txA.wait(1);
  } else {
    console.log("✅ Allowance sufficient; skipping approve.");
  }

  // ---- Send swap tx to SwapRouter02 with returned calldata/value ----
  const feeData = await provider.getFeeData();
  const tx = await wallet.sendTransaction({
    to: SWAP_ROUTER02,
    data: calldata,
    value: ethers.BigNumber.from(value),
    maxPriorityFeePerGas:
      feeData.maxPriorityFeePerGas || ethers.utils.parseUnits("0.01", "gwei"),
    maxFeePerGas:
      feeData.maxFeePerGas || ethers.utils.parseUnits("0.1", "gwei"),
  });
  console.log("🚀 Swap submitted:", tx.hash);
  const rcpt = await tx.wait(1);
  console.log("✅ Confirmed in block", rcpt.blockNumber);
}

main().catch((e) => {
  console.error("❌ Error:", e.stack || e.message || e);
  process.exit(1);
});
