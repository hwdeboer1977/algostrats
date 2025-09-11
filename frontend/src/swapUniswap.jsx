import React, { useState } from "react";

export default function SwapUniswap({ apiBase = "http://localhost:4000" }) {
  const [amountIn, setAmountIn] = useState("0.00001"); // default placeholder
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null); // { type: "ok"|"err", text, tx? }

  async function handleSwap() {
    if (loading) return;
    setLoading(true);
    setMsg(null);

    try {
      const res = await fetch(`${apiBase}/api/swap/wbtc-usdc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountIn }), // pass amount to backend
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${txt || "<empty>"}`);
      const data = JSON.parse(txt);
      if (!data.ok) throw new Error(data.error || "Script failed");

      const m = (data.output || "").match(/0x[a-fA-F0-9]{64}/);
      setMsg({ type: "ok", text: "Swap submitted.", tx: m?.[0] });
    } catch (e) {
      setMsg({ type: "err", text: e.message || String(e) });
    } finally {
      setLoading(false);
      // auto-clear after 6s
      setTimeout(() => setMsg(null), 6000);
    }
  }

  return (
    <>
      <div className="field">
        <label htmlFor="amountIn">Amount:</label>
        <input
          id="amountIn"
          type="number"
          min="0"
          step="0.000001"
          value={amountIn}
          onChange={(e) => setAmountIn(e.target.value)}
          placeholder="Enter amount to swap"
        />
      </div>

      <div className="btn-row">
        <button className="btn" onClick={handleSwap} disabled={loading}>
          {loading ? "Running…" : "Swap"}
        </button>
      </div>

      {msg && (
        <p
          className={`status ${msg.type === "ok" ? "status-ok" : "status-err"}`}
        >
          {msg.text} {msg.tx && <span>TX: {msg.tx}</span>}
        </p>
      )}
    </>
  );
}
