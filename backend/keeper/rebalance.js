// backend/keeper/lib/rebalance.js
const { ethers } = require("ethers");

/**
 * Build the checkAndMaybeRebalance() function and return the tx receipt when executed.
 *
 * @param {Object} deps
 * @param {ethers.Provider} deps.provider
 * @param {ethers.Contract}  deps.vault           - read-only vault
 * @param {ethers.Contract}  deps.vaultWithSigner - signer-connected vault
 * @param {string}           deps.vaultAddress
 * @param {Array}            deps.erc20Abi
 * @param {string|null}      deps.wbtcEnvAddress
 * @returns {Function} async () => Promise<null | { transactionHash: string, blockNumber: number }>
 */
function buildCheckAndMaybeRebalance({
  provider,
  vault,
  vaultWithSigner,
  vaultAddress,
  erc20Abi,
  wbtcEnvAddress,
}) {
  if (!provider || !vault || !vaultWithSigner || !vaultAddress) {
    throw new Error("rebalance: missing required dependencies");
  }

  function hasFn(iface, sig) {
    try {
      iface.getFunction(sig);
      return true;
    } catch {
      return false;
    }
  }

  const KEEPER = ethers.id("KEEPER_ROLE");

  async function dumpVaultDiag() {
    console.log("=== Vault diag ===");
    try {
      console.log("asset():", await vault.asset());
    } catch {}
    try {
      console.log("owner():", await vault.owner());
    } catch {}

    if (hasFn(vault.interface, "hasRole(bytes32,address)")) {
      const me = await vaultWithSigner.runner.getAddress();
      try {
        console.log(
          `hasRole(KEEPER_ROLE, ${me}) =`,
          await vault.hasRole(KEEPER, me)
        );
      } catch {}
    }
    if (hasFn(vault.interface, "paused()")) {
      try {
        console.log("paused():", await vault.paused());
      } catch {}
    }
    for (const fn of [
      "getRecipients()",
      "getRecipientsAndWeights()",
      "targets()",
      "router()",
      "hlRouter()",
      "driftVault()",
      "splitBps()",
      "rebalanceMin()",
    ]) {
      if (hasFn(vault.interface, fn)) {
        try {
          console.log(`${fn} =>`, await vault[fn.slice(0, fn.indexOf("("))]());
        } catch {}
      }
    }
    console.log(
      "rebalance overloads:",
      hasFn(vault.interface, "rebalance()") ? "rebalance()" : "-",
      hasFn(vault.interface, "rebalance(uint256)") ? "rebalance(uint256)" : "-"
    );
    console.log("==================");
  }

  return async function checkAndMaybeRebalance() {
    console.log("Checking balances & threshold…");

    // 1) Resolve asset (ERC-4626)
    let assetAddr;
    try {
      assetAddr = await vault.asset();
    } catch {
      assetAddr = wbtcEnvAddress;
    }
    if (!assetAddr)
      throw new Error(
        "Cannot resolve underlying asset (vault.asset() or WBTC_ADDRESS)."
      );

    const asset = new ethers.Contract(assetAddr, erc20Abi, provider);

    // 2) Read state
    const [_, balance, minChunk] = await Promise.all([
      asset.decimals().catch(() => 8),
      asset.balanceOf(vaultAddress),
      vault.rebalanceMin().catch(() => 0n),
    ]);

    console.log(`   - Vault asset balance: ${balance}`);
    console.log(`   - rebalanceMin:       ${minChunk}`);

    if (minChunk > 0n && balance < minChunk) {
      console.log("Below rebalanceMin; skipping.");
      return null;
    }

    const amount = balance;

    // 4) Preflight
    try {
      if (vaultWithSigner.rebalance?.staticCall) {
        await dumpVaultDiag();
        await vaultWithSigner.rebalance.staticCall(amount);
      } else {
        await provider.call({
          to: vaultAddress,
          data: vault.interface.encodeFunctionData("rebalance", []),
        });
      }
    } catch (e) {
      console.log(
        "rebalance() preflight reverted; skipping.\n    Reason:",
        e.shortMessage || e.message
      );
      return null;
    }

    // 5) Submit tx
    console.log("Conditions met. Submitting rebalance()…");
    try {
      const tx = await vaultWithSigner.rebalance(amount);
      console.log("rebalance() sent:", tx.hash);
      const rcpt = await tx.wait();
      console.log(`rebalance() confirmed in block ${rcpt.blockNumber}`);
      return rcpt;
    } catch (e) {
      console.error("rebalance() tx failed:", e.shortMessage || e.message);
      return null;
    }
  };
}

module.exports = { buildCheckAndMaybeRebalance };
