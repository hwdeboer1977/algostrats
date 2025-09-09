// src/pages/Admin.jsx
import React, { useState, useRef, useEffect } from "react";
import Card from "./Card";

export default function Admin() {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);
  const timerRef = useRef(null);
  const API = import.meta.env.VITE_ADMIN_API_URL || "http://localhost:4000";

  const showMsg = (m) => {
    clearTimeout(timerRef.current);
    setMsg(m);
    timerRef.current = setTimeout(() => setMsg(null), 6000);
  };
  useEffect(() => () => clearTimeout(timerRef.current), []);

  async function callSwap() {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch(`${API}/api/swap/wbtc-usdc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountIn: "0.00001" }),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${txt || "<empty>"}`);
      const data = JSON.parse(txt);
      if (!data.ok) throw new Error(data.error || "Script failed");

      const m = (data.output || "").match(/0x[a-fA-F0-9]{64}/);
      showMsg({ type: "ok", text: "Swap submitted.", tx: m?.[0] });
    } catch (e) {
      showMsg({ type: "err", text: e.message || String(e) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 900, margin: "40px auto", padding: 24 }}>
      <h1>Algostrats — Admin</h1>
      <p style={{ opacity: 0.7, marginBottom: 16 }}>
        Owner-only test actions. Remove by setting{" "}
        <code>VITE_ENABLE_ADMIN=false</code>.
      </p>

      <div style={{ display: "grid", gap: 12 }}>
        <button onClick={callSwap} disabled={loading}>
          {loading ? "Running…" : "Swap on Uniswap (server)"}
        </button>

        {/* Stubs for more actions */}
        <button disabled>Bridge to Solana (server)</button>
        <button disabled>Close HL Position (server)</button>
        <button disabled>Drift Deposit (server)</button>
      </div>

      {msg && (
        <div
          style={{
            marginTop: 14,
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid",
            borderColor: msg.type === "ok" ? "#1a7f37" : "#b42318",
            background: msg.type === "ok" ? "#ecfdf3" : "#fef3f2",
            color: msg.type === "ok" ? "#065f46" : "#7a271a",
            position: "relative",
          }}
        >
          <strong style={{ marginRight: 6 }}>
            {msg.type === "ok" ? "✅ Success:" : "⚠️ Error:"}
          </strong>
          {msg.text}
          {msg.tx && (
            <>
              {" "}
              —{" "}
              <a
                href={`https://arbiscan.io/tx/${msg.tx}`}
                target="_blank"
                rel="noreferrer"
              >
                View tx
              </a>
            </>
          )}
          <button
            onClick={() => setMsg(null)}
            style={{
              position: "absolute",
              right: 8,
              top: 6,
              border: "none",
              background: "transparent",
              fontSize: 16,
              cursor: "pointer",
            }}
            aria-label="Dismiss"
            title="Dismiss"
          >
            ×
          </button>
        </div>
      )}
      <Card title="Drift protocol">{/* … */}</Card>
      <Card title="Hyperliquid">{/* … */}</Card>
    </div>
  );
}
