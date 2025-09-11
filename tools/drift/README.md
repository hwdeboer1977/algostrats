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

The first arg is the SDK subcommand: e.g. `deposit`, `request-withdraw`, `withdraw`, or anything supported by `@drift-labs/vaults-sdk/cli.ts`.

Examples:

```bash
# Show CLI help (default if you pass no args)
node vaultNew.mjs --help

# Deposit using defaults from .env (vault address, deposit authority, amount)
node vaultNew.mjs deposit

# Request a withdraw (uses .env DRIFT_VAULT_ADDRESS, DRIFT_VAULT_AUTHORITY, DRIFT_DEFAULT_AMOUNT)
node vaultNew.mjs request-withdraw

# Withdraw: if you omit --vault-depositor-address, it derives the PDA automatically
node vaultNew.mjs withdraw
```

What `vaultNew.mjs` does for you:

- **Env injection:** Ensures `--url` and `--keypair` are set (from `SOLANA_RPC`/`RPC_URL` and `WALLET_SOLANA_SECRET`), plus `--env`. Adds `--vault-address` and authority/amount flags where appropriate.
- **PDA derivation for withdraw:** If you didn’t pass `--vault-depositor-address`, it derives it using seeds `["vault_depositor", vaultPubkey, authorityPubkey]` and the vault account’s **owner** (the vaults program id) as the program id. You’ll see `ℹ Derived depositor PDA: ...` printed.
- **Signature sniffing:** Captures base58 transaction signatures from stdout/stderr and prints a final summary with a **Solscan** link.
- **Skip preflight:** Adds `--skip-preflight` when `DRIFT_SKIP_PREFLIGHT=1`.

> Under the hood it spawns: `npx tsx <path>/@drift-labs/vaults-sdk/cli/cli.ts ...args` and passes your arguments plus injected defaults.

---

## 📊 `read_position_info.mjs` — Programmatic Snapshot

This helper returns a **structured snapshot** for dashboards/keepers and can also print a readable summary if run directly.

- Connects via `SOLANA_RPC` and **fetches vault and depositor accounts**.
- Determines **deposit mint decimals** (fetching the mint when available).
- Invokes your local CLI (`vault.mjs` path is configurable) to parse **`vaultEquity (USDC)`**, converts to base units (6 dp), and computes:
  - `totalShares`, `yourShares`, `netDeposits`
  - `ppsScaled`, `yourBalance`, `earnings`, `roiPct`
  - plus pretty-formatted strings in `fmt`.

Run it:

```bash
node read_position_info.mjs
```

Use it as a library (example):

```js
import { getDriftSnapshot } from "./read_position_info.mjs";
const s = await getDriftSnapshot();
console.log(s.fmt.balance, s.roiPct);
```

---

## 🔑 Keypair utilities

- **Create a brand-new keypair (for testing):**

  ```bash
  node createTestKeypair.mjs
  # -> prints pubkey, writes id_test.json
  ```

  Saves a JSON array (64 bytes) compatible with Solana CLI tooling.

- **Convert base58 secret (from .env) to JSON keypair:**
  ```bash
  node convertKeyPair.mjs
  # -> reads WALLET_SOLANA_SECRET from .env, writes id.json
  ```
  Decodes the base58 secret and dumps it as an array for convenience.

> Note: `vaultNew.mjs` can **materialize a temp keypair file** automatically if you provide the JSON array form via `WALLET_SOLANA_SECRET=[...]`. It cleans this file up after the run.

---

## 🧮 Deriving the VaultDepositor PDA (standalone)

If you want to compute the PDA manually:

```bash
node derive_VaultDepositor.mjs <VAULT_ADDRESS> [AUTHORITY_PUBKEY]
```

- The script fetches the **vault account** to read its **owner** (the vaults program id) and derives the PDA via:
  ```
  seeds = ["vault_depositor", vault, authority]
  ```
  Prints the PDA and bump.

---

## 🧪 Typical flows

- **Deposit (happy path)**

  1. Fund your wallet.
  2. Set `DRIFT_VAULT_ADDRESS`, `DRIFT_VAULT_AUTHORITY`, `DRIFT_DEFAULT_AMOUNT` in `.env`.
  3. `node vaultNew.mjs deposit` → confirm tx; signature and explorer link are printed.

- **Withdraw (with auto-PDA)**

  1. Ensure `DRIFT_VAULT_ADDRESS` and `DRIFT_VAULT_AUTHORITY` are set.
  2. `node vaultNew.mjs withdraw` → PDA derived and injected; signature printed.

- **Monitor position**
  - `node read_position_info.mjs` → prints **equity, shares, net deposits, earnings, ROI**. Use the exported function in your keeper/agent.

---

## 🛠 Troubleshooting

- **“Missing RPC URL / keypair”** — ensure `SOLANA_RPC` (or `RPC_URL`) and a **wallet secret** are present in `.env`. Acceptable secret forms: JSON array (64 bytes), base58 string, or path to a JSON keypair. `vaultNew.mjs` will fail fast with clear errors if not found.
- **Withdraw needs PDA** — if you don’t pass `--vault-depositor-address`, the script derives it; if derivation fails, verify **vault address** and **authority pubkey**.
- **`read_position_info.mjs` can’t find `vaultEquity (USDC)`** — it parses your local CLI output; confirm `CLI_PATH` and that the CLI prints that line (it matches the regex inside the script).

---

## 🔐 Security Notes

- Treat any `id.json` / `id_test.json` as **sensitive**. Never commit secrets.
- Prefer environment variables or a secure secrets manager in production.
- The convenience printing of **tx signatures** is for visibility; always verify on-chain.

---

## 📁 File map

```
convertKeyPair.mjs        # Base58 secret (.env) -> id.json (JSON keypair)
createTestKeypair.mjs     # Generate test keypair (pubkey + id_test.json)
derive_VaultDepositor.mjs # Derive VaultDepositor PDA from vault + authority
read_position_info.mjs    # Programmatic vault snapshot (equity, ROI, etc.)
vaultNew.mjs              # Wrapper around Drift Vaults TS CLI (defaults, PDA, sig)
```

---

### License

MIT (or your preference).
