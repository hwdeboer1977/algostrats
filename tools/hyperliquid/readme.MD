# Hyperliquid Standalone Scripts

This repo contains standalone scripts to interact with **Hyperliquid** and Arbitrum without running a relayer or custom backend.  
They cover account management, deposits, withdrawals, token transfers, and trading.

---

## Scripts Overview

### 1. `create_orders.py`

Wrapper around the `hyperliquid-python` SDK + `example_utils.py` for direct trading.

**Features**

- View account summary (balances, margin, open orders, positions).
- Open market orders (long/short) with slippage + leverage control.
- Close positions (full or partial).
- Cancel all resting limit orders for a coin.

**Examples**

```bash
# Account summary
python create_orders.py summary

# Open long 0.025 ETH, 10x cross margin
python create_orders.py open coin=ETH side=buy size=0.025 leverage=10 margin=cross

# Close full position
python create_orders.py close coin=ETH

# Partial close (10% of position)
python create_orders.py close coin=ETH pct=10

# Cancel all orders on ETH
python create_orders.py cancel coin=ETH
```

---

### 2. `deposit_HL.py`

Deposit **USDC on Arbitrum** into your Hyperliquid account.

**Usage**

```bash
python deposit_HL.py <amountUSDC> [--pk 0xPRIVATE_KEY] [--no-wait]
```

**Notes**

- Requires `ARB_RPC` or `ARBITRUM_ALCHEMY_MAINNET` in `.env`.
- Minimum deposit: 5 USDC.
- Waits until credited on HL (can skip with `--no-wait`).
- Uses `HL_BRIDGE2` contract on Arbitrum.

---

### 3. `withdraw_HL.py`

Withdraw **USDC from Hyperliquid back to Arbitrum**.

**Usage**

```bash
python withdraw_HL.py <amountUSDC> [--pk 0x...] [--dest 0x...] [--config path.json] [--no-wait] [--testnet]
```

**Notes**

- Signs an **EIP-712 withdraw message** as HL expects.
- Defaults destination to your signer address (EOA).
- Waits for Arbitrum USDC credit unless `--no-wait`.
- Config fallback supported (`config.json` with `secret_key` + `account_address`).

---

### 4. `send_usdc.py`

Send **USDC on Arbitrum** between two wallets.

**Usage**

```bash
python send_usdc.py --amount=10
```

**Env vars required**

- `ARBITRUM_ALCHEMY_MAINNET` → RPC URL
- `PK_RECIPIENT_B` (or `PRIVATE_KEY`) → sender key
- `WALLET_ADDRESS` → recipient address

Defaults to **1 USDC** if no amount given.

---

## Setup

1. Copy `example_utils.py` and `config.json` to the same folder as `create_orders.py`.

### Example `config.json`

```json
{
  "secret_key": "0xYOUR_PRIVATE_KEY",
  "account_address": "0xYOUR_PUBLIC_ADDRESS"
}
```

2. Add `.env` file at repo root with required variables:

```ini
ARBITRUM_ALCHEMY_MAINNET=https://arb-mainnet.alchemyapi.io/v2/KEY
ARB_RPC=https://arb1.arbitrum.io/rpc
PK_RECIPIENT_B=0xYOUR_PRIVATE_KEY
WALLET_ADDRESS=0xYOUR_RECIPIENT
```

---

## Requirements

- Python 3.9+
- `hyperliquid-python`
- `web3`
- `eth_account`
- `requests`
- `python-dotenv`

Install:

```bash
pip install -r requirements.txt
```

---

## Notes

- **Gas**: Ensure your Arbitrum wallet has ETH for gas.
- **Safety**: Keys should be passed via `.env` or CLI flags, never hardcoded.
- **Min amounts**: HL deposits/withdrawals require ≥ 5 USDC.
