#!/usr/bin/env python3
"""
create_orders.py — Hyperliquid-only (no CLI)

What this script provides:
- get_account_summary(): returns a dict summary (equity, balances, open orders, open positions)
- open_market(coin, side, size, slippage_frac=0.01)
- close_market(coin)
- cancel_resting_orders(coin)

How to use:
1) Put this file next to your existing example_utils.py and config.json.
2) Edit the USER CONFIG block below to choose an ACTION and params.
3) Run:  python create_orders.py
"""

from __future__ import annotations
import json
from typing import Any, Dict, List, Optional

from hyperliquid.utils import constants
from hyperliquid.info import Info

import example_utils  # must be in the same folder


# =========================
# ===== USER CONFIG =======
# =========================
# Choose exactly one ACTION: "summary", "open", "close", "cancel"
ACTION: str = "summary"

# Parameters if you want to open a new position
OPEN_PARAMS = {
    "coin": "ETH",          # Which perp (e.g., ETH, BTC, SOL)
    "side": "buy",          # Direction: "buy"/"long" or "sell"/"short"
    "size": 0.25,           # Position size (contracts, e.g. ETH = 0.25 ETH-perp)
    "slippage_frac": 0.01,  # Max slippage fraction allowed (1% here)
}

# Parameters if you want to close or cancel
CLOSE_COIN: str = "ETH"
CANCEL_COIN: str = "ETH"


# =========================
# ====== CORE LOGIC =======
# =========================

def _pretty(obj: Any) -> str:
    """Format dicts/lists into pretty JSON for printing."""
    return json.dumps(obj, indent=2, sort_keys=False, ensure_ascii=False)


def _setup(skip_ws: bool = True):
    """
    Wrapper around example_utils.setup().
    This loads config.json, builds an account, and returns:
    (address, info, exchange)
    - address: your wallet address
    - info:    Hyperliquid Info client (read-only API calls)
    - exchange:Hyperliquid Exchange client (trading actions)
    """
    return example_utils.setup(base_url=constants.MAINNET_API_URL, skip_ws=skip_ws)


def get_account_summary() -> Dict[str, Any]:
    """
    Collect account state into a dict:
      - Margin summary (account value, pnl, margin used, etc.)
      - Spot balances
      - Open orders
      - Open perp positions
      - A sample of mid prices for reference
    """
    address, info, _ = _setup(skip_ws=True)
    result: Dict[str, Any] = {"address": address}

    # Pull overall margin/account stats
    user_state = info.user_state(address)
    result["marginSummary"] = user_state.get("marginSummary", {})

    # Pull spot wallet balances
    spot_user_state = info.spot_user_state(address)
    result["spotBalances"] = spot_user_state.get("balances", [])

    # Pull open perp orders
    result["openOrders"] = info.open_orders(address)

    # Extract open positions (filter out empty ones with size 0)
    positions = user_state.get("assetPositions", [])
    open_positions = []
    for p in positions:
        pos = p.get("position", {})
        try:
            szi = float(pos.get("szi", 0.0))
        except Exception:
            szi = 0.0
        if szi != 0.0:
            open_positions.append(p)
    result["openPositions"] = open_positions

    # Sample some mid prices to get a quick market view
    try:
        mids = info.all_mids()
        if isinstance(mids, dict):
            sample = dict(list(mids.items())[:8])  # only first 8 to keep output readable
            result["midsSample"] = sample
    except Exception:
        result["midsSample"] = {}

    return result


def open_market(coin: str, side: str, size: float, slippage_frac: float = 0.01) -> Dict[str, Any]:
    """
    Market open a position.
    - coin: e.g., "ETH"
    - side: "buy"/"long" or "sell"/"short"
    - size: position size in contracts
    - slippage_frac: maximum slippage allowed (e.g., 0.01 = 1%)
    """
    is_buy = side.lower() in ("buy", "long")
    _, _, exchange = _setup(skip_ws=True)
    res = exchange.market_open(coin, is_buy, float(size), None, float(slippage_frac))
    return {"action": "open", "coin": coin, "side": "buy" if is_buy else "sell", "size": size, "result": res}


def close_market(coin: str) -> Dict[str, Any]:
    """
    Market-close the current position in `coin`.
    Always reduce-only (no accidental flip).
    """
    _, _, exchange = _setup(skip_ws=True)
    res = exchange.market_close(coin)
    return {"action": "close", "coin": coin, "result": res}


def cancel_resting_orders(coin: str) -> Dict[str, Any]:
    """
    Cancel all open limit orders for `coin`.
    """
    address, info, exchange = _setup(skip_ws=True)
    oo = info.open_orders(address)
    targets: List[Dict[str, Any]] = [o for o in oo if o.get("coin") == coin]
    out: List[Dict[str, Any]] = []

    for o in targets:
        oid = o.get("oid")
        try:
            cres = exchange.cancel(coin, oid)
            out.append({"oid": oid, "status": "cancelled", "result": cres})
        except Exception as e:
            out.append({"oid": oid, "status": "error", "error": str(e)})

    return {"action": "cancel", "coin": coin, "cancelResults": out, "found": len(targets)}


# =========================
# ========= MAIN ==========
# =========================

def main():
    """
    Entry point.
    Executes the action chosen in USER CONFIG and prints results.
    """
    if ACTION == "summary":
        summary = get_account_summary()
        print("\n🔎 Account Summary")
        print(_pretty(summary))

    elif ACTION == "open":
        coin = OPEN_PARAMS["coin"]
        side = OPEN_PARAMS["side"]
        size = float(OPEN_PARAMS["size"])
        slippage = float(OPEN_PARAMS.get("slippage_frac", 0.01))
        result = open_market(coin, side, size, slippage)
        print("\n🚀 Open Market Result")
        print(_pretty(result))

    elif ACTION == "close":
        result = close_market(CLOSE_COIN)
        print("\n🔚 Close Market Result")
        print(_pretty(result))

    elif ACTION == "cancel":
        result = cancel_resting_orders(CANCEL_COIN)
        print("\n🧹 Cancel Orders Result")
        print(_pretty(result))

    else:
        print(f"Unknown ACTION: {ACTION}. Valid: 'summary', 'open', 'close', 'cancel'.")


if __name__ == "__main__":
    main()
