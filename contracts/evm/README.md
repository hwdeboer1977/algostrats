# Algostrats – EVM Contracts (Hardhat)

Minimal ERC‑4626 **WBTC Vault** with a mock token, deploy script, and tests. Targets **Arbitrum One** by default.

## Contents

```
contracts/evm
├─ contracts/
│  ├─ Vault.sol         # ERC‑4626 vault for WBTC (shares token, pausable/ownable)
│  └─ MockWBTC.sol      # 8‑decimals mock WBTC for local tests
├─ scripts/
│  └─ deploy.js         # deploys Vault with the real WBTC address
├─ test/
│  └─ Vault.test.js     # unit tests (local)
├─ hardhat.config.js
└─ README.md
```

> **Decimals:** WBTC uses **8 decimals**. Always use `parseUnits("<amount>", 8)` when building amounts.

---

## Prerequisites

- Node.js **22+**
- npm
- Hardhat **2.26.x** (installed via devDependencies)
- Ethers **v6**

---

## Install

From the repo root, then into the Hardhat folder:

```bash
cd Algostrats/contracts/evm
npm install
```

---

## Environment

This project loads the **root** `.env` (two folders up). Create `Algostrats/.env` with:

```ini
# RPC & keys
ARBITRUM_RPC_URL=https://arb-mainnet.g.alchemy.com/v2/XXXX
DEPLOYER_PK=0xYOUR_PRIVATE_KEY
ETHERSCAN_API_KEY=YOUR_ETHERSCAN_IO_KEY   # single Etherscan key (v2)

# Addresses
WBTC_ADDRESS=0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f   # Arbitrum One WBTC
```

> `hardhat.config.js` is set up to read `../../.env` via `dotenv` and `path.resolve`.

---

## Build & Test

```bash
# compile contracts
npx hardhat compile

# run unit tests (uses MockWBTC)
npx hardhat test
```

---

## Deploy (Arbitrum One)

The deploy script uses the WBTC address from `.env` (or the constant inside the script).

```bash
npx hardhat run --network arbmainnet scripts/deploy.js
```

The script writes a small artifact to `deployments/arbitrumOne.json` with the deployed vault address.

---

## Verify on Arbiscan

Use the **fully‑qualified name** and pass the WBTC address as the constructor argument.

```bash
npx hardhat verify   --network arbmainnet   --contract contracts/Vault.sol:Vault   <VAULT_ADDRESS>   0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f
```

> Make sure the compiler (0.8.24) and optimizer settings (enabled, runs=200) match your `hardhat.config.js`.

---

## Quick Interaction with NodeJS script (no frontend)

see `Algostrats/scripts/vault.js`

---

## Notes & Safety

- The vault is **Ownable**, **Pausable**, and **Reentrancy‑guarded**. For production, transfer ownership to a **multisig**.
- Ensure the testing wallet holds **WBTC on Arbitrum** and enough **ETH** on Arbitrum for gas.
- `MockWBTC.sol` is only for local testing; do not deploy it on mainnet.

---

## License

MIT. See SPDX identifiers in source files.
