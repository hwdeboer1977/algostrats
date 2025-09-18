import os, sys, time, json, requests
from decimal import Decimal, getcontext
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from web3 import Web3
from eth_account import Account

getcontext().prec = 40
load_dotenv(dotenv_path=Path(__file__).resolve().parents[2] / ".env")

EXCHANGE_URL = "https://api.hyperliquid.xyz/exchange"
INFO_URL     = "https://api.hyperliquid.xyz/info"

ARB_RPC  = os.getenv("ARB_RPC") or os.getenv("ARBITRUM_ALCHEMY_MAINNET")
CHAIN_ID = int(os.getenv("SIG_CHAIN_ID") or 42161)          # Arbitrum One (0xa4b1)
HL_NET   = (os.getenv("HL_NETWORK") or "Mainnet").strip()   # "Mainnet" | "Testnet"

USDC_ARB = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"
ERC20_ABI = json.loads("""
[
  {"inputs":[{"internalType":"address","name":"account","type":"address"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
  {"inputs":[],"name":"decimals","outputs":[{"internalType":"uint8","name":"","type":"uint8"}],"stateMutability":"view","type":"function"}
]
""")

def die(msg: str, code: int = 1):
    print(f"❌ {msg}")
    sys.exit(code)

def mask_key(pk: str) -> str:
    return pk[:6] + "…" + pk[-4:] if pk and len(pk) >= 10 else "****"

def post_info(payload: dict) -> dict:
    r = requests.post(INFO_URL, headers={"content-type": "application/json"}, json=payload, timeout=20)
    try:
        r.raise_for_status()
    except requests.HTTPError as e:
        die(f"HL info HTTP error: {e}\nBody: {r.text}")
    return r.json()

def get_withdrawable(addr_hex: str) -> Decimal:
    data = post_info({"type": "clearinghouseState", "user": addr_hex})
    return Decimal(data.get("withdrawable", "0"))

def wait_for_arb_usdc_credit(w3: Web3, to_addr: str, amount_human: str,
                             poll_ms: int = 6000, timeout_s: int = 900) -> None:
    usdc = w3.eth.contract(address=Web3.to_checksum_address(USDC_ARB), abi=ERC20_ABI)
    dec = usdc.functions.decimals().call()
    to_addr_cs = Web3.to_checksum_address(to_addr)

    start = Decimal(usdc.functions.balanceOf(to_addr_cs).call()) / (10 ** dec)
    target = Decimal(str(amount_human))
    expected_net = target - Decimal("1")   # HL ~ $1 fee
    if expected_net < 0:
        expected_net = Decimal(0)
    min_delta = expected_net * Decimal("0.98")

    t0 = time.time()
    print(f"Arbitrum USDC before: {start}")
    while time.time() - t0 < timeout_s:
        bal = Decimal(usdc.functions.balanceOf(to_addr_cs).call()) / (10 ** dec)
        d = bal - start
        print(f"Arbitrum USDC now: {bal} (Δ {d})")
        if d >= min_delta:
            print("🎉 Withdrawal credited on Arbitrum.")
            return
        time.sleep(poll_ms / 1000)
    die("Timed out waiting for Arbitrum USDC credit.", code=2)

# ---------- Build & sign EIP-712 exactly as HL expects ----------
def build_typed_withdraw(hyperliquid_chain: str, destination: str, amount_str: str, now_ms: int, signature_chain_id: int) -> dict:
    """
    Domain & type per HL (Rust types.rs):
      domain: { name: "HyperliquidSignTransaction", version: "1", chainId: signature_chain_id, verifyingContract: 0x0 }
      primaryType: "HyperliquidTransaction:Withdraw"
      fields: hyperliquidChain, destination, amount, time
    """
    destination = destination.lower()
    return {
        "types": {
            "EIP712Domain": [
                {"name": "name", "type": "string"},
                {"name": "version", "type": "string"},
                {"name": "chainId", "type": "uint256"},
                {"name": "verifyingContract", "type": "address"},
            ],
            # NOTE the colon in the type name:
            "HyperliquidTransaction:Withdraw": [
                {"name": "hyperliquidChain", "type": "string"},
                {"name": "destination",      "type": "string"},
                {"name": "amount",           "type": "string"},
                {"name": "time",             "type": "uint64"}
            ]
        },
        "primaryType": "HyperliquidTransaction:Withdraw",
        "domain": {
            "name": "HyperliquidSignTransaction",
            "version": "1",
            "chainId": signature_chain_id,
            "verifyingContract": "0x" + "00"*20,
        },
        "message": {
            "hyperliquidChain": hyperliquid_chain,
            "destination": destination,
            "amount": str(amount_str),
            "time": int(now_ms)
        }
    }

