// CommonJS + ethers v5 + AlphaRouter (Uniswap Smart Order Router)
// USDC <-> WBTC on Arbitrum (42161)
// Usage:
//   node swap_router_dual.js <amount> --dir usdc2wbtc|wbtc2usdc
// Env (.env):
//   ARBITRUM_ALCHEMY_MAINNET=...  (RPC URL)
//   WALLET_SECRET=0x...           (private key)
//   SLIPPAGE_BPS=75               (default 0.75%)
//   DEADLINE_SECS=1200            (default 20 min)
//   APPROVE_MAX=0|1
// node swap_router_dual.js 0.00005 --dir wbtc2usdc
// node swap_router_dual.js 1 --dir usdc2wbtc

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

// ---- Addresses ----
const SWAP_ROUTER02 = "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45";
const WBTC_ADDR = "0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f"; // 8 dp
const USDC_ADDR = "0xaf88d065e77c8cc2239327c5edb3a432268e5831"; // 6 dp

// ---- Env ----
const RPC_URL =
  process.env.ARBITRUM_ALCHEMY_MAINNET || "https://arb1.arbitrum.io/rpc";
const PRIVATE_KEY = process.env.WALLET_SECRET || process.env.PRIVATE_KEY;
const SLIPPAGE_BPS = Number(process.env.SLIPPAGE_BPS || 75);
const DEADLINE_SECS = Number(process.env.DEADLINE_SECS || 1200);
const APPROVE_MAX = process.env.APPROVE_MAX === "1";

// ---- CLI ----
const AMOUNT = process.argv[2];
if (!AMOUNT) {
  console.error(
    "Usage: node swap_router_dual.js <amount> --dir usdc2wbtc|wbtc2usdc"
  );
  process.exit(1);
}
const dirFlagIndex = process.argv.findIndex((a) => a === "--dir");
let DIRECTION = "usdc2wbtc";
if (dirFlagIndex >= 0 && process.argv[dirFlagIndex + 1]) {
  DIRECTION = String(process.argv[dirFlagIndex + 1]).toLowerCase();
}
const DIR_ALIASES = {
  usdc2wbtc: "usdc2wbtc",
  "usdc->wbtc": "usdc2wbtc",
  usdc_wbtc: "usdc2wbtc",
  buywbtc: "usdc2wbtc",
  wbtc2usdc: "wbtc2usdc",
  "wbtc->usdc": "wbtc2usdc",
  wbtc_usdc: "wbtc2usdc",
  sellwbtc: "wbtc2usdc",
};
DIRECTION = DIR_ALIASES[DIRECTION] || "usdc2wbtc";

// ---- Guard ----
if (!PRIVATE_KEY) throw new Error("Set WALLET_SECRET in .env");

// ---- Helpers ----
function tokens(provider) {
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
  return { USDC, WBTC };
}

async function ensureAllowance(tokenAddr, owner, spender, amountStr, wallet) {
  const abi = [
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function decimals() view returns (uint8)",
  ];
  const erc20 = new ethers.Contract(tokenAddr, abi, wallet);
  const dec = await erc20.decimals();
  const needed = APPROVE_MAX
    ? ethers.constants.MaxUint256
    : ethers.utils.parseUnits(amountStr, dec);

  const current = await erc20.allowance(owner, spender);
  if (current.gte(needed)) {
    console.log("✅ Allowance sufficient; skipping approve.");
    return;
  }
  console.log(
    `🔑 Approving ${tokenAddr} -> ${spender} (${
      APPROVE_MAX ? "MaxUint256" : amountStr
    })…`
  );
  const txA = await erc20.approve(spender, needed);
  console.log("   approve tx:", txA.hash);
  await txA.wait(1);
}

async function pickFees(provider) {
  const feeData = await provider.getFeeData();
  // Good defaults for Arbitrum (tiny tips fine)
  const maxPriority =
    feeData.maxPriorityFeePerGas || ethers.utils.parseUnits("0.01", "gwei");
  // Headroom over base fee
  if (feeData.maxFeePerGas) {
    return {
      maxPriorityFeePerGas: maxPriority,
      maxFeePerGas: feeData.maxFeePerGas,
    };
  }
  const latest = await provider.getBlock("latest");
  const base = latest.baseFeePerGas || ethers.BigNumber.from(0);
  const maxFee = base.mul(2).add(maxPriority); // bump if you see rejections
  return { maxPriorityFeePerGas: maxPriority, maxFeePerGas: maxFee };
}

async function main() {
  console.log(`▶ Swapping ${DIRECTION} amount=${AMOUNT}`);
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  const { USDC, WBTC } = tokens(provider);

  // Configure direction
  const inputToken = DIRECTION === "wbtc2usdc" ? WBTC : USDC;
  const outputToken = DIRECTION === "wbtc2usdc" ? USDC : WBTC;

  // Parse input amount to raw
  const amountInRaw = ethers.utils
    .parseUnits(AMOUNT, inputToken.decimals)
    .toString();
  const inputAmount = CurrencyAmount.fromRawAmount(
    inputToken,
    JSBI.BigInt(amountInRaw)
  );

  // Router + route
  const router = new AlphaRouter({ chainId: ChainId.ARBITRUM_ONE, provider });
  const route = await router.route(
    inputAmount,
    outputToken,
    TradeType.EXACT_INPUT,
    {
      type: SwapType.SWAP_ROUTER_02,
      recipient: wallet.address,
      slippageTolerance: new Percent(SLIPPAGE_BPS, 10_000),
      deadline: Math.floor(Date.now() / 1000) + DEADLINE_SECS,
    }
  );

  if (!route || !route.methodParameters) {
    throw new Error("No viable route found.");
  }
  const { methodParameters, gasPriceWei, quote } = route;
  console.log("Route computed via AlphaRouter.");
  if (quote) {
    const outHuman = ethers.utils.formatUnits(
      quote.quotient.toString(),
      outputToken.decimals
    );
    console.log(
      `Quote (min out before slippage): ~${outHuman} ${outputToken.symbol}`
    );
  }
  console.log("Estimated gas (wei):", gasPriceWei?.toString?.() || "n/a");

  // Approve input token if needed
  await ensureAllowance(
    inputToken.address,
    wallet.address,
    SWAP_ROUTER02,
    AMOUNT,
    wallet
  );

  // Send tx
  const { maxPriorityFeePerGas, maxFeePerGas } = await pickFees(provider);
  const tx = await wallet.sendTransaction({
    to: SWAP_ROUTER02,
    data: methodParameters.calldata,
    value: ethers.BigNumber.from(methodParameters.value), // usually 0
    maxPriorityFeePerGas,
    maxFeePerGas,
  });
  console.log("🚀 Swap submitted:", tx.hash);
  const rcpt = await tx.wait(1);
  console.log("✅ Confirmed in block", rcpt.blockNumber);
}

main().catch((e) => {
  console.error("❌ Error:", e.stack || e.message || e);
  process.exit(1);
});
