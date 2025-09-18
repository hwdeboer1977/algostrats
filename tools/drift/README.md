# README.md — Drift Vault Helper Scripts

This repo contains a small toolkit around the **Drift Vaults** program on Solana. The centerpiece is **`vaultNew.mjs`**, a convenience wrapper around the `@drift-labs/vaults-sdk` TypeScript CLI that auto-fills flags from your `.env`, derives missing PDAs, and prints the final transaction signature with an explorer link.

---

## ✨ What’s inside

- **`vaultNew.mjs`** — One CLI to rule them all:
  - Injects `--url`, `--env`, `--keypair`, and typical subcommand flags from `.env`.
  - Derives the **VaultDepositor PDA** automatically when you call `withdraw`.
  - Supports `DRIFT_SKIP_PREFLIGHT=1` and extracts/prints the **tx signature** at the end.
- **`read_position_info.mjs`** — Programmatic snapshot helper:
  - Calls the Drift SDK + your local CLI to fetch **vault equity (USDC)**, shares, your balance, earnings, and ROI; returns a neat JS object (and prints a readable summary if run directly).
- **`derive_VaultDepositor.mjs`** — Standalone **PDA derivation** script for a given vault and authority. Handy for inspection and debugging.
- **`request_withdraw.mjs`** — Request a withdraw in **USDC terms** instead of shares. Runs `read_position_info.mjs` to compute shares needed, then calls `vaultNew.mjs request-withdraw`.
- **`createTestKeypair.mjs`** — Generates a fresh Solana keypair, prints the pubkey, and saves the secret key JSON (`id_test.json`).
- **`convertKeyPair.mjs`** — Converts a base58 secret from `.env` into the JSON keypair format `id.json` (64-byte array).

---

## ✅ Prerequisites

- Node.js 18+
- A `.env` at **two levels up** from these scripts (adjust pathing if your layout differs).
- Funded Solana wallet with permissions to interact with the vault.

**Recommended `.env` keys:**

```ini
# RPC / network
SOLANA_RPC=https://api.mainnet-beta.solana.com
# or RPC_URL=...

ENV=mainnet-beta

# Wallet secret: choose one of the following forms
WALLET_SOLANA_SECRET=[...64 numbers...]  # JSON array (preferred here)
# or a base58 string (see convert/notes below)
# or a filesystem path to a JSON keypair

# Drift vault defaults
DRIFT_VAULT_ADDRESS=...
DRIFT_VAULT_AUTHORITY=...         # your depositor authority pubkey
DRIFT_DEFAULT_AMOUNT=5            # default amount for deposit/withdraw subcmds
DRIFT_SKIP_PREFLIGHT=1            # optional: add --skip-preflight automatically
```

> `vaultNew.mjs` loads `.env` from `../../.env` and will **materialize a temp keypair file** if you provide the JSON-array secret directly. It also injects defaults for `--url`, `--keypair`, `--env`, and (when relevant) `--vault-address`, `--deposit-authority`, `--authority`, `--amount`.

---

## 🚀 Install

From the folder that contains the scripts:

```bash
npm install @drift-labs/vaults-sdk tsx @solana/web3.js @solana/spl-token dotenv
```

(If your project already depends on these, you can skip re-installing.)

---

## 🧠 `vaultNew.mjs` — Usage & Concepts

`vaultNew.mjs` **proxies** to the TS CLI inside `@drift-labs/vaults-sdk` via `npx tsx`, adding a smart layer that fills missing flags and quality-of-life improvements.

### Subcommands (proxied to the SDK CLI)

Examples:

```bash
# Deposit using defaults from .env (vault address, deposit authority, amount)
node vaultNew.mjs deposit

# Request a withdraw (defaults from .env)
node vaultNew.mjs request-withdraw

# Withdraw: derives VaultDepositor PDA if missing
node vaultNew.mjs withdraw
```

---

## 📊 `read_position_info.mjs`

Returns a **structured snapshot** for dashboards/keepers and can also print a readable summary if run directly.

```bash
node read_position_info.mjs
```

Or as a library:

```js
import { getDriftSnapshot } from "./read_position_info.mjs";
const s = await getDriftSnapshot();
console.log(s.fmt.balance, s.roiPct);
```

---

## 💸 `request_withdraw.mjs`

Request a withdrawal in **USDC terms** instead of shares.

**Usage:**

```bash
node request_withdraw.mjs --usdc 50 --vault-address <VAULT> --authority <YOU>
```

What it does:

1. Reads vault stats via `read_position_info.mjs`.
2. Computes price/share and converts USDC → shares.
3. Calls `vaultNew.mjs request-withdraw --amount <shares>`.
4. Prints follow-up instructions to run `withdraw` after the redeem delay.

---

## 🔑 Keypair utilities

- **Create a brand-new keypair:**
  ```bash
  node createTestKeypair.mjs
  ```
- **Convert base58 secret → JSON keypair:**
  ```bash
  node convertKeyPair.mjs
  ```

---

## 🧮 Deriving the VaultDepositor PDA

```bash
node derive_VaultDepositor.mjs <VAULT_ADDRESS> [AUTHORITY_PUBKEY]
```

---

## 🧪 Typical flows

- **Deposit:**  
  `node vaultNew.mjs deposit`
- **Request Withdraw in USDC:**  
  `node request_withdraw.mjs --usdc 100 --vault-address <VAULT> --authority <YOU>`
- **Withdraw (auto PDA):**  
  `node vaultNew.mjs withdraw`
- **Monitor:**  
  `node read_position_info.mjs`

---

## 📁 File map

```
convertKeyPair.mjs        # Base58 secret (.env) -> id.json (JSON keypair)
createTestKeypair.mjs     # Generate test keypair (pubkey + id_test.json)
derive_VaultDepositor.mjs # Derive VaultDepositor PDA from vault + authority
read_position_info.mjs    # Programmatic vault snapshot (equity, ROI, etc.)
request_withdraw.mjs      # Withdraw in USDC terms, auto-converts to shares
vaultNew.mjs              # Wrapper around Drift Vaults TS CLI (defaults, PDA, sig)
```

---

### License

MIT (or your preference).
