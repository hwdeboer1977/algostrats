# 🟣 yBTC Hook – Yield-Aware Trading for ERC-4626 Vaults

### Overview

**yBTC Hook** enables yield-bearing BTC tokens (like yBTC) to trade at their **true Net Asset Value (NAV)** on **Uniswap v4**, keeping prices aligned with vault exchange rates through a combination of **dynamic hook fees** and **mint/redeem arbitrage**.

Built for the **Crecimiento × Uniswap Foundation DeFi Track**, this project demonstrates how Uniswap v4 Hooks can make yield assets natively composable and liquid.

---

## ⚙️ Architecture

```
[ Users / Traders ]      [ LPs ]          [ Vault (ERC-4626) ]
        │                    │                     │
        ▼                    │                     │
  ┌────────────────────────────────────────────────────────────┐
  │                Uniswap v4 Pool (yBTC / USDC)               │
  │                                                            │
  │     ┌──────────────────────────────────────────────┐       │
  │     │            NAV-Aware Hook (yBtcHook)         │       │
  │     │----------------------------------------------│       │
  │     │ beforeInitialize  → locks token pair          │
  │     │ beforeSwap        → adjusts fee based on NAV  │
  │     │ afterSwap         → emits PriceDeviation      │
  │     │ beforeAddLiquidity → optional tick limits     │
  │     └──────────────────────────────────────────────┘       │
  └────────────────────────────────────────────────────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
 [ Traders ]         [ Relayer / Arbitrageur ]   [ Vault NAV Oracle ]
                              │
                              ▼
              Mints / Redeems yBTC to restore NAV
```

---

## 🧩 Components

### 1. ERC-4626 Vault (`YBtcVault`)

- **Deposits:** WBTC → mints yBTC (shares).
- **Exchange Rate:** `r = totalAssets / totalSupply`.
- **Redeems:** yBTC → returns `r × shares` worth of WBTC.
- Accrues yield (staking, restaking, lending) so `r` slowly increases over time.

### 2. yBTC Token

- ERC-20 representing vault shares.
- Transferable and composable.
- Value per token rises with vault yield.

### 3. NAV Oracle

- Reports `r` (WBTC per yBTC) and uses Chainlink BTC/USD to compute:
  ```
  P_nav = r × BTCUSD
  ```
  Example:
  ```
  r = 1.03
  BTCUSD = 60,000
  → P_nav = 61,800 USDC per yBTC
  ```

### 4. Uniswap v4 Pool (yBTC / USDC)

- Regular pool, but attached to `YBtcHook`.
- LPs earn trading fees.
- Price auto-corrects to NAV via the hook + relayer mechanism.

### 5. yBtcHook

Implements key logic:

| Hook Function        | Purpose                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `beforeInitialize`   | Locks pool tokens (yBTC, USDC).                                                                                           |
| `beforeSwap`         | Reads `P_nav`, compares to pool price, sets **dynamic fee** to reward trades toward NAV and penalize those away from NAV. |
| `afterSwap`          | Emits `PriceDeviation` if deviation exceeds threshold.                                                                    |
| `beforeAddLiquidity` | Optionally restricts ticks or ensures balanced ranges.                                                                    |

---

## 🔁 Price Stabilization Mechanism

### 1. Soft-Peg: Dynamic Fees

The Hook computes deviation per swap:

```
dev = (P_pool / P_nav) - 1
```

- If swap **reduces** |dev| → apply **rebate** (lower fee).
- If swap **increases** |dev| → apply **surcharge** (higher fee).
- If oracle stale or |dev| > max → set fee = 100% (pause).

This makes “trading toward NAV” cheaper → traders naturally close the gap.

### 2. Hard-Peg: Relayer Arbitrage

Hook emits:

```solidity
event PriceDeviation(int256 devBps, uint256 P_pool, uint256 P_nav);
```

A relayer listens and performs:

- **Premium (P_pool > P_nav):**  
  Mint yBTC in vault → sell to pool → price ↓ to NAV.
- **Discount (P_pool < P_nav):**  
  Buy yBTC in pool → redeem in vault → price ↑ to NAV.