def sign_typed(privkey_hex: str, typed: dict):
    acct = Account.from_key(privkey_hex)
    # Preferred: native helper
    try:
        types_no_domain = {k: v for k, v in typed["types"].items() if k != "EIP712Domain"}
        sig = acct._sign_typed_data(typed["domain"], types_no_domain, typed["message"])  # type: ignore[attr-defined]
        return sig.r, sig.s, int(sig.v)
    except Exception:
        pass
    # Fallback: encode_typed_data + sign_message
    from eth_account.messages import encode_typed_data
    try:
        try:
            msg = encode_typed_data(full_message=typed)
        except TypeError:
            msg = encode_typed_data(typed)
        signed = Account.sign_message(msg, private_key=privkey_hex)
        return signed.r, signed.s, int(signed.v)
    except Exception as e:
        die(f"Failed to sign typed data: {e}")

def recover_signer(typed: dict, r_int: int, s_int: int, v_int: int) -> str:
    from eth_account.messages import encode_typed_data
    try:
        msg = encode_typed_data(full_message=typed)
    except TypeError:
        msg = encode_typed_data(typed)
    sig_bytes = (r_int.to_bytes(32, "big") + s_int.to_bytes(32, "big") + bytes([v_int]))
    return Account.recover_message(msg, signature=sig_bytes).lower()

def to_hex32(x: int) -> str:
    return "0x" + x.to_bytes(32, "big").hex()

def initiate_hl_withdraw(pk_hex: str, signer_addr: str, dest_addr: str, amount_usdc: str,
                         signature_chain_id: int, hyperliquid_chain: str):
    # Check withdrawable for the signer (HL recovers signer from the signature)
    w = get_withdrawable(signer_addr)
    print(f"  HL withdrawable (USDC) for signer {signer_addr}: {w}")
    amt = Decimal(amount_usdc)
    if amt < Decimal("5"):
        die("Amount must be >= 5 USDC (HL min).")
    if w < amt * Decimal("0.98"):
        die("Insufficient withdrawable on HL for this amount (allowing ~2% tolerance).")

    now_ms = int(time.time() * 1000)
    typed = build_typed_withdraw(hyperliquid_chain, dest_addr, amount_usdc, now_ms, signature_chain_id)

    print("→ EIP-712 typed message to sign:")
    print(json.dumps(typed, indent=2))

    r_int, s_int, v_int = sign_typed(pk_hex, typed)
    recovered = recover_signer(typed, r_int, s_int, v_int)
    print(f"  Local recovered signer: {recovered}")
    if recovered != signer_addr:
        die(f"Recovered signer {recovered} != provided signer {signer_addr}. "
            "This means the domain/type/message don’t match HL’s schema.")

    payload = {
        "action": {
            "type": "withdraw3",
            "hyperliquidChain": hyperliquid_chain,         # "Mainnet" | "Testnet"
            "signatureChainId": hex(signature_chain_id),   # "0xa4b1" for 42161
            "amount": str(amount_usdc),
            "time": now_ms,                                # MUST equal nonce
            "destination": dest_addr.lower()
        },
        "nonce": now_ms,
        "signature": {"r": to_hex32(r_int), "s": to_hex32(s_int), "v": v_int}
    }

    print("→ POST /exchange withdraw3 payload:")
    printable = {**payload, "signature": {**payload["signature"], "r": payload["signature"]["r"][:10]+"…", "s": payload["signature"]["s"][:10]+"…"}}
    print(json.dumps(printable, indent=2))

    r = requests.post(EXCHANGE_URL, headers={"content-type": "application/json"}, json=payload, timeout=30)
    try:
        r.raise_for_status()
    except requests.HTTPError as e:
        die(f"HL exchange HTTP error: {e}\nBody: {r.text}")
    print("✅ Exchange responded:", r.json())

