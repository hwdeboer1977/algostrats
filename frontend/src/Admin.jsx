// src/pages/Admin.jsx
import React, { useState, useRef, useEffect } from "react";
import Card from "./Card";
import ConnectButton from "./ConnectButton";
import HLOpenOrder from "./HLOpenOrder";
import SwapUniswap from "./swapUniswap";
import BridgeLiFi from "./bridgeLiFi";
import DriftControls from "./driftControls";

export default function Admin() {
  // separate loaders
  const [loadingHL, setLoadingHL] = useState(false);
  const [loadingDriftPos, setLoadingDriftPos] = useState(false);

  // Render output HL, Drift
  const [hlOutput, setHlOutput] = useState("");
  const [driftOutput, setDriftOutput] = useState("");

  // optional: separate messages
  const [msgHL, setMsgHL] = useState(null);
  const [msgDrift, setMsgDrift] = useState(null);

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

  // Function to read all position info from Hyperliquid
  async function getPositionHL() {
    if (loadingHL) return;
    setLoadingHL(true);
    autoClear(setMsgHL, null);
    try {
      const res = await fetch(`${API}/api/hl-command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "summary" }),
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

  return (
    <div style={{ maxWidth: 900, margin: "40px auto", padding: 24 }}>
      <h1>Algostrats — Admin</h1>

      {/* Get current position on Drift protocol */}
      <button onClick={getPositionDrift} disabled={loadingDriftPos}>
        {loadingDriftPos ? "Running…" : "Get Drift Positions (server)"}
      </button>
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

      {/* Get current position on HL protocol */}
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

      <div style={{ display: "grid", gap: 12 }}>
        {/*Open script to Swap on Uniswap*/}
        <SwapUniswap apiBase={API} />

        {/*Open script to Bridge to Solana*/}
        <BridgeLiFi apiBase={API} />

        {/*Open script for orders Hyperliquid*/}
        <HLOpenOrder apiBase={API} />

        {/*Open script for orders Drift protocol*/}
        <DriftControls apiBase={API} />
      </div>
    </div>
  );
}