---

## 🧮 Numerical Example

| Parameter     | Value                      |
| ------------- | -------------------------- |
| BTC/USD       | 60,000                     |
| Vault assets  | 103 WBTC                   |
| yBTC supply   | 100 yBTC                   |
| Exchange rate | `r = 1.03`                 |
| NAV           | `P_nav = 61,800 USDC/yBTC` |

### Case 1 — Premium (pool at 63,000)

- Deviation = **+1.94%**
- Relayer mints `7.73 yBTC` in vault (cost 7.96 WBTC = 477,690 USDC).
- Sells in pool for 482,163 USDC (after 3 bps fee rebate).
- **Profit:** ≈ 4.5 k USDC.
- Pool price falls to 61,800 → back to NAV.

### Case 2 — Discount (pool at 60,000)

- Deviation = **−2.91%**
- Relayer buys `12.03 yBTC` for 732,764 USDC.
- Redeems in vault → receives 12.39 WBTC = 743,454 USDC.
- **Profit:** ≈ 10.7 k USDC.
- Pool price rises to 61,800 → back to NAV.

---

## 🧠 No-Dilution Proof

Let:

- `A` = vault assets,
- `S` = shares,
- `r = A/S`.

Mint ΔS = ΔA / r shares for new deposit ΔA.

After mint:

```
A' = A + ΔA
S' = S + ΔS = S + ΔA / r
r' = A'/S' = (A + ΔA) / (S + ΔA / r) = r
```

👉 **r' = r**, so every holder’s proportional value remains unchanged.  
The arb’s profit comes from **pool mispricing**, not vault dilution.

---

## ⚡ Wave 1 – Bootstrapping Liquidity (0 → $250 k TVL)

You don’t “give away” yBTC — you **pay for early liquidity** with a structured, temporary rewards plan.

### 1️⃣ Liquidity Mining

- Allocate a small emissions pool, e.g. **5 000 yBTC (≈5 % supply)** for a 6‑week bootstrap phase.
- Distribute to LPs pro‑rata to their pool share:
  ```
  reward/day = (user_TVL / total_TVL) × yBTC_pool / duration_days
  ```
- Stream via a Merkle or Sablier contract for transparency.

### 2️⃣ Vault Yield Sharing

- Route part of vault yield (≈20 %) to LPs for real yield + trading fees.

### 3️⃣ Grant / Co‑Incentives

- Apply for Crecimiento × Uniswap micro‑grants to fund early liquidity rebates in **USDC**.

| Week | Incentive Type    | Description                  | Budget |
| ---- | ----------------- | ---------------------------- | ------ |
| 1–2  | Launch & Airdrop  | Early LP snapshot – 500 yBTC | 10 %   |
| 3–4  | Streaming Rewards | Continuous 3 500 yBTC drip   | 70 %   |
| 5–6  | Fee Boost         | Double swap fee rebate       | 20 %   |

> 🎯 **Goal:** attract first $250 k TVL, prove peg stability, sunset emissions.

---

## 🛡️ Safeguards

- Clamp NAV change ≤ 10 bps/block.
- Revert if oracle stale > N blocks.
- Cap deviation in fee curve (±300 bps).
- Pause hook on feed failure.
- Keep mint/redeem fees symmetric (or zero).

---

## 💼 Investment Case

### Why VCs Care

- **New DeFi primitive:** a generic “NAV‑aware pricing layer” for all ERC‑4626 vaults.
- **Huge addressable market:** $20 B+ yield tokens need liquidity.
- **Revenue model:** hook fees + vault mgmt + relayer share.
- **Alignment:** showcases Uniswap v4 infra, supports real yield.
- **Scalability:** extend to LRTs, stETH, rsETH, sDAI, cross‑chain Unichain.

Example revenue model:

```
$10 M TVL × 2 % vol/day × 10 bps × 365 ≈ $730 k annual protocol revenue
```

---

**Author:** Henk Wim de Boer  
**Project:** Algostrats – Yield‑Aware Uniswap v4 Hooks  
**Track:** Crecimiento × Uniswap Foundation DeFi Track 2025
