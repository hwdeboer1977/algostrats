import React, { useState } from "react";

export default function BridgeLiFi({ apiBase = "http://localhost:4000" }) {
  const [amountIn, setAmountIn] = useState("5");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null); // { type: "ok"|"err", text, tx? }

  async function handleBridge() {
    if (loading) return;
    setLoading(true);
    setMsg(null);

    try {
      const res = await fetch(`${apiBase}/api/bridge/bridge-lifi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountIn }),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${txt || "<empty>"}`);
      const data = JSON.parse(txt);
      if (!data.ok) throw new Error(data.error || "Script failed");

      // Try to extract a tx hash if your script prints one
      const m = (data.output || "").match(/0x[a-fA-F0-9]{64}/);
      setMsg({ type: "ok", text: "Bridge submitted.", tx: m?.[0] });
    } catch (e) {
      setMsg({ type: "err", text: e.message || String(e) });
    } finally {
      setLoading(false);
      setTimeout(() => setMsg(null), 6000);
    }
  }

  return (
    <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 16 }}>
      <h3 style={{ marginTop: 0 }}>Bridge (LiFi, server)</h3>

      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <label htmlFor="bridgeAmount">Amount:</label>
        <input
          id="bridgeAmount"
          type="number"
          min="0"
          step="0.000001"
          value={amountIn}
          onChange={(e) => setAmountIn(e.target.value)}
          placeholder="Enter amount to bridge"
          style={{ width: 160 }}
        />
        <button onClick={handleBridge} disabled={loading}>
          {loading ? "Running…" : "Bridge"}
        </button>
      </div>

      {msg && (
        <p
          style={{
            color: msg.type === "ok" ? "green" : "crimson",
            marginTop: 8,
          }}
        >
          {msg.text} {msg.tx && <span>TX: {msg.tx}</span>}
        </p>
      )}
    </div>
  );
}
