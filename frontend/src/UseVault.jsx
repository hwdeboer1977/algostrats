// src/useVault.jsx
import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import config from "./config.json";
import { useWallet } from "./WalletProvider";
import vaultAbi from "./abis/vault.json"; // <- your real ABI

// Minimal ERC20 ABI for the asset (WBTC)
const erc20Abi = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

// Expected chain (so we can show a clear message if user is on the wrong network)
const EXPECTED_CHAIN_ID = Number(config.chainId || 42161); // default Arbitrum

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
    userShares: null, // user's yBTC (vault shares)
    vaultTotalAssets: null, // total assets managed by the vault
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

  // Refresh balances + total assets
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

  // Auto-refresh on connect / network / account changes and each block
  useEffect(() => {
    let detach = () => {};
    if (!provider || !address || !vault) return;
    (async () => {
      await refresh();
      const onBlock = async () => {
        await refresh();
      };
      provider.on("block", onBlock);
      detach = () => {
        try {
          provider.off("block", onBlock);
        } catch {}
      };
    })();
    return detach;
  }, [provider, address, vault, version, chainId]);

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
      await ensureApproval(assets);
      const tx = await vault.connect(signer).deposit(assets, address);
      await tx.wait();
      await refresh();
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
      const tx = await vault.connect(signer).withdraw(assets, address, address);
      await tx.wait();
      await refresh();
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
      const tx = await vault.connect(signer).redeem(shares, address, address);
      await tx.wait();
      await refresh();
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
