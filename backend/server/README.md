# Backend API (Express + Script Runner)

This backend provides a simple **Express API** that proxies requests into local swap/bridge/drift/hyperliquid scripts.  
It also includes a Winston-based **logger** with daily file rotation.

---

## ✨ Features

- **Swap**: `/api/swap/wbtc-usdc` → runs Uniswap swap script (injects correct private key by wallet alias).
- **Bridge**: `/api/bridge/bridge-lifi` → runs LI.FI cross-chain bridge script.
- **Drift**:
  - `/api/drift/get-pos-drift`
  - `/api/drift/deposit-drift`
  - `/api/drift/withdraw`
  - `/api/drift/finalize`
- **Hyperliquid**: `/api/hl-command` → open/close/cancel/summary via `create_orders.py`.

Other endpoints:

- `/api/health` — health check
- `/api/debug/scripts` — lists registered scripts

---

## 🛠 Setup

Install dependencies:

```bash
npm install express cors winston winston-daily-rotate-file dotenv
```

Create `.env` in repo root with keys like:

```ini
PORT=4000
PK_OWNER=0x...
PK_RECIPIENT_A=0x...
PK_RECIPIENT_B=0x...
LOG_DIR=./logs
LOG_LEVEL=info
```

---

## 🚀 Run

```bash
node server.js
```

The API listens on `:4000` by default (configurable via `PORT`).

---

## 📁 Files

- **server.js** — Express API + script runner (spawns Python/Node child processes).
- **logger.js** — Winston logger with console + daily rotating file output.

---

### License

MIT (or your preference).
