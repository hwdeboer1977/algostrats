# Algostrats Frontend (Vite + React)

A minimal, modular dApp frontend for the Algostrats project. It supports **EIP‑6963 multi‑wallet discovery**, vault interactions (ERC‑4626 style), and an **Admin** panel that talks to your backend API for swaps, bridging, Drift, and Hyperliquid actions.

---

## ✨ Features

- **Vite + React** with fast HMR.
- **EIP‑6963 multi‑wallet discovery** and a clean **Connect Wallet** UX.
- **Network reactivity**: updates on account/chain changes.
- **Vault UI**: approve → deposit / withdraw / redeem with preview reads.
- **Admin panel** (optional): server‑side **swap**, **bridge (LI.FI)**, **Hyperliquid open/close**, and **Drift deposit/withdraw/finalize**.
- **Lightweight UI**: card layout, buttons, collapsible outputs that auto‑hide after 6s (still toggle‑able).

---

## 🗂 Current `src/` contents (and what each does)

```
src/
  abis/                    # Contract ABIs (e.g., vault.json)
  assets/                  # Images/icons used in UI

  Admin.jsx                # Admin dashboard (server actions; toggle via VITE_ENABLE_ADMIN)
  AdminLayout.css          # Admin page styles

  App.css                  # Global app styles (non-admin)
  App.jsx                  # App shell: header, routes, Connect button, Vault card

  bridgeLiFi.jsx           # Bridge card → calls backend /api/bridge/bridge-lifi
  Card.jsx                 # Simple card component used across the UI
  config.json              # Frontend config: chainId, addresses, decimals, symbols
  ConnectButton.jsx        # EIP‑6963 wallet picker + connection state

  driftControls.jsx        # Drift: deposit / request-withdraw / finalize (backend calls)
  HLOpenOrder.jsx          # Hyperliquid open/close/summary (backend /api/hl-command)

  index.css                # Global stylesheet imported by main.jsx
  main.jsx                 # Vite entry → mounts <App />

  swapUniswap.jsx          # Optional: client-side demo for Uniswap swap (can be hidden in prod)

  UseVault.jsx             # Hook for reading/writing to ERC‑4626 vault (previewDeposit, deposit, withdraw, etc.)
  VaultInteractions.jsx    # Vault UI card (uses UseVault + WalletProvider)

  WalletProvider.jsx       # Wallet context: provider, signer, chain events, EIP‑6963 registry
```

> If you don’t need certain features, you can delete these optional files: **Admin.jsx**, **bridgeLiFi.jsx**, **driftControls.jsx**, **HLOpenOrder.jsx**, **swapUniswap.jsx**. The rest form the core app.

---

## 🔧 Setup

1. **Install deps**

```bash
npm install
```

2. **Environment (.env)**

```ini
# Toggle Admin route/button
VITE_ENABLE_ADMIN=true

# Frontend → backend base URL for Admin actions
VITE_ADMIN_API_URL=http://localhost:4000

# Private RPCs (recommended)
VITE_RPC_ARB=https://your-private-arbitrum-endpoint
```

3. **Config (`src/config.json`)**

```json
{
  "chainId": 42161,
  "vaultAddress": "0xYourVaultAddress",
  "wbtcAddress": "0xWBTCAddressOnArbitrum",
  "wbtcDecimals": 8,
  "shareSymbol": "yWBTC"
}
```

---

## ▶️ Run

**Dev (HMR):**

```bash
npm run dev
```

**Build:**

```bash
npm run build
```

**Preview prod:**

```bash
npm run preview
```

Open the shown URL. Click **Connect Wallet**, then use the **Vault** card. If `VITE_ENABLE_ADMIN=true`, an **Admin** pill/link appears in the header → navigate to server tools.

---

## 🔌 Admin → Backend Endpoints (expected)

- `POST /api/hl-command` — Hyperliquid open/close/summary
- `POST /api/bridge/bridge-lifi` — LI.FI bridge
- `POST /api/drift/get-pos-drift` — Drift snapshot
- `POST /api/drift/deposit-drift` — Deposit to Drift vault
- `POST /api/drift/withdraw` — Request withdraw
- `POST /api/drift/finalize` — Finalize withdraw

Configure the base via **`VITE_ADMIN_API_URL`**.

---

## ✅ Checklist (quick sanity)

- [ ] `src/config.json` filled (chainId, addresses, decimals).
- [ ] `src/abis/vault.json` present and matches deployed vault.
- [ ] `.env` has `VITE_ADMIN_API_URL` (if Admin enabled).
- [ ] Backend is running on that base URL.
- [ ] Wallet connects and network matches `config.json.chainId`.

---

### License

MIT (or your preference).
