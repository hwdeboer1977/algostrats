import React, { useState } from "react";
import { ethers } from "ethers";
import { useWallet } from "./WalletProvider";
import { useVault } from "./UseVault";

export default function VaultInteractions() {
  const { connected, chain, address } = useWallet();
  const v = useVault();
  const [amount, setAmount] = useState(""); // string input in asset units (e.g., "0.001")

  const [preview, setPreview] = useState(null);

  const onPreview = async () => {
    try {
      const shares = await v.previewDeposit(amount);
      setPreview(ethers.formatUnits(shares, v.shareMeta.decimals));
    } catch (e) {
      setPreview(null);
      console.error(e);
    }
  };

  return (
    <div className="w-full max-w-lg rounded-2xl border bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold mb-3">Vault</h2>

      <div className="text-sm space-y-1 mb-4">
        <div>
          <span className="font-semibold">Chain:</span>{" "}
          {chain?.name ?? "Unknown"}
        </div>
        <div>
          <span className="font-semibold">Vault total assets:</span>{" "}
          {v.formatted.vaultTotalAssets ?? "…"} {v.assetMeta.symbol}
        </div>
        {connected && (
          <>
            <div>
              <span className="font-semibold">Your {v.assetMeta.symbol}:</span>{" "}
              {v.formatted.userAsset ?? "…"}{" "}
            </div>
            <div>
              <span className="font-semibold">Your {v.shareMeta.symbol}:</span>{" "}
              {v.formatted.userShares ?? "…"}{" "}
            </div>
            <div>
              <span className="font-semibold">Wallet:</span>{" "}
              {address.slice(0, 6)}…{address.slice(-4)}
            </div>
            <div>
              <span className="font-semibold">Share Price:</span>{" "}
              {v.price.assetsPerShare != null
                ? `${v.price.assetsPerShare} ${v.assetMeta.symbol} per 1 ${v.shareMeta.symbol}`
                : "…"}
            </div>
          </>
        )}
      </div>

      <div className="space-y-2 mb-3">
        <label className="block text-sm font-medium">
          Amount ({v.assetMeta.symbol})
        </label>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={`0.${"0".repeat(
            Math.max(0, v.assetMeta.decimals - 1)
          )}1`}
          className="w-full rounded-xl border px-3 py-2 outline-none focus:ring"
        />
        <div className="text-xs text-gray-600">
          Decimals: {v.assetMeta.decimals} • Preview shares:{" "}
          {preview != null ? `${preview} ${v.shareMeta.symbol}` : "—"}{" "}
          <button onClick={onPreview} className="underline">
            refresh
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          disabled={!connected || v.loading}
          onClick={() => v.depositAssets(amount)}
          className="rounded-xl bg-black px-4 py-2 text-white disabled:opacity-50"
        >
          Deposit
        </button>
        <button
          disabled={!connected || v.loading}
          onClick={() => v.withdrawAssets(amount)}
          className="rounded-xl bg-gray-200 px-4 py-2 disabled:opacity-50"
        >
          Withdraw (assets)
        </button>
        <button
          disabled={!connected || v.loading}
          onClick={() => v.redeemShares(amount)}
          className="rounded-xl bg-gray-200 px-4 py-2 disabled:opacity-50"
        >
          Redeem (shares)
        </button>
      </div>

      {v.error && (
        <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {v.error}
        </div>
      )}
    </div>
  );
}
