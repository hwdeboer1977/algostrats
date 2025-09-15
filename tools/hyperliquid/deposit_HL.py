# tools/hyperliquid/deposit_hl.py
import os, sys, time, json, requests
from decimal import Decimal, getcontext
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from web3 import Web3
from eth_account import Account

# Script that deposits USDC in HL perps account
# Also checks for credit of the USDC

# ---------- init ----------
# Increase precision for Decimal math
getcontext().prec = 40

# Load .env (adjust path to your repo root if needed)
load_dotenv(dotenv_path=Path(__file__).resolve().parents[2] / ".env")

ARB_RPC = os.getenv("ARB_RPC") or os.getenv("ARBITRUM_ALCHEMY_MAINNET")
CHAIN_ID = 42161  # Arbitrum One
USDC_ARB = Web3.to_checksum_address("0xaf88d065e77c8cC2239327C5EDb3A432268e5831")
HL_BRIDGE2 = Web3.to_checksum_address("0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7")

ERC20_ABI = json.loads("""
[
  {"inputs":[{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"transfer","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},
  {"inputs":[],"name":"decimals","outputs":[{"internalType":"uint8","name":"","type":"uint8"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"internalType":"address","name":"account","type":"address"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"}
]
""")

INFO_URL = "https://api.hyperliquid.xyz/info"

# ---------- utils ----------
def die(msg: str, code: int = 1):
    print(f"❌ {msg}")
    sys.exit(code)

def sleep(ms: int):
    time.sleep(ms / 1000)

def to_wei_dec(amount_str: str, decimals: int) -> int:
    q = Decimal(amount_str)
    if q <= 0:
        raise ValueError("amount must be > 0")
    return int(q * (10 ** decimals))

def mask_key(pk: str) -> str:
    if not pk or len(pk) < 6:
        return "****"
    return pk[:6] + "…" + pk[-4:]

def post_info(payload: dict) -> dict:
    r = requests.post(INFO_URL, headers={"content-type": "application/json"}, json=payload, timeout=15)
    r.raise_for_status()
    return r.json()

def get_spot_usdc(addr_hex: str) -> Decimal:
    data = post_info({"type": "spotClearinghouseState", "user": addr_hex})
    for b in data.get("balances", []):
        if b.get("coin") == "USDC":
            return Decimal(b.get("total", "0"))
    return Decimal(0)

def get_perp_withdrawable(addr_hex: str) -> Decimal:
    data = post_info({"type": "clearinghouseState", "user": addr_hex})
    w = data.get("withdrawable", "0")
    return Decimal(w)

def sum_ledger_deposits_since(addr_hex: str, start_ms: int) -> Decimal:
    """
    Sums USDC deltas from the non-funding ledger since start_ms.
    Useful if balances lag.
    """
    data = post_info({
        "type": "userNonFundingLedgerUpdates",
        "user": addr_hex,
        "startTime": int(start_ms)
    })
    tot = Decimal(0)
    for row in data or []:
        delta = row.get("delta") or {}
        usdc = delta.get("usdc")
        if usdc:
            try:
                tot += Decimal(usdc)
            except Exception:
                pass
    return tot

def wait_for_hl_credit(addr_hex: str, amount_human: str,
                       poll_ms: int = 6000, timeout_s: int = 600,
                       start_time_ms: Optional[int] = None) -> None:
    """
    Waits until either Spot USDC or Perps withdrawable increases ~ by amount_human.
    Falls back to ledger check on timeout.
    """
    expected = Decimal(amount_human)
    min_delta = expected * Decimal("0.98")  # allow ~2% variance for fees/FX
    spot0 = get_spot_usdc(addr_hex)
    perp0 = get_perp_withdrawable(addr_hex)
    t0 = time.time()
    print(f"HL spot USDC before: {spot0}, perps withdrawable before: {perp0}")

    while time.time() - t0 < timeout_s:
        spot = get_spot_usdc(addr_hex)
        perp = get_perp_withdrawable(addr_hex)
        d_spot = spot - spot0
        d_perp = perp - perp0
        print(f"HL spot: {spot} (Δ {d_spot}), perps withdrawable: {perp} (Δ {d_perp})")
        if d_spot >= min_delta or d_perp >= min_delta:
            print("🎉 Deposit credited on Hyperliquid.")
            return
        sleep(poll_ms)

    # final fallback: ledger delta
    if start_time_ms is not None:
        credited = sum_ledger_deposits_since(addr_hex, start_time_ms)
        print(f"Ledger USDC delta since start: {credited}")
        if credited >= min_delta:
            print("✅ Deposit present in ledger; balances likely lagging.")
            return
    raise TimeoutError("Timed out waiting for Hyperliquid credit.")

