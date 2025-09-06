#!/usr/bin/env python3
"""
create_orders.py — Hyperliquid-only (minimal args)

Examples:
  python create_orders.py summary
  python create_orders.py open coin=ETH side=buy size=0.025 slippage=0.01 leverage=10 margin=cross
  python create_orders.py open coin=ETH side=sell size=0.05 leverage=5 margin=isolated
  python create_orders.py close coin=ETH
  python create_orders.py cancel coin=ETH

If no args are provided, it falls back to the USER CONFIG block.
"""

from __future__ import annotations
import json
import sys
import math
from typing import Any, Dict, List, Optional

from hyperliquid.utils import constants
from hyperliquid.info import Info

import example_utils  # must be in the same folder

# Make stdout tolerant on Windows consoles
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


# =========================
# ===== USER CONFIG =======
# =========================
# Choose one ACTION: "summary", "open", "close", "cancel"
ACTION: str = "summary"

# For ACTION == "open"
OPEN_PARAMS = {
    "coin": "ETH",          # e.g., "ETH", "BTC", "SOL"
    "side": "buy",          # "buy"/"long" or "sell"/"short"
    "size": 0.25,           # position size in coin units
    "slippage_frac": 0.01,  # 1% max slippage
    "leverage": None,       # e.g. 1, 5, 10; None = leave unchanged
    "margin_mode": "cross", # "cross" or "isolated"
    "strict": False,        # True => fail if leverage/size isn't feasible (cross)
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

# Function to extract open positions
def _extract_open_positions(user_state: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Return only non-zero perp positions from a user_state."""
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
    return open_positions

# Function to get leverage by coin
def _leverage_by_coin(open_positions: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Map coin -> {'szi': float, 'leverage': {...}} for each open position."""
    out: Dict[str, Any] = {}
    for p in open_positions:
        pos = p.get("position", {})
        coin = pos.get("coin")
        if not coin:
            continue
        try:
            szi = float(pos.get("szi", 0.0))
        except Exception:
            szi = 0.0
        out[coin] = {
            "szi": szi,
            "leverage": pos.get("leverage"),
        }
    return out


# Helper function to get price
def _mid_px(info: "Info", coin: str) -> float:
    mids = info.all_mids()
    px = float(mids.get(coin, 0.0)) if isinstance(mids, dict) else 0.0
    if px <= 0:
        raise RuntimeError(f"Cannot fetch mid for {coin}")
    return px

# Helper function to determine free cross margin
def _free_cross_margin(info: "Info", address: str) -> float:
    us = info.user_state(address)
    ms = us.get("marginSummary", {}) or {}
    account_value = float(ms.get("accountValue", 0.0))
    total_used   = float(ms.get("totalMarginUsed", 0.0))
    return max(0.0, account_value - total_used)

# Function to get summary of account
def get_account_summary() -> Dict[str, Any]:
    """
    Returns a dictionary with:
      - marginSummary subset
      - spot balances
      - open orders
      - open perp positions
      - leverageByCoin
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
    open_positions = _extract_open_positions(user_state)
    result["openPositions"] = open_positions

    # leverage per coin
    result["leverageByCoin"] = _leverage_by_coin(open_positions)

    # mids snapshot (subset to keep output readable)
    try:
        mids = info.all_mids()
        if isinstance(mids, dict):
            sample = dict(list(mids.items())[:8])
            result["midsSample"] = sample
    except Exception:
        result["midsSample"] = {}

    return result

# Function to set the leverage
def set_leverage(coin: str, leverage: int, margin_mode: str = "cross") -> Dict[str, Any]:
    """
    Call the SDK's update_leverage with the correct signature:
        update_leverage(leverage: int, name: str, is_cross: bool = True)
    (Some builds expose updateLeverage with the same positional order.)
    """
    is_cross = str(margin_mode).lower() == "cross"
    _, _, exchange = _setup(skip_ws=True)
    lev = int(leverage)

    attempts = []

    def _attempt(fn_name, *args):
        try:
            fn = getattr(exchange, fn_name)
            res = fn(*args)  # positional only, matches your SDK
            return {"ok": True, "fn": fn_name, "args": list(args), "response": res}
        except Exception as e:
            return {"ok": False, "fn": fn_name, "args": list(args),
                    "errorType": type(e).__name__, "errorRepr": repr(e)}

    variants = [
        ("update_leverage", lev, coin, is_cross),
        ("updateLeverage", lev, coin, is_cross),
    ]

    for name, lev_, coin_, cross_ in variants:
        if hasattr(exchange, name):
            r = _attempt(name, lev_, coin_, cross_)
            attempts.append(r)
            if r["ok"]:
                return {
                    "action": "update_leverage",
                    "coin": coin,
                    "is_cross": is_cross,
                    "leverage": lev,
                    "result": r,
                }

    return {
        "action": "update_leverage",
        "coin": coin,
        "is_cross": is_cross,
        "leverage": lev,
        "error": "no_matching_method_signature",
        "attempts": attempts,
    }


# Open a new position
def open_market(
    coin: str,
    side: str,
    size: float,
    slippage_frac: float = 0.01,
    leverage: int | None = None,
    margin_mode: str = "cross",
    strict: bool = False,   # if True, abort when leverage/size isn't feasible (cross)
) -> Dict[str, Any]:
    """
    Market open a position.

    Cross mode:
      - If leverage is provided, compute the minimum feasible leverage for the requested
        size given current free margin and auto-bump to it (or fail if strict=True).
      - Then set the cap using update_leverage(leverage, name, is_cross) before opening.
    Isolated:
      - We set the leverage cap before opening; effective leverage may be tuned by
        isolated margin top-ups (not implemented here).
    """
    address, info, exchange = _setup(skip_ws=True)

    px   = _mid_px(info, coin)
    free = _free_cross_margin(info, address)

    lev_to_set = int(leverage) if leverage is not None else None
    min_feasible_lev = None

    if leverage is not None and str(margin_mode).lower() == "cross":
        notional = abs(float(size)) * px
        min_feasible_lev = int(math.ceil(notional / max(free, 1e-9))) if free > 0 else 10**9
        if strict and leverage < min_feasible_lev:
            return {
                "error": "INSUFFICIENT_MARGIN_FOR_REQUESTED_LEVERAGE",
                "coin": coin,
                "requestedLeverage": int(leverage),
                "minFeasibleLeverage": min_feasible_lev,
                "size": float(size),
                "price": px,
                "freeCrossMargin": free,
            }
        lev_to_set = max(int(leverage), min_feasible_lev)

    lev_result = None
    if lev_to_set is not None:
        lev_result = set_leverage(coin, lev_to_set, margin_mode)

    is_buy = side.lower() in ("buy", "long")
    res = exchange.market_open(coin, is_buy, float(size), None, float(slippage_frac))

    # Read back ground truth
    us_after = info.user_state(address)
    pos_after = next((p for p in us_after.get("assetPositions", [])
                      if p.get("position", {}).get("coin") == coin), None)
    szi_after = float(pos_after.get("position", {}).get("szi", 0.0)) if pos_after else 0.0
    lev_after = pos_after.get("position", {}).get("leverage") if pos_after else None

    return {
        "action": "open",
        "coin": coin,
        "side": "buy" if is_buy else "sell",
        "size": float(size),
        "price": px,
        "freeCrossMargin": free,
        "requestedLeverage": leverage,
        "minFeasibleLeverage": min_feasible_lev,
        "appliedLeverage": lev_to_set,
        "margin_mode": margin_mode,
        "slippage_frac": slippage_frac,
        "leverageAttempt": lev_result,
        "postFill": {"szi": szi_after, "leverage": lev_after},
        "result": res,
    }

# Close a position
def close_market(coin: str) -> Dict[str, Any]:
    """Reduce-only market close for the coin's current position."""
    _, _, exchange = _setup(skip_ws=True)
    res = exchange.market_close(coin)
    return {"action": "close", "coin": coin, "result": res}

# Cancel orders
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
      - For open: coin, side, size, slippage/slippage_frac, leverage, margin/margin_mode, strict
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
        elif k in ("leverage",):
            try:
                OPEN_PARAMS["leverage"] = int(v)
            except ValueError:
                OPEN_PARAMS["leverage"] = None
        elif k in ("margin_mode", "mode", "margin"):
            OPEN_PARAMS["margin_mode"] = v
        elif k in ("strict",):
            OPEN_PARAMS["strict"] = v.lower() in ("1", "true", "yes", "y", "on")


def _resolve_action_from_argv(default_action: str) -> str:
    """
    Allows: python create_orders.py <action> [key=value ...]
    """
    if len(sys.argv) >= 2:
        action = sys.argv[1].lower()
        if action in ("summary", "open", "close", "cancel"):
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
        print("\nAccount Summary")
        print(_pretty(summary))  # keep this as the last print for summary

    elif action == "open":
        coin = OPEN_PARAMS["coin"]
        side = OPEN_PARAMS["side"]
        size = float(OPEN_PARAMS["size"])
        slippage = float(OPEN_PARAMS.get("slippage_frac", 0.01))
        leverage = OPEN_PARAMS.get("leverage")
        margin_mode = OPEN_PARAMS.get("margin_mode", "cross")
        strict = bool(OPEN_PARAMS.get("strict", False))
        result = open_market(coin, side, size, slippage, leverage, margin_mode, strict)
        print("\nOpen Market Result")
        print(_pretty(result))

    elif action == "close":
        result = close_market(CLOSE_COIN)
        print("\nClose Market Result")
        print(_pretty(result))

    elif action == "cancel":
        result = cancel_resting_orders(CANCEL_COIN)
        print("\nCancel Orders Result")
        print(_pretty(result))

    else:
        print(f"Unknown ACTION: {action}. Valid: 'summary', 'open', 'close', 'cancel'.")


if __name__ == "__main__":
    main()
