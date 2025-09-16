import React, { useState, useEffect } from "react";
import { JsonRpcProvider, Contract } from "ethers";
import { ethers } from "ethers";

/**
 * Pure server-driven swap:
 * - Lets user choose which backend key to use: 'owner' | 'A' | 'B'
 * - Sends amount + wallet to the backend
 * - Backend maps wallet -> PK and executes your swap script
 */

const WBTC = "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f";
const USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";

const ADDRS = {
  owner: "0x6122db054706cD0Ff66301F5Afc5D121644D0997", // e.g. 0x...
  A: "0x2e289b752C660487575ab6A4BA0bd2aA94ffA47E",
  B: "0x3eda14756c0E5bA3b937F128F25B44615d2925e6", // e.g. 0x...
};

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

export default function SwapWBTCUSDCServer({
  apiBase = "http://localhost:4000",
}) {
  const [amountIn, setAmountIn] = useState("0.00001");
  const [wallet, setWallet] = useState("owner"); // 'owner' | 'A' | 'B'
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null); // { type:'ok'|'err', text, tx? }

  // Add these states
  const [addr, setAddr] = useState(null);
  const [wbtcBal, setWbtcBal] = useState(null);
  const [usdcBal, setUsdcBal] = useState(null);
  const [balLoading, setBalLoading] = useState(false);

  // Connect to the Arbitrum network
  const provider = new JsonRpcProvider(
    "https://arb-mainnet.g.alchemy.com/v2/_e51noiWVD5o9bd-pnoNpy6mG0PHiTaM"
  );

  async function loadBalances(a) {
    if (!a) return;
    setBalLoading(true);
    try {
      const wbtc = new Contract(WBTC, ERC20_ABI, provider);
      const usdc = new Contract(USDC, ERC20_ABI, provider);

      const balanceWBTC = await wbtc.balanceOf(a);
      const decimalsWBTC = await wbtc.decimals();

      const balanceUSDC = await usdc.balanceOf(a);
      const decimalsUSDC = await usdc.decimals();

      const humanWBTC = ethers.formatUnits(balanceWBTC, decimalsWBTC);
      const humanUSDC = ethers.formatUnits(balanceUSDC, decimalsUSDC);

      setWbtcBal(humanWBTC);
      setUsdcBal(humanUSDC);
    } catch (e) {
      console.error("balance load failed:", e);
      setWbtcBal(null);
      setUsdcBal(null);
    } finally {
      setBalLoading(false);
    }
  }

  // 🔁 re-read when wallet selection changes
  useEffect(() => {
    const a = ADDRS[wallet];
    setAddr(a || null);
    if (a) loadBalances(a);
    else {
      setWbtcBal(null);
      setUsdcBal(null);
    }
  }, [wallet]);

  async function handleSwap() {
    if (loading) return;
    setLoading(true);
    setMsg(null);

    try {
      if (!amountIn || Number(amountIn) <= 0) {
        throw new Error("Enter a positive amount.");
      }

      const res = await fetch(`${apiBase}/api/swap/wbtc-usdc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountIn, wallet }),
      });

      const txt = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${txt || "<empty>"}`);
      const data = JSON.parse(txt);

      if (!data.ok) throw new Error(data.error || "Swap failed.");

      // Try to pull a tx hash out of output if the script prints it
      const m = String(data.output || "").match(/0x[a-fA-F0-9]{64}/);
      setMsg({
        type: "ok",
        text: `Swap submitted using Wallet ${wallet.toUpperCase()}.`,
        tx: m?.[0],
      });
    } catch (e) {
      setMsg({ type: "err", text: e?.message || String(e) });
    } finally {
      setLoading(false);
      setTimeout(() => setMsg(null), 8000);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 520 }}>
      {/* Wallet picker */}
      <div className="segment">
        {["owner", "A", "B"].map((k) => (
          <button
            key={k}
            className={`seg-btn ${wallet === k ? "active" : ""}`}
            onClick={() => setWallet(k)}
            aria-pressed={wallet === k}
          >
            {k === "owner" ? "Wallet Owner" : `Wallet ${k}`}
          </button>
        ))}
      </div>

      <label htmlFor="amountIn" style={{ display: "block", marginBottom: 6 }}>
        Amount WBTC
      </label>
      <input
        id="amountIn"
        type="number"
        min="0"
        step="0.00000001"
        value={amountIn}
        onChange={(e) => setAmountIn(e.target.value)}
        placeholder="0.0"
        style={{ width: "100%", padding: 8, marginBottom: 12 }}
      />

      <button className="btn" onClick={handleSwap} disabled={loading}>
        {loading ? "Swapping…" : `Swap (Wallet ${wallet.toUpperCase()})`}
      </button>

      {/* Selected wallet only */}
      <div style={{ marginTop: 12, fontSize: 14 }}>
        <div>
          <strong>Wallet address:</strong> {addr ?? "—"}
        </div>
        <div>
          <strong>Balance wBTC:</strong> {balLoading ? "…" : wbtcBal ?? "—"}
        </div>
        <div>
          <strong>Balance USDC:</strong> {balLoading ? "…" : usdcBal ?? "—"}
        </div>
        <button
          className="btn"
          style={{ marginTop: 8 }}
          onClick={() => addr && loadBalances(addr)}
        >
          Refresh balances
        </button>
      </div>

      {msg && (
        <p
          style={{
            marginTop: 10,
            color: msg.type === "ok" ? "green" : "crimson",
          }}
        >
          {msg.text}{" "}
          {msg.tx && (
            <>
              |{" "}
              <a
                href={`https://arbiscan.io/tx/${msg.tx}`}
                target="_blank"
                rel="noreferrer"
              >
                View
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
}
