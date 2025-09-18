# Uniswap V3 WBTC/USDC Swap Scripts (Arbitrum One)

This repo contains several **Node.js (CommonJS)** scripts for swapping **WBTC ↔ USDC** on **Arbitrum (chainId 42161)** using Uniswap’s **Smart Order Router (AlphaRouter)** and **SwapRouter02**.

---

## ✨ Scripts

- **`swap_wbtc_to_usdc.cjs`** — Swap **WBTC → USDC** (original single-direction script).
- **`swap_usdc_to_wbtc.js`** — Swap **USDC → WBTC**.
- **`swap_router_dual.js`** — Flexible script supporting **both directions** via a `--dir` flag.

---

## ✅ Prerequisites

- Node.js 18+
- Packages:
  ```bash
  npm i ethers@5 dotenv @uniswap/smart-order-router @uniswap/sdk-core jsbi
  ```
- A `.env` (two levels up) with:

```ini
ARBITRUM_ALCHEMY_MAINNET=https://arb-mainnet.g.alchemy.com/v2/your-key
WALLET_SECRET=0xYOUR_PRIVATE_KEY

SLIPPAGE_BPS=75     # 0.75%
DEADLINE_SECS=1200  # 20 minutes
APPROVE_MAX=1       # optional (for swap_router_dual)
```

---

## 🚀 Usage

### `swap_wbtc_to_usdc.cjs`

```bash
node swap_wbtc_to_usdc.cjs 0.001
```

Swaps WBTC → USDC using AlphaRouter.

---

### `swap_usdc_to_wbtc.js`

```bash
node swap_usdc_to_wbtc.js 10
```

Swaps 10 USDC → WBTC. Approves USDC for SwapRouter02 if needed.

---

### `swap_router_dual.js`

```bash
# Swap USDC → WBTC
node swap_router_dual.js 100 --dir usdc2wbtc

# Swap WBTC → USDC
node swap_router_dual.js 0.001 --dir wbtc2usdc
```

The script supports multiple aliases (`--dir usdc2wbtc`, `--dir buywbtc`, etc.).

---

## 🔑 Key addresses (Arbitrum One)

- **WBTC**: `0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f` (8 decimals)
- **USDC**: `0xaf88d065e77c8cc2239327c5edb3a432268e5831` (6 decimals)
- **SwapRouter02**: `0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45`

---

## 🧩 Notes

- Scripts use **AlphaRouter** to compute optimal V3 routes.
- Slippage and deadline are configurable via `.env`.
- On first run, the scripts will send an **ERC-20 approval** to SwapRouter02 if allowance is insufficient.
- `swap_router_dual.js` supports **approve max** via `APPROVE_MAX=1`.

---

## 📁 File map

```
swap_router_dual.js     # Bidirectional swaps (USDC ↔ WBTC)
swap_usdc_to_wbtc.js    # USDC -> WBTC
swap_wbtc_to_usdc.cjs   # WBTC -> USDC
README.md               # Documentation (this file)
```

---

### License

MIT (or your preference).
