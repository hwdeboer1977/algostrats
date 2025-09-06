# WBTC → USDC Swap on Arbitrum (Uniswap V3, Smart Order Router)

This is a **CommonJS + ethers v5** script that swaps **WBTC → USDC** on **Arbitrum One (chainId 42161)** using Uniswap’s **Smart Order Router (AlphaRouter)** to compute the best route and **SwapRouter02** to execute it.

## Quick start

### 1) Install

```bash
npm i ethers@5 dotenv @uniswap/smart-order-router @uniswap/sdk-core jsbi
```

### 2) Configure `.env`

```ini
RPC_URL=https://arb1.arbitrum.io/rpc
PRIVATE_KEY=0xYOUR_PRIVATE_KEY

AMOUNT_WBTC=0.001     # human units
SLIPPAGE_BPS=75       # 0.75%
DEADLINE_SECS=1200    # 20 minutes
```

> The script expects **CommonJS**. If your project has `"type":"module"`, either save the file as `.cjs` or add a local `package.json` with `{ "type": "commonjs" }` in the script folder.

### 3) Run

```bash
node sor_wbtc_to_usdc_arbitrum.cjs
```

## What it does

- Uses **AlphaRouter** to compute the optimal V3 route for **WBTC→USDC** on Arbitrum.
- Performs **ERC‑20 approval** to **SwapRouter02** if needed.
- Sends the **returned calldata/value** to **SwapRouter02** to execute the swap with your **slippage** and **deadline**.
- Prints transaction hash and confirmation block on success.

## Key addresses (Arbitrum One)

- **WBTC**: `0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f` (8 decimals)
- **USDC**: `0xaf88d065e77c8cc2239327c5edb3a432268e5831` (6 decimals)
- **SwapRouter02**: `0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45`
