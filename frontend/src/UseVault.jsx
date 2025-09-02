// src/useVault.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import config from "./config.json";
import { useWallet } from "./WalletProvider";
import vaultAbi from "./abis/vault.json"; // your real vault ABI

// Minimal ERC20 ABI for the asset (WBTC)
const erc20Abi = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

const EXPECTED_CHAIN_ID = Number(config.chainId || 42161); // Arbitrum by default

export function useVault({
  vaultAddress = config.vaultAddress,
  assetAddress = config.wbtcAddress,
} = {}) {
  const { provider, signer, address, chainId, version } = useWallet();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const onWrongNetwork =
    chainId && EXPECTED_CHAIN_ID && Number(chainId) !== EXPECTED_CHAIN_ID;

  // Token (asset) + share (vault token) metadata
  const [assetMeta, setAssetMeta] = useState({
    symbol: "WBTC",
    decimals: config.wbtcDecimals ?? 8,
  });
  const [shareMeta, setShareMeta] = useState({
    symbol: config.shareSymbol ?? "yBTC",
    decimals: 18,
  });

  // Balances
  const [balances, setBalances] = useState({
    userAsset: null, // user's WBTC
    userShares: null, // user's yBTC
    vaultTotalAssets: null, // totalAssets()
  });

  // Share price state
  const [price, setPrice] = useState({
    assetsPerShareRaw: null, // BigInt (asset-wei per 1 share)
    sharesPerAssetRaw: null, // BigInt (share-wei per 1 asset)
    assetsPerShare: null, // string (asset units)
    sharesPerAsset: null, // string (share units)
  });

  // Contract instances (null on wrong network)
  const vault = useMemo(() => {
    if (!provider || !vaultAddress || onWrongNetwork) return null;
    return new ethers.Contract(vaultAddress, vaultAbi, signer ?? provider);
  }, [provider, signer, vaultAddress, version, onWrongNetwork]);

  const asset = useMemo(() => {
    if (!provider || !assetAddress || onWrongNetwork) return null;
    return new ethers.Contract(assetAddress, erc20Abi, signer ?? provider);
  }, [provider, signer, assetAddress, version, onWrongNetwork]);

  // Load metadata (symbols/decimals)
  useEffect(() => {
    let stop = false;
    (async () => {
      if (!asset || !vault) return;
      try {
        const [aSym, aDec, sSym, sDec] = await Promise.all([
          asset.symbol().catch(() => "WBTC"),
          asset.decimals().catch(() => config.wbtcDecimals ?? 8),
          vault.symbol().catch(() => config.shareSymbol ?? "yBTC"),
          vault.decimals().catch(() => 18),
        ]);
        if (!stop) {
          setAssetMeta({ symbol: aSym, decimals: Number(aDec) });
          setShareMeta({ symbol: sSym, decimals: Number(sDec) });
        }
      } catch (e) {
        if (!stop) setError(e?.message ?? "Failed to load metadata");
      }
    })();
    return () => {
      stop = true;
    };
  }, [asset, vault]);

  // Refresh balances and total assets
  async function refresh() {
    if (!provider || !vault || !asset || !address) return;
    try {
      const [userAsset, userShares, totalAssets] = await Promise.all([
        asset.balanceOf(address),
        vault.balanceOf(address),
        vault.totalAssets(),
      ]);
      setBalances({ userAsset, userShares, vaultTotalAssets: totalAssets });
    } catch (e) {
      setError(e?.message ?? "Failed to load balances");
    }
  }

  // ---- Share price refresh with race-protection & safe fallback ----
  const priceReqId = useRef(0);

  async function refreshPrices() {
    if (!vault) return;
    if (assetMeta.decimals == null || shareMeta.decimals == null) return;

    const rid = ++priceReqId.current;

    // Preferred path: ERC-4626 conversions
    try {
      const oneShare = ethers.parseUnits("1", shareMeta.decimals);
      const oneAsset = ethers.parseUnits("1", assetMeta.decimals);

      const [apsRaw, spaRaw] = await Promise.all([
        vault.convertToAssets(oneShare), // returns asset-wei
        vault.convertToShares(oneAsset), // returns share-wei
      ]);

      if (rid !== priceReqId.current) return; // stale result

      setPrice({
        assetsPerShareRaw: apsRaw,
        sharesPerAssetRaw: spaRaw,
        assetsPerShare: ethers.formatUnits(apsRaw, assetMeta.decimals), // format with ASSET decimals
        sharesPerAsset: ethers.formatUnits(spaRaw, shareMeta.decimals), // format with SHARE decimals
      });
      return;
    } catch {
      // fall through to guarded fallback
    }

    // Guarded fallback: compute from totalAssets/totalSupply; ignore insane outputs
    try {
      const [totalAssets, totalSupply] = await Promise.all([
        vault.totalAssets(),
        vault.totalSupply?.() ?? 0n,
      ]);

      if (rid !== priceReqId.current) return; // stale result

      if (totalSupply && totalSupply > 0n) {
        // assets per 1 share (raw, asset-wei)
        const apsRaw =
          (totalAssets * 10n ** BigInt(shareMeta.decimals)) / totalSupply;

        // sanity cap: ignore if absurdly large (likely transient RPC mismatch)
        const maxSane = 10n ** BigInt(assetMeta.decimals + 6); // 1e6 assets/share
        if (apsRaw > maxSane) return; // keep previous price

        setPrice((prev) => ({
          assetsPerShareRaw: apsRaw,
          sharesPerAssetRaw: prev?.sharesPerAssetRaw ?? null,
          assetsPerShare: ethers.formatUnits(apsRaw, assetMeta.decimals),
          sharesPerAsset: prev?.sharesPerAsset ?? null,
        }));
      }
      // else keep previous price silently
    } catch {
      // keep previous price
    }
  }

  // Auto-refresh on connect / network / account changes and each block
  useEffect(() => {
    let detach = () => {};
    if (!provider || !vault) return;
    if (assetMeta.decimals == null || shareMeta.decimals == null) return;

    (async () => {
      await Promise.all([refresh(), refreshPrices()]);
      const onBlock = async () => {
        await Promise.all([refresh(), refreshPrices()]);
      };
      provider.on("block", onBlock);
      detach = () => {
        try {
          provider.off("block", onBlock);
        } catch {}
      };
    })();

    return detach;
  }, [
    provider,
    vault,
    address,
    version,
    chainId,
    assetMeta.decimals,
    shareMeta.decimals,
  ]);

  // Helpers for parse/format
  const formatAsset = (v) =>
    v == null ? null : ethers.formatUnits(v, assetMeta.decimals);
  const formatShares = (v) =>
    v == null ? null : ethers.formatUnits(v, shareMeta.decimals);
  const parseAsset = (s) => ethers.parseUnits(s || "0", assetMeta.decimals);
  const parseShares = (s) => ethers.parseUnits(s || "0", shareMeta.decimals);

  // Ensure ERC20 approval (asset -> vault)
  async function ensureApproval(needed) {
    if (!signer) throw new Error("Connect wallet first");
    const current = await asset.allowance(address, vaultAddress);
    if (current >= needed) return;
    const tx = await asset.connect(signer).approve(vaultAddress, needed);
    await tx.wait();
  }

  // Interactions
  async function depositAssets(amountStr) {
    if (!signer) throw new Error("Connect wallet first");
    setLoading(true);
    setError("");
    try {
      const assets = parseAsset(amountStr);
      // guard: must mint at least 1 wei of shares
      const sharesOut = await vault.previewDeposit(assets);
      if (sharesOut === 0n) {
        throw new Error(
          `Amount too small; increase deposit to mint at least one wei of ${shareMeta.symbol}.`
        );
      }
      await ensureApproval(assets);
      const tx = await vault.connect(signer).deposit(assets, address);
      await tx.wait();
      await Promise.all([refresh(), refreshPrices()]);
    } catch (e) {
      setError(e?.message ?? "Deposit failed");
      throw e;
    } finally {
      setLoading(false);
    }
  }

  async function withdrawAssets(amountStr) {
    if (!signer) throw new Error("Connect wallet first");
    setLoading(true);
    setError("");
    try {
      const assets = parseAsset(amountStr);
      // guard: must burn at least 1 share-wei
      const sharesBurn = await vault.previewWithdraw(assets);
      if (sharesBurn === 0n) {
        throw new Error(
          `Amount too small to withdraw (rounds to zero shares). Try a larger amount.`
        );
      }
      const tx = await vault.connect(signer).withdraw(assets, address, address);
      await tx.wait();
      await Promise.all([refresh(), refreshPrices()]);
    } catch (e) {
      setError(e?.message ?? "Withdraw failed");
      throw e;
    } finally {
      setLoading(false);
    }
  }

  async function redeemShares(sharesStr) {
    if (!signer) throw new Error("Connect wallet first");
    setLoading(true);
    setError("");
    try {
      const shares = parseShares(sharesStr);
      // guard: must return at least 1 asset-wei
      const assetsOut = await vault.previewRedeem(shares);
      if (assetsOut === 0n) {
        throw new Error(
          `Shares too small to redeem (rounds to < 1 ${assetMeta.symbol} wei). Try a larger amount.`
        );
      }
      const tx = await vault.connect(signer).redeem(shares, address, address);
      await tx.wait();
      await Promise.all([refresh(), refreshPrices()]);
    } catch (e) {
      setError(e?.message ?? "Redeem failed");
      throw e;
    } finally {
      setLoading(false);
    }
  }

  // Previews (return raw BigInt)
  const previewDeposit = async (s) => vault.previewDeposit(parseAsset(s));
  const previewWithdraw = async (s) => vault.previewWithdraw(parseAsset(s));
  const previewRedeem = async (s) => vault.previewRedeem(parseShares(s));

  return {
    // meta
    chainId,
    onWrongNetwork,
    assetMeta,
    shareMeta,

    // state
    loading,
    error,
    balances,
    formatted: {
      userAsset: formatAsset(balances.userAsset),
      userShares: formatShares(balances.userShares),
      vaultTotalAssets: formatAsset(balances.vaultTotalAssets),
    },

    // share price
    price, // { assetsPerShareRaw, sharesPerAssetRaw, assetsPerShare, sharesPerAsset }

    // ops
    depositAssets,
    withdrawAssets,
    redeemShares,

    // previews
    previewDeposit,
    previewWithdraw,
    previewRedeem,

    // utils
    refresh,
    parseAsset,
    parseShares,
    formatAsset,
    formatShares,
  };
}
