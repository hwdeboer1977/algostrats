#!/usr/bin/env python3
"""
create_orders.py — Hyperliquid-only (minimal args)

Now supports an optional ACTION positional argument to override the USER CONFIG.
Examples:
  python create_orders.py summary
  python create_orders.py open coin=ETH side=buy size=0.25 slippage=0.01
  python create_orders.py close coin=ETH
  python create_orders.py cancel coin=ETH

If no args are provided, it falls back to the USER CONFIG block.
"""

from __future__ import annotations
import json
import sys
from typing import Any, Dict, List

from hyperliquid.utils import constants
from hyperliquid.info import Info

import example_utils  # must be in the same folder


# =========================
# ===== USER CONFIG =======
# =========================
# Choose exactly one ACTION: "summary", "open", "close", "cancel"
ACTION: str = "summary"

# For ACTION == "open"
OPEN_PARAMS = {
    "coin": "ETH",     # e.g., "ETH", "BTC", "SOL"
    "side": "buy",     # "buy"/"long" or "sell"/"short"
    "size": 0.25,      # contract size
    "slippage_frac": 0.01,  # 1% max slippage
}

# For ACTION == "close"
CLOSE_COIN: str = "ETH"

# For ACTION == "cancel"
CANCEL_COIN: str = "ETH"


# =========================
# ====== CORE LOGIC =======
# =========================

def _pretty(obj: Any) -> str:
    return json.dumps(obj, indent=2, sort_keys=False, ensure_ascii=False)


def _setup(skip_ws: bool = True):
    """Reuses your example_utils.setup() with MAINNET URL and returns (address, info, exchange)."""
    return example_utils.setup(base_url=constants.MAINNET_API_URL, skip_ws=skip_ws)


def get_account_summary() -> Dict[str, Any]:
    """
    Returns a dictionary with:
      - marginSummary subset
      - spot balances
      - open orders
      - open perp positions
      - mids sample
    """
    address, info, _ = _setup(skip_ws=True)
    result: Dict[str, Any] = {"address": address}

    # margin summary
    user_state = info.user_state(address)
    result["marginSummary"] = user_state.get("marginSummary", {})

    # spot balances
    spot_user_state = info.spot_user_state(address)
    result["spotBalances"] = spot_user_state.get("balances", [])

    # open orders
    result["openOrders"] = info.open_orders(address)

    # open positions (non-zero szi)
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

    # mids snapshot (subset to keep output readable)
    try:
        mids = info.all_mids()
        if isinstance(mids, dict):
            sample = dict(list(mids.items())[:8])
            result["midsSample"] = sample
    except Exception:
        result["midsSample"] = {}

    return result


def open_market(coin: str, side: str, size: float, slippage_frac: float = 0.01) -> Dict[str, Any]:
    """
    Market open a position.
    side: 'buy' or 'sell' (also accepts 'long'/'short')
    size: contract size in the coin units (e.g. ETH for ETH-perp)
    """
    is_buy = side.lower() in ("buy", "long")
    _, _, exchange = _setup(skip_ws=True)
    res = exchange.market_open(coin, is_buy, float(size), None, float(slippage_frac))
    return {"action": "open", "coin": coin, "side": "buy" if is_buy else "sell", "size": size, "result": res}


def close_market(coin: str) -> Dict[str, Any]:
    """Reduce-only market close for the coin's current position."""
    _, _, exchange = _setup(skip_ws=True)
    res = exchange.market_close(coin)
    return {"action": "close", "coin": coin, "result": res}


def cancel_resting_orders(coin: str) -> Dict[str, Any]:
    """Cancel all resting orders for a specific coin for the configured address."""
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
# ==== ARG PARSING ========
# =========================

def _apply_kv_overrides(pairs: list[str]) -> None:
    """
    Apply simple key=value overrides from the command line to the config vars.
    Supported keys:
      - For open: coin, side, size, slippage or slippage_frac
      - For close/cancel: coin
    """
    global OPEN_PARAMS, CLOSE_COIN, CANCEL_COIN
    for raw in pairs:
        if "=" not in raw:
            continue
        k, v = raw.split("=", 1)
        k = k.strip().lower()
        v = v.strip()

        if k in ("coin", "side"):
            OPEN_PARAMS[k] = v
            if k == "coin":
                CLOSE_COIN = v
                CANCEL_COIN = v
        elif k in ("size",):
            try:
                OPEN_PARAMS["size"] = float(v)
            except ValueError:
                pass
        elif k in ("slippage", "slippage_frac"):
            try:
                OPEN_PARAMS["slippage_frac"] = float(v)
            except ValueError:
                pass


def _resolve_action_from_argv(default_action: str) -> str:
    """
    Allows: python create_orders.py <action> [key=value ...]
    e.g.,   python create_orders.py open coin=ETH side=buy size=0.5 slippage=0.01
    """
    if len(sys.argv) >= 2:
        action = sys.argv[1].lower()
        if action in ("summary", "open", "close", "cancel"):
            # Apply optional key=value overrides
            if len(sys.argv) > 2:
                _apply_kv_overrides(sys.argv[2:])
            return action
    return default_action


# =========================
# ========= MAIN ==========
# =========================

def main():
    action = _resolve_action_from_argv(ACTION)

    if action == "summary":
        summary = get_account_summary()
        print("\n🔎 Account Summary")
        print(_pretty(summary))

    elif action == "open":
        coin = OPEN_PARAMS["coin"]
        side = OPEN_PARAMS["side"]
        size = float(OPEN_PARAMS["size"])
        slippage = float(OPEN_PARAMS.get("slippage_frac", 0.01))
        result = open_market(coin, side, size, slippage)
        print("\n🚀 Open Market Result")
        print(_pretty(result))

    elif action == "close":
        result = close_market(CLOSE_COIN)
        print("\n🔚 Close Market Result")
        print(_pretty(result))

    elif action == "cancel":
        result = cancel_resting_orders(CANCEL_COIN)
        print("\n🧹 Cancel Orders Result")
        print(_pretty(result))

    else:
        print(f"Unknown ACTION: {action}. Valid: 'summary', 'open', 'close', 'cancel'.")


if __name__ == "__main__":
    main()
