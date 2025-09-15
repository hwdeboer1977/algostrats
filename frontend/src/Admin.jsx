// src/pages/Admin.jsx
import React, { useState, useRef, useEffect } from "react";
// (Optional) remove if unused
// import Card from "./Card";
// import ConnectButton from "./ConnectButton";
import HLOpenOrder from "./HLOpenOrder";
import SwapUniswap from "./swapUniswap";
import BridgeLiFi from "./bridgeLiFi";
import DriftControls from "./driftControls";
import "./AdminLayout.css";

export default function Admin() {
  // loaders
  const [loadingHL, setLoadingHL] = useState(false);
  const [loadingDriftPos, setLoadingDriftPos] = useState(false);

  // outputs
  const [hlOutput, setHlOutput] = useState("");
  const [driftOutput, setDriftOutput] = useState("");

  // messages
  const [msgHL, setMsgHL] = useState(null);
  const [msgDrift, setMsgDrift] = useState(null);

  // output visibility (collapsible)
  const [showHLOut, setShowHLOut] = useState(false);
  const [showDriftOut, setShowDriftOut] = useState(false);

  // local testnet
  const API = import.meta.env.VITE_ADMIN_API_URL || "http://localhost:4000";
  //Mainnet
  //const API = import.meta.env.ARBITRUM_ALCHEMY_MAINNET;
  const timers = useRef([]);

  // util: auto-clear a message after 6s
  const autoClear = (setter, val) => {
    setter(val);
    const t = setTimeout(() => setter(null), 6000);
    timers.current.push(t);
  };

  // util: auto-hide an output after 6s
  const autoHide = (setter) => {
    const t = setTimeout(() => setter(false), 6000);
    timers.current.push(t);
  };

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // === Hyperliquid positions ===
  // --- Hyperliquid ---
  async function getPositionHL() {
    if (loadingHL) return;
    setLoadingHL(true);
    setMsgHL(null);
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

      let pretty = data.output || "";
      try {
        pretty = JSON.stringify(JSON.parse(pretty), null, 2);
      } catch {}
      setHlOutput(pretty);
      setShowHLOut(true); // 👈 open panel
      setTimeout(() => setShowHLOut(false), 6000); // optional auto-close
      autoClear(setMsgHL, { type: "ok", text: "HL positions fetched." });
    } catch (e) {
      autoClear(setMsgHL, { type: "err", text: e.message || String(e) });
    } finally {
      setLoadingHL(false);
    }
  }

  // --- Drift ---
  async function getPositionDrift() {
    if (loadingDriftPos) return;
    setLoadingDriftPos(true);
    setMsgDrift(null);
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

      let pretty = (data.output || "").trim();
      try {
        pretty = JSON.stringify(JSON.parse(pretty), null, 2);
      } catch {}
      setDriftOutput(pretty);
      setShowDriftOut(true); // 👈 open panel
      setTimeout(() => setShowDriftOut(false), 6000); // optional auto-close
      autoClear(setMsgDrift, { type: "ok", text: "Drift positions fetched." });
    } catch (e) {
      autoClear(setMsgDrift, { type: "err", text: e.message || String(e) });
    } finally {
      setLoadingDriftPos(false);
    }
  }

  return (
    <div className="admin-wrap">
      <div className="admin-grid">
        {/* LEFT SIDEBAR */}
        <aside className="card sidebar">
          <div className="section-title">Algostrats — Admin</div>
          <p className="muted">Quick server reads</p>

          <div className="actions">
            {/* Drift positions */}
            <button
              className="btn"
              onClick={getPositionDrift}
              disabled={loadingDriftPos}
            >
              {loadingDriftPos ? "Running…" : "Get Drift Positions (server)"}
            </button>
            {msgDrift && (
              <p
                className="muted"
                style={{ color: msgDrift.type === "ok" ? "green" : "crimson" }}
              >
                {msgDrift.text}
              </p>
            )}
            {(showDriftOut || driftOutput !== "") && (
              <details
                open={showDriftOut}
                onToggle={(e) => setShowDriftOut(e.currentTarget.open)}
                className="details"
              >
                <summary>Drift output</summary>
                <pre className="output">
                  {driftOutput ||
                    "No output captured (stdout was empty). Check server logs."}
                </pre>
                <div className="btn-row" style={{ marginTop: 6 }}>
                  <button
                    className="btn-link"
                    onClick={() => setShowDriftOut(false)}
                  >
                    Hide now
                  </button>
                  <button
                    className="btn-link"
                    onClick={() => setDriftOutput("")}
                  >
                    Clear
                  </button>
                </div>
              </details>
            )}

            {/* Hyperliquid positions */}
            <button
              className="btn"
              onClick={getPositionHL}
              disabled={loadingHL}
            >
              {loadingHL ? "Running…" : "Get HL Positions (server)"}
            </button>
            {msgHL && (
              <p
                className="muted"
                style={{ color: msgHL.type === "ok" ? "green" : "crimson" }}
              >
                {msgHL.text}
              </p>
            )}
            {(showHLOut || hlOutput !== "") && (
              <details
                open={showHLOut}
                onToggle={(e) => setShowHLOut(e.currentTarget.open)}
                className="details"
              >
                <summary>Hyperliquid output</summary>
                <pre className="output">
                  {hlOutput || "No output captured (stdout was empty)."}
                </pre>
                <div className="btn-row" style={{ marginTop: 6 }}>
                  <button
                    className="btn-link"
                    onClick={() => setShowHLOut(false)}
                  >
                    Hide now
                  </button>
                  <button className="btn-link" onClick={() => setHlOutput("")}>
                    Clear
                  </button>
                </div>
              </details>
            )}
          </div>
        </aside>

        {/* RIGHT MAIN CONTENT */}
        <main>
          <div className="main-grid">
            {/* Row 1: Swap & Bridge */}
            <div className="row">
              <section className="card">
                <div className="section-title">Swap WBTC → USDC (server)</div>
                <SwapUniswap apiBase={API} />
              </section>

              <section className="card">
                <div className="section-title">Bridge (Li.Fi, server)</div>
                <BridgeLiFi apiBase={API} />
              </section>
            </div>

            {/* Row 2: Hyperliquid & Drift */}
            <div className="row">
              <section className="card">
                <div className="section-title">Hyperliquid — Open / Close</div>
                <HLOpenOrder apiBase={API} />
              </section>

              <section className="card">
                <div className="section-title">Drift (server)</div>
                <DriftControls apiBase={API} />
              </section>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
