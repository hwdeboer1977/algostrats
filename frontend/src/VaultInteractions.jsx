// src/VaultInteractions.jsx
import React, { useState } from "react";
import { ethers } from "ethers";
import { useWallet } from "./WalletProvider";
import { useVault } from "./UseVault";

export default function VaultInteractions() {
  const { connected, chain, address } = useWallet();
  const v = useVault();

  // string input in asset units (e.g., "0.001")
  const [amount, setAmount] = useState("");
  const [preview, setPreview] = useState(null);

  async function onPreview() {
    try {
      const shares = await v.previewDeposit(amount);
      setPreview(ethers.formatUnits(shares, v.shareMeta.decimals));
    } catch (e) {
      console.error(e);
      setPreview(null);
    }
  }

  const assetDecimals = Number(v?.assetMeta?.decimals ?? 6);
  const placeholder = `0.${"0".repeat(Math.max(0, assetDecimals - 1))}1`;

  return (
    <>
      {/* Info */}
      <p className="muted">Chain: {chain?.name ?? "Unknown"}</p>
      <p className="muted">
        Vault total assets: {v.formatted.vaultTotalAssets ?? "…"}{" "}
        {v.assetMeta.symbol}
      </p>

      {connected && (
        <>
          <div className="wallet-row">
            <span className="label">Your {v.assetMeta.symbol}:</span>
            <span>{v.formatted.userAsset ?? "…"}</span>
          </div>
          <div className="wallet-row">
            <span className="label">Your {v.shareMeta.symbol}:</span>
            <span>{v.formatted.userShares ?? "…"}</span>
          </div>
          <div className="wallet-row">
            <span className="label">Wallet:</span>
            <span>
              {address.slice(0, 6)}…{address.slice(-4)}
            </span>
          </div>
          <div className="wallet-row">
            <span className="label">Share Price:</span>
            <span>
              {v.price.assetsPerShare != null
                ? `${v.price.assetsPerShare} ${v.assetMeta.symbol} per 1 ${v.shareMeta.symbol}`
                : "…"}
            </span>
          </div>
        </>
      )}

      {/* Amount input */}
      <div className="field" style={{ marginTop: 10 }}>
        <label htmlFor="vault-amount">Amount ({v.assetMeta.symbol})</label>
        <input
          id="vault-amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={placeholder}
        />
      </div>

      <div className="between" style={{ marginTop: 6 }}>
        <span className="muted">
          Decimals: {assetDecimals} • Preview shares:{" "}
          {preview != null ? `${preview} ${v.shareMeta.symbol}` : "—"}
        </span>
        <button className="btn btn-sm" onClick={onPreview}>
          refresh
        </button>
      </div>

      {/* Actions */}
      <div className="btn-row" style={{ marginTop: 10 }}>
        <button
          className="btn btn-secondary"
          disabled={!connected || v.loading}
          onClick={() => v.depositAssets(amount)}
        >
          Deposit
        </button>

        <button
          className="btn btn-secondary"
          disabled={!connected || v.loading}
          onClick={() => v.withdrawAssets(amount)}
        >
          Withdraw (assets)
        </button>

        <button
          className="btn btn-secondary"
          disabled={!connected || v.loading}
          onClick={() => v.redeemShares(amount)}
        >
          Redeem (shares)
        </button>
      </div>

      {/* Error */}
      {v.error && (
        <div className="notice notice-err" style={{ marginTop: 10 }}>
          <pre className="mono">{v.error}</pre>
        </div>
      )}
    </>
  );
}