# ---------- main ----------
def main():
    # CLI: deposit_hl.py <amountUSDC> [--pk 0x...] [--no-wait]
    if len(sys.argv) < 2:
        die("Usage: python deposit_hl.py <amountUSDC> [--pk 0xPRIVATE_KEY] [--no-wait]")

    amount_human = sys.argv[1]
    pk_cli = None
    no_wait = False
    if "--pk" in sys.argv:
        try:
            pk_cli = sys.argv[sys.argv.index("--pk") + 1]
        except Exception:
            die("Provide a value after --pk")
    if "--no-wait" in sys.argv:
        no_wait = True

    if not ARB_RPC:
        die("ARB_RPC (or ARBITRUM_ALCHEMY_MAINNET) is not set in env")

    # private key: CLI > env PK
    PK = pk_cli or os.getenv("PK_RECIPIENT_B")
    if not PK:
        die("Private key missing. Pass --pk 0x... or set PK in env")
    if not PK.startswith("0x") or len(PK) < 66:
        die("Private key format looks wrong (expect 0x + 64 hex)")

    if Decimal(amount_human) < Decimal("5"):
        die("Amount must be >= 5 USDC (HL min).")

    print("▶ Hyperliquid USDC deposit starting…")
    print(f"  RPC: {ARB_RPC[:48]}…")
    print(f"  Amount: {amount_human} USDC")
    print(f"  PK: {mask_key(PK)}")
    print(f"  Wait for credit: {'no' if no_wait else 'yes'}")

    # web3 setup
    w3 = Web3(Web3.HTTPProvider(ARB_RPC, request_kwargs={"timeout": 30}))
    net = w3.eth.chain_id
    if net != CHAIN_ID:
        print(f"  ⚠ Connected chainId={net}, expected {CHAIN_ID} (Arbitrum One).")

    acct = Account.from_key(PK)
    from_addr = acct.address
    user_addr = os.getenv("USER") or from_addr
    print(f"  From: {from_addr}")
    print(f"  HL User: {user_addr}")

    # gas & balances
    eth_bal = w3.eth.get_balance(from_addr)
    print(f"  ETH (gas) balance: {Web3.from_wei(eth_bal, 'ether')} ETH")
    if eth_bal == 0:
        die("No ETH for gas on Arbitrum")

    usdc = w3.eth.contract(address=USDC_ARB, abi=ERC20_ABI)
    dec = usdc.functions.decimals().call()
    amount_raw = to_wei_dec(amount_human, dec)
    usdc_bal = usdc.functions.balanceOf(from_addr).call()
    print(f"  USDC balance: {Decimal(usdc_bal) / (10 ** dec)}")
    if usdc_bal < amount_raw:
        die("Insufficient USDC balance")

    # build & send tx
    nonce = w3.eth.get_transaction_count(from_addr)
    gas_price = w3.eth.gas_price  # Arbitrum uses gasPrice (not EIP-1559)
    gas_est = usdc.functions.transfer(HL_BRIDGE2, amount_raw).estimate_gas({"from": from_addr})
    gas = int(gas_est * 1.2)  # pad 20%

    tx = usdc.functions.transfer(HL_BRIDGE2, amount_raw).build_transaction({
        "from": from_addr,
        "nonce": nonce,
        "chainId": CHAIN_ID,
        "gas": gas,
        "gasPrice": gas_price,
    })

    signed = acct.sign_transaction(tx)
    raw = getattr(signed, "raw_transaction", None) or getattr(signed, "rawTransaction", None)
    txh = w3.eth.send_raw_transaction(raw)
    print("  🔗 sent:", txh.hex())

    rcpt = w3.eth.wait_for_transaction_receipt(txh, timeout=180)
    print(f"  ✅ confirmed in block {rcpt.blockNumber}, status={rcpt.status}")
    if rcpt.status != 1:
        die("Deposit tx reverted")

    if no_wait:
        print("✅ Deposit sent. Skipping HL credit wait (--no-wait).")
        return

    # record start time BEFORE/AROUND sending for ledger fallback
    start_ms = int(time.time() * 1000) - 5000

    print("⏳ Waiting for Hyperliquid credit (Spot or Perps)…")
    wait_for_hl_credit(user_addr, amount_human, poll_ms=6000, timeout_s=600, start_time_ms=start_ms)
    print("🎉 Done.")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        die(str(e))
