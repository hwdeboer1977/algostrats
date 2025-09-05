// services/driftService.mjs
import {
  depositToVault,
  viewVault,
  requestWithdrawByAmount,
  finalizeWithdraw,
} from "./driftVaultCli.mjs";

/**
 * Allocate funds to the Drift vault (via deposit).
 * ctx.cfg must contain: solanaRpc, driftVaultAddress, driftVaultDepositor
 */
export async function allocateToDrift(ctx, amount) {
  const { cfg } = ctx;
  return depositToVault({
    url: cfg.solanaRpc,
    vaultAddress: cfg.driftVaultAddress,
    depositor: cfg.driftVaultDepositor,
    amount: amount.toString(),
  });
}

/**
 * STEP 1: Request a (partial) withdrawal by AMOUNT.
 * ctx.cfg must contain: solanaRpc, driftVaultAddress, driftVaultAuthority (wallet pubkey)
 */
export async function requestDriftWithdraw(ctx, amount) {
  const { cfg } = ctx;
  const res = await requestWithdrawByAmount({
    url: cfg.solanaRpc,
    vaultAddress: cfg.driftVaultAddress,
    authority: cfg.driftVaultAuthority, // wallet pubkey that owns the depositor
    amount: amount.toString(),
  });
  console.log(res.stdout);
  return res;
}

/**
 * STEP 2: Finalize withdrawal after cooldown (no amount).
 * ctx.cfg must contain: solanaRpc, driftVaultAddress, driftVaultDepositor, driftVaultAuthority
 */
export async function finalizeDriftWithdraw(ctx) {
  const { cfg } = ctx;
  const res = await finalizeWithdraw({
    url: cfg.solanaRpc,
    vaultAddress: cfg.driftVaultAddress,
    vaultDepositor: cfg.driftVaultDepositor,
    authority: cfg.driftVaultAuthority,
  });
  console.log(res.stdout);
  return res;
}

/**
 * Read-only monitor (just prints current vault info).
 */
export async function monitorAndMaybeAdjustDrift(ctx) {
  const { cfg } = ctx;
  const res = await viewVault({
    url: cfg.solanaRpc,
    vaultAddress: cfg.driftVaultAddress,
  });
  console.log("=== Drift Vault State ===");
  console.log(res.stdout);
  return res;
}
