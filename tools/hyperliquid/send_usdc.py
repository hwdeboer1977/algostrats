#!/usr/bin/env python3
import os, sys
from decimal import Decimal, getcontext
from dotenv import load_dotenv
from web3 import Web3

getcontext().prec = 50
load_dotenv()

TOKENS = {
    "USDC": "0xAf88d065e77c8cC2239327C5EDb3A432268e5831",  # native USDC (6 decimals)
}

ERC20_ABI = [
    {"constant": True, "inputs": [], "name": "decimals", "outputs": [{"name": "", "type": "uint8"}], "type": "function"},
    {"constant": True, "inputs": [], "name": "symbol",   "outputs": [{"name": "", "type": "string"}], "type": "function"},
    {"constant": True, "inputs": [{"name": "_owner", "type": "address"}], "name": "balanceOf",
     "outputs": [{"name": "balance", "type": "uint256"}], "type": "function"},
    {"constant": False, "inputs": [{"name": "_to", "type": "address"}, {"name": "_value", "type": "uint256"}],
     "name": "transfer", "outputs": [{"name": "", "type": "bool"}], "type": "function"},
]

def resolve_amount(default="1"):
    """Priority: --amount= / --amount <v> → first positional number → AMOUNT env → default."""
    # --amount=2
    for a in sys.argv[1:]:
        if a.startswith("--amount="):
            return a.split("=", 1)[1]
    # --amount 2
    if "--amount" in sys.argv:
        i = sys.argv.index("--amount")
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    # first positional that isn't a flag
    for a in sys.argv[1:]:
        if not a.startswith("-"):
            return a
    # env
    if os.getenv("AMOUNT"):
        return os.getenv("AMOUNT")
    return default

def main():
    rpc_url = os.getenv("ARBITRUM_ALCHEMY_MAINNET")
    pk      = os.getenv("PK_RECIPIENT_B") or os.getenv("PRIVATE_KEY")
    to      = os.getenv("WALLET_ADDRESS")
    token_key = "USDC"

    amount_human = resolve_amount("1")
    if not rpc_url or not pk or not to:
        raise RuntimeError("Missing env: ARBITRUM_ALCHEMY_MAINNET, PK/PK_RECIPIENT_B, WALLET_ADDRESS")

    token_address = TOKENS[token_key]
    w3 = Web3(Web3.HTTPProvider(rpc_url))
    acct = w3.eth.account.from_key(pk)

    # Chain check
    chain_id = w3.eth.chain_id
    if chain_id != 42161:
        raise RuntimeError(f"Connected to chain {chain_id}, need Arbitrum One (42161)")

    token = w3.eth.contract(address=Web3.to_checksum_address(token_address), abi=ERC20_ABI)

    dec = token.functions.decimals().call()
    sym = token.functions.symbol().call()
    # precise conversion
    amount = int((Decimal(amount_human) * (Decimal(10) ** dec)).to_integral_value())

    bal = token.functions.balanceOf(acct.address).call()
    if bal < amount:
        have = Decimal(bal) / (Decimal(10) ** dec)
        raise RuntimeError(f"Insufficient {sym} balance. Have {have}, need {amount_human}")

    print(f"[send_usdc.py] amount_human={amount_human}")
    print(f"Sending {amount_human} {sym} from {acct.address} -> {to} on Arbitrum…")

    # Build tx (EIP-1559 friendly for Arbitrum)
    tx = token.functions.transfer(Web3.to_checksum_address(to), amount).build_transaction({
        "from": acct.address,
        "nonce": w3.eth.get_transaction_count(acct.address, "pending"),
        "chainId": chain_id,
    })

    # Prefer EIP-1559 fields (avoids: maxFeePerGas < baseFee)
    try:
        latest = w3.eth.get_block("latest")
        base_fee = latest.get("baseFeePerGas")
        if base_fee is not None:
            tx["maxFeePerGas"] = int(base_fee * 12 // 10)      # ~1.2x base
            tx["maxPriorityFeePerGas"] = 0                      # Arbitrum tip ~0
        else:
            tx["gasPrice"] = w3.eth.gas_price
    except Exception:
        tx["gasPrice"] = w3.eth.gas_price

    # Estimate gas
    tx["gas"] = w3.eth.estimate_gas(tx)

    # Sign + send (web3.py v7 uses snake_case)
    signed = acct.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    print("Tx sent:", tx_hash.hex())

    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    print(f"✅ Confirmed in block {receipt.blockNumber}")

if __name__ == "__main__":
    main()
