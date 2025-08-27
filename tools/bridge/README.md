# LI.FI Cross-Chain USDC Bridge (Arbitrum ↔ Solana)

This README explains how to run two bridge flows using the LI.FI SDK with **one script** (Node.js):

- ../lifi_bridge_sol.cjs: **ARB → SOL** (USDC on Arbitrum → USDC on Solana)
- ../lifi_bridge_arb.cjs: **SOL → ARB** (USDC on Solana → USDC on Arbitrum)

PM: > We do **not** need two scripts. Toggle the `params` section to switch directions and merge into 1 script!

The script wires up:

- An **EVM signer** (Arbitrum) via `viem`,
- A **Solana signer** via `KeypairWalletAdapter`,
- The **LI.FI SDK** providers for EVM and Solana,
- Then requests a route with `getRoutes(...)` and executes it with `executeRoute(...)`.

---

## 1) Prerequisites

- **Node.js 18+**
- An Arbitrum RPC URL (Alchemy/Infura/etc.)
- A funded EVM wallet (gas on Arbitrum)
- A funded Solana wallet (rent + fees; a little SOL is required)
- USDC balance on the **source** chain (Arbitrum or Solana, depending on direction)
- Packages:
  ```bash
  npm i @lifi/sdk viem dotenv
  ```

---

## 2) Environment Variables (`.env`)

Create a `.env` **two levels above** your script (as per `path.resolve(__dirname, "../../.env")`). Example:

```ini
# EVM (Arbitrum)
ARBITRUM_ALCHEMY_MAINNET=https://arb-mainnet.g.alchemy.com/v2/your-key

# EVM signer (hex private key, 0x-prefixed)
WALLET_SECRET=0xabc123...deadbeef

# Solana signer (base58 private key or secret string compatible with your adapter)
WALLET_SOLANA_SECRET=your-solana-secret-string

# Solana public key (destination/source address when bridging)
SOLANA_PUBKEY=YourSolanaPublicKeyBase58
```

---

## 3) Token & Chain IDs

- **USDC on Arbitrum:** `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`
- **USDC on Solana:** `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- **Arbitrum chainId:** `42161`
- **Solana (LI.FI chainId):** `1151111081099710`

---