def load_config(path: Optional[str]) -> dict:
    if not path:
        candidate = Path(__file__).resolve().parents[2] / "config.json"
        return json.loads(candidate.read_text()) if candidate.exists() else {}
    p = Path(path)
    if not p.exists():
        die(f"Config file not found: {p}")
    return json.loads(p.read_text())

def main():
    # Usage: python withdraw_hl.py <amountUSDC> [--pk 0x...] [--dest 0x...] [--config path.json] [--no-wait] [--testnet]
    if len(sys.argv) < 2:
        die("Usage: python withdraw_hl.py <amountUSDC> [--pk 0x...] [--dest 0x...] [--config path.json] [--no-wait] [--testnet]")

    amount_human = sys.argv[1]
    pk_cli = None
    dest_cli = None
    cfg_path = None
    no_wait = "--no-wait" in sys.argv
    is_testnet = "--testnet" in sys.argv

    if "--pk" in sys.argv:
        try: pk_cli = sys.argv[sys.argv.index("--pk") + 1]
        except Exception: die("Provide a value after --pk")
    if "--dest" in sys.argv:
        try: dest_cli = sys.argv[sys.argv.index("--dest") + 1]
        except Exception: die("Provide a value after --dest")
    if "--config" in sys.argv:
        try: cfg_path = sys.argv[sys.argv.index("--config") + 1]
        except Exception: die("Provide a value after --config")

    cfg = load_config(cfg_path)
    cfg_pk   = cfg.get("secret_key")
    cfg_addr = (cfg.get("account_address") or "").lower()

    # Choose PK: CLI > env > config
    PK = pk_cli or os.getenv("PK") or os.getenv("PK_RECIPIENT_B") or cfg_pk
    if not PK or not PK.startswith("0x") or len(PK) != 66:
        die("Private key missing or malformed. Provide --pk 0x<64-hex> or set PK/PK_RECIPIENT_B or config.secret_key.")

    signer_addr = Account.from_key(PK).address.lower()
    expected = (os.getenv("USER") or cfg_addr or signer_addr).lower()

    print("▶ Hyperliquid USDC withdraw starting…")
    print(f"  Amount: {amount_human} USDC")
    print(f"  PK: {mask_key(PK)}")
    print(f"  Signer (derived from PK): {signer_addr}")
    if cfg_addr:
        print(f"  Config account_address:   {cfg_addr}")
    if os.getenv("USER"):
        print(f"  USER (env):               {(os.getenv('USER') or '').lower()}")

    # Withdrawals MUST be signed by the funded HL account
    if expected != signer_addr:
        die(f"Signer {signer_addr} does not match expected HL user {expected}. "
            "Use the funded account’s private key (or fix config/env).")

    dest_addr = (dest_cli or signer_addr).lower()
    signature_chain_id = CHAIN_ID if not is_testnet else int(os.getenv("SIG_CHAIN_ID_TESTNET") or CHAIN_ID)
    net_label = "Testnet" if is_testnet else HL_NET

    print(f"  Destination (Arbitrum EOA): {dest_addr}")
    print(f"  Network: {net_label}")

    # Kick off HL withdrawal
    initiate_hl_withdraw(PK, signer_addr, dest_addr, amount_human, signature_chain_id, net_label)

    # Optional on-chain credit wait
    if no_wait:
        print("✅ Withdrawal requested. Skipping on-chain credit wait (--no-wait).")
        return
    if not ARB_RPC:
        print("⚠ ARB_RPC not set; cannot wait for on-chain credit. Exiting after HL request.")
        return

    w3 = Web3(Web3.HTTPProvider(ARB_RPC, request_kwargs={"timeout": 30}))
    print("⏳ Waiting for Arbitrum USDC credit…")
    wait_for_arb_usdc_credit(w3, dest_addr, amount_human, poll_ms=6000, timeout_s=900)
    print("🎉 Done.")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        die(str(e))
