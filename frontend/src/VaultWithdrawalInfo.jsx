// src/VaultWithdrawalInfo.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ethers, formatUnits } from "ethers";
import vaultAbi from "./abis/vault.json"; // must contain pendingOf, pendingShares, pendingUnlockAt, redemptionPeriod, decimals

function fmtDuration(seconds) {
  seconds = Math.max(0, Number(seconds || 0));
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d) return `${d}d ${h}h ${m}m ${s}s`;
  if (h) return `${h}h ${m}m ${s}s`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * Props:
 * - vaultAddress: string (required)
 * - account?: string (optional)
 * - rpcUrl?: string (optional)
 * - pollMs?: number (optional, default 10s)
 */
export default function VaultWithdrawalInfo({
  vaultAddress,
  account,
  rpcUrl,
  pollMs = 10_000,
}) {
  const CLAIM_BUFFER_SEC = 0; // treat "almost unlocked" as ready if you want

  const [addr, setAddr] = useState(account ?? null);
  const [decimals, setDecimals] = useState(18);
  const [redemptionPeriod, setRedemptionPeriod] = useState(0n);

  // pendingOf
  const [poShares, setPoShares] = useState(0n);
  const [poUnlockAt, setPoUnlockAt] = useState(0n);

  // public mappings
  const [mapPendingShares, setMapPendingShares] = useState(0n);
  const [mapPendingUnlockAt, setMapPendingUnlockAt] = useState(0n);

  // local countdown (seconds)
  const [localTimeLeft, setLocalTimeLeft] = useState(0);

  // Vault totals (BigInt)
  const [totalAssets, setTotalAssets] = useState(0n);
  const [totalSupply, setTotalSupply] = useState(0n);

  // env + contract sanity
  const [chainId, setChainId] = useState(null);
  const [contractOk, setContractOk] = useState(false);

  const contractRef = useRef(null);
  const providerRef = useRef(null);

  // keep addr in sync with prop
  useEffect(() => {
    setAddr(account ?? null);
  }, [account]);

  // Init provider + validate contract code at address
  useEffect(() => {
    (async () => {
      setContractOk(false);
      contractRef.current = null;

      const fallbackRpc =
        rpcUrl ||
        (import.meta?.env && import.meta.env.VITE_ARBITRUM_ALCHEMY_MAINNET);

      const provider = fallbackRpc
        ? new ethers.JsonRpcProvider(fallbackRpc)
        : typeof window !== "undefined" && window.ethereum
        ? new ethers.BrowserProvider(window.ethereum)
        : null;

      if (!provider) {
        console.error("No provider (rpcUrl or window.ethereum) available");
        return;
      }

      providerRef.current = provider;

      // Check network + that address has contract code
      try {
        const [net, code] = await Promise.all([
          provider.getNetwork(),
          provider.getCode(vaultAddress),
        ]);
        setChainId(Number(net.chainId));

        if (code === "0x") {
          console.error(
            "Address has no contract code on this network:",
            vaultAddress
          );
          return; // don't proceed
        }
      } catch (e) {
        console.error("Failed to check network/code:", e);
        return;
      }

      // Create contract (read-only)
      const c = new ethers.Contract(vaultAddress, vaultAbi, provider);
      contractRef.current = c;
      setContractOk(true);

      // Get signer address only if not provided and using BrowserProvider
      if (!account && provider instanceof ethers.BrowserProvider) {
        try {
          const signer = await provider.getSigner();
          setAddr(await signer.getAddress());
        } catch {
          // not connected; fine for read-only
        }
      }
    })();
  }, [vaultAddress, rpcUrl, account]);

  // Load static values (decimals, redemptionPeriod, totals)
  useEffect(() => {
    (async () => {
      const c = contractRef.current;
      if (!c || !contractOk) return;
      try {
        const dec = await c.decimals().catch(() => 18);
        setDecimals(Number(dec));
      } catch (e) {
        console.error("Failed to load decimals:", e);
      }

      try {
        const rp = await c.redemptionPeriod();
        setRedemptionPeriod(rp);
      } catch (e) {
        console.warn("redemptionPeriod() unavailable; defaulting to 0.", e);
        setRedemptionPeriod(0n);
      }

      try {
        const assets = await c.totalAssets();
        setTotalAssets(assets ?? 0n);
      } catch (e) {
        console.warn("totalAssets() unavailable; defaulting to 0.", e);
        setTotalAssets(0n);
      }

      try {
        const supply = await c.totalSupply();
        setTotalSupply(supply ?? 0n);
      } catch (e) {
        console.warn("totalSupply() unavailable; defaulting to 0.", e);
        setTotalSupply(0n);
      }
    })();
  }, [vaultAddress, contractOk]);

  // Load user-dependent values; poll every pollMs
  useEffect(() => {
    let interval;
    const fetchUser = async () => {
      const c = contractRef.current;
      if (!c || !addr || !contractOk) return;
      try {
        const [shares, unlockAt /*, timeLeft*/] = await c.pendingOf(addr);
        setPoShares(shares);
        setPoUnlockAt(unlockAt);

        const [pShares, pUnlock] = await Promise.all([
          c.pendingShares(addr).catch(() => 0n),
          c.pendingUnlockAt(addr).catch(() => 0n),
        ]);
        setMapPendingShares(pShares);
        setMapPendingUnlockAt(pUnlock);

        const now = Math.floor(Date.now() / 1000);
        setLocalTimeLeft(
          Number(unlockAt > BigInt(now) ? unlockAt - BigInt(now) : 0n)
        );
      } catch (e) {
        console.error("Failed to load user pending data:", e);
      }
    };

    fetchUser();
    interval = setInterval(fetchUser, pollMs);
    return () => clearInterval(interval);
  }, [addr, vaultAddress, pollMs, contractOk]);

  // ---- Derived unlock fields (compute before countdown effect) ----
  const unlockAtToShow = useMemo(() => {
    const v = mapPendingUnlockAt ?? 0n;
    return v > 0n ? v : poUnlockAt ?? 0n;
  }, [mapPendingUnlockAt, poUnlockAt]);

  const unlockAtSec = useMemo(
    () => Number(unlockAtToShow || 0n),
    [unlockAtToShow]
  );

  const unlockDate = useMemo(
    () => (unlockAtSec > 0 ? new Date(unlockAtSec * 1000) : null),
    [unlockAtSec]
  );

  // Smooth 1s countdown from unlockAt
  useEffect(() => {
    const id = setInterval(() => {
      setLocalTimeLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [unlockAtSec]);

  // Derived display values
  const pendingSharesToShow = useMemo(() => {
    const v = mapPendingShares ?? 0n;
    return v > 0n ? v : poShares ?? 0n;
  }, [mapPendingShares, poShares]);

  // pending wBTC = user's pending shares * (totalAssets / totalSupply)
  // All values are BigInt; result is in asset units (wBTC has 8 decimals).
  const pendingWbtcRaw = useMemo(() => {
    if (!pendingSharesToShow || totalSupply === 0n) return 0n;
    return (pendingSharesToShow * totalAssets) / totalSupply;
  }, [pendingSharesToShow, totalAssets, totalSupply]);

  const formattedPendingWbtc = useMemo(
    () => formatUnits(pendingWbtcRaw, 8), // wBTC is 8 decimals
    [pendingWbtcRaw]
  );

  // Claimability & dynamic labels
  const nowSec = Math.floor(Date.now() / 1000);
  const isClaimable =
    unlockAtSec > 0 && nowSec + CLAIM_BUFFER_SEC >= unlockAtSec;
  const sharesLabel = isClaimable ? "Ready to claim (shares)" : "Queued shares";
  const wbtcLabel = isClaimable ? "Claimable wBTC" : "Estimated wBTC";
  const timeLabel = isClaimable ? "Ready" : fmtDuration(localTimeLeft);

  const formattedPendingShares = useMemo(
    () => formatUnits(pendingSharesToShow || 0n, decimals),
    [pendingSharesToShow, decimals]
  );

  return (
    <div className="w-full max-w-lg rounded-2xl border bg-white p-5 shadow-sm space-y-3">
      <div className="text-sm opacity-70">
        Vault: {vaultAddress}{" "}
        {chainId ? <span className="opacity-60">• chain {chainId}</span> : null}
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Withdrawal status</h2>
        <span
          className={`text-xs px-2 py-1 rounded-full ${
            isClaimable
              ? "bg-green-100 text-green-700"
              : "bg-amber-100 text-amber-700"
          }`}
        >
          {isClaimable ? "Claimable" : "Queued"}
        </span>
      </div>

      {!contractOk ? (
        <div className="text-sm text-red-600">
          The address doesn’t look like a vault on this network (no contract
          code or wrong chain). Check <code>vaultAddress</code> and your{" "}
          <code>rpcUrl</code>.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="font-medium">
              Redemption period: {fmtDuration(Number(redemptionPeriod))}
            </div>

            <div className="font-medium">
              {sharesLabel}: {formattedPendingShares}
            </div>

            <div className="font-medium">
              {wbtcLabel}: {formattedPendingWbtc}
            </div>

            <div className="font-medium">
              Unlocks at: {unlockDate ? unlockDate.toLocaleString() : "—"}
            </div>

            <div className="font-medium">Time left: {timeLabel}</div>
          </div>

          {!addr && (
            <p className="text-xs text-gray-500">
              Connect your wallet to see your pending queue. Read-only values
              still load via RPC.
            </p>
          )}
        </>
      )}
    </div>
  );
}
