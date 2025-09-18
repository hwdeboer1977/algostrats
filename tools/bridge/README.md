# LI.FI Cross-Chain USDC Bridge (Arbitrum ↔ Solana)

This repo contains two Node.js scripts that demonstrate bridging **USDC** between **Arbitrum** and **Solana** using the LI.FI SDK.

---

## ✨ Scripts

- **`lifi_bridge_sol.cjs`** — **Arbitrum → Solana** (USDC from Arbitrum to Solana)
- **`lifi_bridge_arb.cjs`** — **Solana → Arbitrum** (USDC from Solana to Arbitrum)

> ⚠️ Note: In principle, these could be merged into **one script** with a toggle in the `params` section. For clarity, we keep them separate here.

Each script:

- Wires up an **EVM signer** (Arbitrum) via `viem`
- Wires up a **Solana signer** via `KeypairWalletAdapter`
- Uses the **LI.FI SDK** providers for EVM and Solana
- Calls `getRoutes(...)` to request a route and `executeRoute(...)` to run it

---

## ✅ Prerequisites

- Node.js 18+
- Arbitrum RPC URL (Alchemy/Infura/etc.)
- A funded EVM wallet (gas on Arbitrum)
- A funded Solana wallet (a little SOL for rent/fees)
- USDC balance on the **source** chain
- Install packages:
  ```bash
  npm i @lifi/sdk viem dotenv
  ```

---

## 🌐 Environment Variables (`.env`)

Place your `.env` **two levels up** from these scripts (they use `path.resolve(__dirname, "../../.env")`).

Example:

```ini
# Arbitrum RPC
ARBITRUM_ALCHEMY_MAINNET=https://arb-mainnet.g.alchemy.com/v2/your-key

# EVM signer (hex private key, 0x-prefixed)
WALLET_SECRET=0xabc123...deadbeef

# Solana signer (base58 private key string)
WALLET_SOLANA_SECRET=your-solana-secret-string

# Solana public key (destination/source address)
SOLANA_PUBKEY=YourSolanaPublicKeyBase58
```

---

## 📦 Token & Chain IDs

- **USDC on Arbitrum:** `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`
- **USDC on Solana:** `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- **Arbitrum chainId:** `42161`
- **Solana (LI.FI chainId):** `1151111081099710`

---

## 🚀 Usage

Run either script with Node:

```bash
# Bridge from Arbitrum → Solana
node lifi_bridge_sol.cjs

# Bridge from Solana → Arbitrum
node lifi_bridge_arb.cjs
```

Both scripts will:

1. Fetch the optimal route via LI.FI
2. Print the route details
3. Execute the bridging transaction
4. Display the transaction signature/confirmation

---

## 📁 File map

```
lifi_bridge_arb.cjs  # Bridge USDC Solana → Arbitrum
lifi_bridge_sol.cjs  # Bridge USDC Arbitrum → Solana
README.md            # Documentation (this file)
```

---

### License

MIT (or your preference).
