import React, { useState } from "react";

/**
 * Pure server-driven swap:
 * - Lets user choose which backend key to use: 'owner' | 'A' | 'B'
 * - Sends amount + wallet to the backend
 * - Backend maps wallet -> PK and executes your swap script
 */
export default function SwapWBTCUSDCServer({
  apiBase = "http://localhost:4000",
}) {
  const [amountIn, setAmountIn] = useState("0.00001");
  const [wallet, setWallet] = useState("owner"); // 'owner' | 'A' | 'B'
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null); // { type:'ok'|'err', text, tx? }

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
