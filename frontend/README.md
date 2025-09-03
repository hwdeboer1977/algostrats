# Algostrats Frontend

A minimal, modular dApp frontend built with **Vite**.  
It supports **multi-wallet discovery via EIP-6963**, clean React hooks for wallet + vault logic, and a lightweight card-based UI.

---

## Features

- **Vite + React** — fast HMR, tiny config, easy builds.
- **EIP-6963 multi-wallet discovery** — detects MetaMask, Rabby, OKX, Phantom (EVM), Coinbase Wallet, Frame, etc., and lets users pick in a modal.
- **Network reactivity** — reacts immediately to **account** and **chain** changes.
- **Modular design**
  - `WalletProvider.jsx` — all wallet state & events in one place.
  - `ConnectButton.jsx` — single “Connect Wallet” button with picker modal if multiple wallets exist.
  - `useVault.jsx` — isolated vault interactions (ERC-4626 style): balances, share price, approve → deposit, withdraw, redeem, previews, block-by-block refresh.
  - `VaultInteractions.jsx` — small, composable UI that uses `useVault`.
  - `ui/Card.jsx` + `App.css` — simple card layout and consistent button styles.
- **Robust reads** — background polling **keeps last good values** and ignores transient RPC hiccups (no noisy UI errors).
- **Config in source** — `src/config.json` (not `public/`) for addresses/decimals.
- **Private RPC ready** — use your own endpoints via `.env` with safe public fallback.

---

## Project Structure (key files)

```
src/
  App.jsx
  App.css
  config.json               # chainId, vaultAddress, asset (WBTC) address, decimals, etc.
  WalletProvider.jsx
  ConnectButton.jsx
  useVault.jsx              # vault hook (ERC-4626)
  VaultInteractions.jsx
  abis/
    vault.json              # actual vault ABI
  ui/
    Card.jsx
```

---

## Prerequisites

- Node.js 18+ (recommended)
- A browser wallet (MetaMask, Rabby, OKX, Phantom EVM, etc.)
- RPC endpoints (private preferred)

---

## Setup

1. **Install**

```bash
npm install
```

2. **Environment (.env)**
   Create `.env` in the project root to supply your private RPCs (recommended):

```bash
# Example: Arbitrum
VITE_RPC_ARB=https://your-private-arbitrum-endpoint.example.com/abcdef

# Optionally other chains if you enable them in WalletProvider
VITE_RPC_ETH=https://your-private-eth-endpoint.example.com/abcdef
VITE_RPC_BASE=https://your-private-base-endpoint.example.com/abcdef
```

3. **Config (`src/config.json`)**

Put chain + contract addresses here (must live in `src/`, not `public/`):

```json
{
  "chainId": 42161,
  "vaultAddress": "0xYourVaultAddress",
  "wbtcAddress": "0xWBTCAddressOnThisChain",
  "wbtcDecimals": 8,
  "shareSymbol": "yWBTC"
}
```

> If you must keep JSON in `public/`, fetch it at runtime (`fetch("/config.json")`).  
> Importing from JS requires it to be under `src/`.

---

## How to Run

**Dev (HMR):**

```bash
npm run dev
```

**Build:**

```bash
npm run build
```

**Preview production build:**

```bash
npm run preview
```

Open the shown URL and click **Connect Wallet**.

---
