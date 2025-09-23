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
 * - vaultAddress: string (required) -> the VAULT contract address
 * - account?: string (optional)     -> user address; if omitted and using BrowserProvider, component will try getSigner()
 * - rpcUrl?: string (optional)      -> read-only RPC (preferred to avoid wrong-network issues)
 * - pollMs?: number (optional)      -> refresh interval for user data (default 10s)
 */
export default function VaultWithdrawalInfo({
  vaultAddress,
  account,
  rpcUrl,
  pollMs = 10_000,
}) {
  const [addr, setAddr] = useState(account ?? null);
  const [decimals, setDecimals] = useState(18);
  const [redemptionPeriod, setRedemptionPeriod] = useState(0n);

  // pendingOf
  const [poShares, setPoShares] = useState(0n);
  const [poUnlockAt, setPoUnlockAt] = useState(0n);

  // public mappings
  const [mapPendingShares, setMapPendingShares] = useState(0n);
  const [mapPendingUnlockAt, setMapPendingUnlockAt] = useState(0n);

  // local countdown
  const [localTimeLeft, setLocalTimeLeft] = useState(0);

  const [totalAssets, setTotalAssets] = useState(0);
  const [totalSupply, setTotalSupply] = useState(0);

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
        rpcUrl || import.meta.env.VITE_ARBITRUM_ALCHEMY_MAINNET;

      const provider = fallbackRpc
        ? new ethers.JsonRpcProvider(fallbackRpc)
        : window.ethereum
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

  // Load static values (decimals, redemptionPeriod)
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
        // If ABI or contract doesn't have the function, catch and show 0
        const rp = await c.redemptionPeriod();
        setRedemptionPeriod(rp);
      } catch (e) {
        console.warn(
          "redemptionPeriod() unavailable; defaulting to 0. Reason:",
          e
        );
        setRedemptionPeriod(0n);
      }
      try {
        // If ABI or contract doesn't have the function, catch and show 0
        const assets = await c.totalAssets();
        setTotalAssets(assets);
      } catch (e) {
        console.warn(
          "redemptionPeriod() unavailable; defaulting to 0. Reason:",
          e
        );
        setTotalAssets(0n);
      }
      try {
        // If ABI or contract doesn't have the function, catch and show 0
        const supply = await c.totalSupply();
        setTotalSupply(supply);
      } catch (e) {
        console.warn(
          "redemptionPeriod() unavailable; defaulting to 0. Reason:",
          e
        );
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
        const [shares, unlockAt, timeLeft] = await c.pendingOf(addr);
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

  // Smooth 1s countdown from unlockAt
  useEffect(() => {
    const id = setInterval(() => {
      setLocalTimeLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [poUnlockAt]);

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

  const unlockAtToShow = useMemo(() => {
    const v = mapPendingUnlockAt ?? 0n;
    return v > 0n ? v : poUnlockAt ?? 0n;
  }, [mapPendingUnlockAt, poUnlockAt]);

  const unlockDate = useMemo(() => {
    const ts = Number(unlockAtToShow || 0n) * 1000;
    return ts > 0 ? new Date(ts) : null;
  }, [unlockAtToShow]);

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
      <h2 className="text-lg font-semibold">Withdrawal status</h2>

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
              Pending shares: {formattedPendingShares}
            </div>

            <div className="font-medium">
              Pending wBTC: {formattedPendingWbtc}
            </div>

            <div className="font-medium">
              Unlocks at: {unlockDate ? unlockDate.toLocaleString() : "—"}
            </div>

            <div className="font-medium">
              Time left: {fmtDuration(localTimeLeft)}
            </div>
          </div>

          {!addr && (
            <p className="text-xs text-gray-500">
              Connect your wallet to see your pending queue. Read-only values
              still load via RPC.
            </p>
          )}
        </>
      )}

      <p className="text-xs text-gray-500">
        Note: the live countdown is computed locally from <code>unlockAt</code>{" "}
        for smooth updates. The “chain timeLeft” is read from{" "}
        <code>pendingOf()</code> and updates on refresh/polls.
      </p>
    </div>
  );
}
