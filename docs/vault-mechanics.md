# Vault Mechanics

This document explains how the vault works using a **shares-based system**.

---

## 1. Shares Concept

- When you deposit assets into the vault, you receive **shares**.
- Your number of shares stays constant unless you deposit or withdraw.
- The **price per share** represents the current value of the vault.

Your balance is always:

```
balance = shares_owned × share_price
```

---

## 2. How Share Price Changes

- **Yield/profit earned → share price increases**
- **Loss/negative yield → share price decreases**

The total number of shares stays constant (except when new deposits mint shares).  
So the share price acts as a **performance index** of the vault.

---

## 3. Example (WBTC Vault)

- User deposits **0.1 WBTC**
- Vault has **10 WBTC = 10,000 shares** → 1 share = 0.001 WBTC
- User receives:
  ```
  0.1 / 0.001 = 100 shares
  ```

After 1 month:

- Vault grows to **10.2 WBTC** (yield earned)
- Share price = `10.2 / 10,000 = 0.00102 WBTC/share`
- User’s balance = `100 × 0.00102 = 0.102 WBTC`

---

## 4. Example (USDC Vault)

- User deposits **1,000 USDC**
- Vault has **100,000 USDC = 100,000 shares** → 1 share = 1 USDC
- User receives: **1,000 shares**

After 1 month:

- Vault grows to **102,000 USDC**
- Share price = `102,000 / 100,000 = 1.02 USDC/share`
- User’s balance = `1,000 × 1.02 = 1,020 USDC`

---

## 5. APY Calculation

APY is derived from the change in share price over time:

```
APY = (current_share_price / old_share_price - 1) × (365 / days_elapsed)
```

With compounding:

```
APY = (1 + return_rate)^(365 / days_elapsed) - 1
```

Example:

- Share price grows 2% in 30 days (1.00 → 1.02)
- APY = `(1.02)^(12) - 1 = 26.82%`
