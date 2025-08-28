# Drift Vaults – Quick Start

## What’s here

- **vault.mjs** — wrapper that runs the Drift **Vaults CLI**, auto-loading RPC/keypair/env from `../../.env`.
- **derive_depositor.mjs** — derives your **VaultDepositor PDA** from a vault + authority.
- **read_position_info.mjs** - gives information on your current position in the vault.

> Place both scripts in `tools/drift/`.

## Prereqs (run once in `tools/drift/`)

```bash
npm i -D tsx
npm i @drift-labs/vaults-sdk @solana/web3.js dotenv
```

## .env (two levels up: `Algostrats/.env`)

```ini
SOLANA_RPC=YOUR_RPC_URL
# one of:
WALLET_SOLANA_SECRET=BASE58_OR_JSON_ARRAY_PRIVATE_KEY
# or
# KEYPAIR_PATH=C:\Users\you\.config\solana\id.json

ENV=mainnet-beta          # optional (default)
SOLANA_PUBKEY=YOUR_PUBKEY # optional; used by derive_depositor.mjs if no arg
```

## Common commands (via `vault.mjs`)

```bash
# Vault overview (equity, totalShares, redeemPeriod)
node vault.mjs view-vault --vault-address <VAULT_PUBKEY>

# List all depositors (PDAs) for a vault
node vault.mjs list-vault-depositors --vault-address <VAULT_PUBKEY>

# Deposit (permissionless; amount in human units, e.g. 5 USDC)
node vault.mjs deposit --vault-address <VAULT_PUBKEY> --deposit-authority <YOUR_PUBKEY> --amount 5

# View your depositor account (shares, lastWithdrawRequest.ts)
node vault.mjs view-vault-depositor --vault-depositor-address <DEPOSITOR_PDA>

# Withdraw flow (amount is in **shares**)
node vault.mjs request-withdraw --vault-address <VAULT_PUBKEY> --authority <YOUR_PUBKEY> --amount <SHARES>
# After redeemPeriod has elapsed:
node vault.mjs withdraw --vault-address <VAULT_PUBKEY> --authority <YOUR_PUBKEY>
```

## Find your depositor PDA (via `derive_depositor.mjs`)

```bash
# If SOLANA_PUBKEY is in .env:
node derive_depositor.mjs <VAULT_PUBKEY>

# Or pass authority explicitly:
node derive_depositor.mjs <VAULT_PUBKEY> <YOUR_PUBKEY>
```

## Find info current position (via `read_position_info.mjs`)

```bash
# If SOLANA_PUBKEY is in .env:
node read_position_info.mjs

```
