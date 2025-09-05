# Hyperliquid Standalone Script

This script (`create_orders.py`) provides a simple way to interact with the **Hyperliquid** exchange without running a relayer or using a CLI.  
It wraps the `hyperliquid-python` SDK and your `example_utils.py` setup.

---

## Features

- **Account summary**: view margin info, balances, open orders, and positions
- **Open market order**: go long/short with slippage protection
- **Close market order**: reduce-only close of a position
- **Cancel resting orders**: cancel all open limit orders for a coin

---

## Setup

1. Ensure you have `example_utils.py` and a `config.json` in the same folder.

### Example `config.json`

```json
{
  "secret_key": "0xYOUR_PRIVATE_KEY",
  "account_address": "0xYOUR_PUBLIC_ADDRESS"
}
```
