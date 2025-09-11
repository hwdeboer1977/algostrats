import React, { useState } from "react";

export default function DriftControls({ apiBase = "http://localhost:4000" }) {
  const [depAmt, setDepAmt] = useState("1"); // Deposit amount placeholder
  const [wdAmt, setWdAmt] = useState("5"); // Withdraw amount placeholder

  const [loadingPos, setLoadingPos] = useState(false);
  const [loadingDep, setLoadingDep] = useState(false);
  const [loadingReq, setLoadingReq] = useState(false);
  const [loadingFin, setLoadingFin] = useState(false);

  const [msg, setMsg] = useState(null); // { type: "ok" | "err", text: string }
  const [output, setOutput] = useState(""); // Drift output / logs

  function autoClear(message) {
    setMsg(message);
    setTimeout(() => setMsg(null), 6000);
  }

  async function deposit() {
    if (loadingDep) return;
    setLoadingDep(true);
    setMsg(null);
    try {
      const res = await fetch(`${apiBase}/api/drift/deposit-drift`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: depAmt }),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${txt || "<empty>"}`);
      const data = JSON.parse(txt);
      if (!data.ok) throw new Error(data.error || "Deposit failed");
      setOutput(data.output || "");
      autoClear({ type: "ok", text: `Deposit OK (${depAmt})` });
    } catch (e) {
      autoClear({ type: "err", text: e.message || String(e) });
    } finally {
      setLoadingDep(false);
    }
  }

  async function requestWithdraw() {
    if (loadingReq) return;
    setLoadingReq(true);
    setMsg(null);
    try {
      const res = await fetch(`${apiBase}/api/drift/withdraw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: wdAmt }),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${txt || "<empty>"}`);
      const data = JSON.parse(txt);
      if (!data.ok) throw new Error(data.error || "Withdraw request failed");
      setOutput(data.output || "");
      autoClear({ type: "ok", text: `Withdraw requested (${wdAmt})` });
    } catch (e) {
      autoClear({ type: "err", text: e.message || String(e) });
    } finally {
      setLoadingReq(false);
    }
  }

  async function finalizeWithdraw() {
    if (loadingFin) return;
    setLoadingFin(true);
    setMsg(null);
    try {
      const res = await fetch(`${apiBase}/api/drift/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${txt || "<empty>"}`);
      const data = JSON.parse(txt);
      if (!data.ok) throw new Error(data.error || "Finalize failed");
      setOutput(data.output || "");
      autoClear({ type: "ok", text: "Withdraw finalized" });
    } catch (e) {
      autoClear({ type: "err", text: e.message || String(e) });
    } finally {
      setLoadingFin(false);
    }
  }

  return (
    <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 16 }}>
      <h3 style={{ marginTop: 0 }}>Drift (server)</h3>

      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <label>Deposit amount:</label>
        <input
          value={depAmt}
          onChange={(e) => setDepAmt(e.target.value)}
          style={{ width: 120 }}
          placeholder="1"
        />
        <button onClick={deposit} disabled={loadingDep}>
          {loadingDep ? "Running…" : "Deposit"}
        </button>

        <label>Withdraw amount:</label>
        <input
          value={wdAmt}
          onChange={(e) => setWdAmt(e.target.value)}
          style={{ width: 120 }}
          placeholder="5"
        />
        <button onClick={requestWithdraw} disabled={loadingReq}>
          {loadingReq ? "Running…" : "Request Withdraw"}
        </button>

        <button onClick={finalizeWithdraw} disabled={loadingFin}>
          {loadingFin ? "Running…" : "Finalize Withdraw"}
        </button>
      </div>

      {msg && (
        <p
          style={{
            color: msg.type === "ok" ? "green" : "crimson",
            marginTop: 8,
          }}
        >
          {msg.text}
        </p>
      )}

      {output && (
        <details open style={{ marginTop: 12 }}>
          <summary>Drift output</summary>
          <pre
            style={{
              background: "#f7f7f7",
              padding: 12,
              borderRadius: 8,
              whiteSpace: "pre-wrap",
            }}
          >
            {output}
          </pre>
        </details>
      )}
    </div>
  );
}
