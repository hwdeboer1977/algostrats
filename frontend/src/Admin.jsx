// src/pages/Admin.jsx
import React, { useState, useRef, useEffect } from "react";
import Card from "./Card";
import ConnectButton from "./ConnectButton";

export default function Admin() {
  // separate loaders
  const [loadingSwap, setLoadingSwap] = useState(false);
  const [loadingHL, setLoadingHL] = useState(false);
  const [loadingDriftPos, setLoadingDriftPos] = useState(false);
  const [loadingDriftDep, setLoadingDriftDep] = useState(false);
  const [loadingDriftReq, setLoadingDriftReq] = useState(false);
  const [loadingDriftFin, setLoadingDriftFin] = useState(false);

  // Render output HL, Drift
  const [hlOutput, setHlOutput] = useState("");
  const [driftOutput, setDriftOutput] = useState("");

  // optional: separate messages
  const [msgSwap, setMsgSwap] = useState(null);
  const [msgHL, setMsgHL] = useState(null);
  const [msgDrift, setMsgDrift] = useState(null);

  // drift inputs
  const [depAmt, setDepAmt] = useState("1"); // BigInt-able string
  const [wdAmt, setWdAmt] = useState("5");

  // API from backend server
  const API = import.meta.env.VITE_ADMIN_API_URL || "http://localhost:4000";
  const timers = useRef([]);

  // Function to clear message after 6 seconds
  const autoClear = (setter, val) => {
    setter(val);
    const t = setTimeout(() => setter(null), 6000);
    timers.current.push(t);
  };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Function to call the swap
  async function callSwap() {
    if (loadingSwap) return;
    setLoadingSwap(true);
    autoClear(setMsgSwap, null);
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
      autoClear(setMsgSwap, {
        type: "ok",
        text: "Swap submitted.",
        tx: m?.[0],
      });
    } catch (e) {
      autoClear(setMsgSwap, { type: "err", text: e.message || String(e) });
    } finally {
      setLoadingSwap(false);
    }
  }

  // Function to read all position info from Hyperliquid
  async function getPositionHL() {
    if (loadingHL) return;
    setLoadingHL(true);
    autoClear(setMsgHL, null);
    try {
      const res = await fetch(`${API}/api/hl/get-pos-HL`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${txt || "<empty>"}`);
      const data = JSON.parse(txt);
      if (!data.ok) throw new Error(data.error || "Script failed");

      // try to pretty-print JSON output; else just keep raw
      let pretty = data.output || "";
      try {
        const obj = JSON.parse(pretty);
        pretty = JSON.stringify(obj, null, 2);
      } catch {
        /* not JSON, ignore */
      }
      setHlOutput(pretty);

      autoClear(setMsgHL, { type: "ok", text: "Positions fetched." });
    } catch (e) {
      autoClear(setMsgHL, { type: "err", text: e.message || String(e) });
    } finally {
      setLoadingHL(false);
    }
  }

  // --- DRIFT POS ---
  async function getPositionDrift() {
    if (loadingDriftPos) return;
    setLoadingDriftPos(true);
    autoClear(setMsgDrift, null);
    try {
      const res = await fetch(`${API}/api/drift/get-pos-drift`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${txt || "<empty>"}`);
      const data = JSON.parse(txt);
      if (!data.ok) throw new Error(data.error || "Script failed");
      let pretty = data.output || "";
      try {
        pretty = JSON.stringify(JSON.parse(pretty), null, 2);
      } catch {}
      setDriftOutput(pretty);
      autoClear(setMsgDrift, { type: "ok", text: "Drift positions fetched." });
    } catch (e) {
      autoClear(setMsgDrift, { type: "err", text: e.message || String(e) });
    } finally {
      setLoadingDriftPos(false);
    }
  }

  // --- DRIFT DEPOSIT ---
  async function driftDeposit() {
    if (loadingDriftDep) return;
    setLoadingDriftDep(true);
    autoClear(setMsgDrift, null);
    try {
      const res = await fetch(`${API}/api/drift/deposit-drift`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: depAmt }), // server passes to testDriftService.mjs as argv
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${txt || "<empty>"}`);
      const data = JSON.parse(txt);
      if (!data.ok) throw new Error(data.error || "Deposit failed");
      setDriftOutput(data.output || "");
      autoClear(setMsgDrift, { type: "ok", text: `Deposit OK (${depAmt})` });
    } catch (e) {
      autoClear(setMsgDrift, { type: "err", text: e.message || String(e) });
    } finally {
      setLoadingDriftDep(false);
    }
  }

  // --- DRIFT WITHDRAW REQUEST ---
  async function driftWithdraw() {
    if (loadingDriftReq) return;
    setLoadingDriftReq(true);
    autoClear(setMsgDrift, null);
    try {
      const res = await fetch(`${API}/api/drift/withdraw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: wdAmt }),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${txt || "<empty>"}`);
      const data = JSON.parse(txt);
      if (!data.ok) throw new Error(data.error || "Withdraw request failed");
      setDriftOutput(data.output || "");
      autoClear(setMsgDrift, {
        type: "ok",
        text: `Withdraw requested (${wdAmt})`,
      });
    } catch (e) {
      autoClear(setMsgDrift, { type: "err", text: e.message || String(e) });
    } finally {
      setLoadingDriftReq(false);
    }
  }

  // --- DRIFT WITHDRAW FINALIZE ---
  async function driftFinalize() {
    if (loadingDriftFin) return;
    setLoadingDriftFin(true);
    autoClear(setMsgDrift, null);
    try {
      const res = await fetch(`${API}/api/drift/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${txt || "<empty>"}`);
      const data = JSON.parse(txt);
      if (!data.ok) throw new Error(data.error || "Finalize failed");
      setDriftOutput(data.output || "");
      autoClear(setMsgDrift, { type: "ok", text: "Withdraw finalized" });
    } catch (e) {
      autoClear(setMsgDrift, { type: "err", text: e.message || String(e) });
    } finally {
      setLoadingDriftFin(false);
    }
  }

  return (
    <div style={{ maxWidth: 900, margin: "40px auto", padding: 24 }}>
      <h1>Algostrats — Admin</h1>

      <div style={{ display: "grid", gap: 12 }}>
        <button onClick={callSwap} disabled={loadingSwap}>
          {loadingSwap ? "Running…" : "Swap on Uniswap (server)"}
        </button>
        {msgSwap && (
          <p style={{ color: msgSwap.type === "ok" ? "green" : "crimson" }}>
            {msgSwap.text}
          </p>
        )}

        <button onClick={getPositionHL} disabled={loadingHL}>
          {loadingHL ? "Running…" : "Get HL Positions (server)"}
        </button>
        {msgHL && (
          <p style={{ color: msgHL.type === "ok" ? "green" : "crimson" }}>
            {msgHL.text}
          </p>
        )}
        {hlOutput && (
          <details open style={{ marginTop: 12 }}>
            <summary>Hyperliquid positions output</summary>
            <pre
              style={{
                background: "#f7f7f7",
                padding: 12,
                borderRadius: 8,
                whiteSpace: "pre-wrap",
              }}
            >
              {hlOutput}
            </pre>
          </details>
        )}

        <button onClick={getPositionDrift} disabled={loadingDriftPos}>
          {loadingDriftPos ? "Running…" : "Get Drift Positions (server)"}
        </button>

        <div style={{ marginTop: 8 }}>
          <label>Deposit amount: </label>
          <input
            value={depAmt}
            onChange={(e) => setDepAmt(e.target.value)}
            style={{ marginRight: 8 }}
          />
          <button onClick={driftDeposit} disabled={loadingDriftDep}>
            {loadingDriftDep ? "Running…" : "Deposit"}
          </button>
        </div>

        <div>
          <label>Withdraw amount: </label>
          <input
            value={wdAmt}
            onChange={(e) => setWdAmt(e.target.value)}
            style={{ marginRight: 8 }}
          />
          <button onClick={driftWithdraw} disabled={loadingDriftReq}>
            {loadingDriftReq ? "Running…" : "Request Withdraw"}
          </button>
          <button
            onClick={driftFinalize}
            disabled={loadingDriftFin}
            style={{ marginLeft: 8 }}
          >
            {loadingDriftFin ? "Running…" : "Finalize Withdraw"}
          </button>
        </div>

        {msgDrift && (
          <p style={{ color: msgDrift.type === "ok" ? "green" : "crimson" }}>
            {msgDrift.text}
          </p>
        )}
        {driftOutput && (
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
              {driftOutput}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
