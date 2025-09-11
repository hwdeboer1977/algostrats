import React, { useState, useRef, useEffect } from "react";

export default function HLOpenOrder() {
  const [coin, setCoin] = useState("ETH");
  const [side, setSide] = useState("buy");
  const [size, setSize] = useState("0.025");
  const [slippage, setSlippage] = useState("0.01");
  const [leverage, setLeverage] = useState("10");
  const [margin, setMargin] = useState("cross");

  const [loadingOpen, setLoadingOpen] = useState(false);
  const [loadingClose, setLoadingClose] = useState(false);
  const [result, setResult] = useState(null);

  // controls whether the details is expanded
  const [showResult, setShowResult] = useState(false);
  const hideTimer = useRef(null);

  const API = import.meta.env.VITE_ADMIN_API_URL || "http://localhost:4000";

  // clear timer on unmount
  useEffect(
    () => () => hideTimer.current && clearTimeout(hideTimer.current),
    []
  );

  function revealThenAutoHide() {
    setShowResult(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowResult(false), 6000);
  }

  async function handleOpen() {
    if (loadingOpen) return;
    setLoadingOpen(true);
    setResult(null);
    try {
      const res = await fetch(`${API}/api/hl-command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "open",
          params: { coin, side, size, slippage, leverage, margin },
        }),
      });
      const data = await res.json();
      setResult(data);
      revealThenAutoHide();
    } catch (e) {
      setResult({ ok: false, error: e.message || "Request failed" });
      revealThenAutoHide();
    } finally {
      setLoadingOpen(false);
    }
  }

  async function handleClose() {
    if (loadingClose) return;
    setLoadingClose(true);
    setResult(null);
    try {
      const res = await fetch(`${API}/api/hl-command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "close",
          params: { coin },
        }),
      });
      const data = await res.json();
      setResult(data);
      revealThenAutoHide();
    } catch (e) {
      setResult({ ok: false, error: e.message || "Request failed" });
      revealThenAutoHide();
    } finally {
      setLoadingClose(false);
    }
  }
  return (
    <>
      {/* Coin */}
      <div className="field">
        <label htmlFor="coin">Coin</label>
        <input
          id="coin"
          placeholder="ETH"
          value={coin}
          onChange={(e) => setCoin(e.target.value.toUpperCase())}
        />
      </div>

      {/* Side */}
      <div className="field">
        <label>Side</label>
        <div>
          <div className="segmented">
            <button
              type="button"
              aria-pressed={side === "buy"}
              onClick={() => setSide("buy")}
              className={`seg-btn ${side === "buy" ? "active buy" : ""}`}
            >
              Buy
            </button>
            <button
              type="button"
              aria-pressed={side === "sell"}
              onClick={() => setSide("sell")}
              className={`seg-btn ${side === "sell" ? "active sell" : ""}`}
            >
              Sell
            </button>
          </div>
          <div className="muted" style={{ marginTop: 6 }}>
            Currently selected:{" "}
            <span className={`badge ${side === "buy" ? "buy" : "sell"}`}>
              {side.toUpperCase()}
            </span>
          </div>
        </div>
      </div>

      {/* Size */}
      <div className="field">
        <label htmlFor="size">Size</label>
        <input
          id="size"
          type="number"
          min="0"
          step="0.0001"
          placeholder="0.025"
          value={size}
          onChange={(e) => setSize(e.target.value)}
        />
      </div>

      {/* Slippage */}
      <div className="field">
        <label htmlFor="slippage">Slippage</label>
        <input
          id="slippage"
          type="number"
          min="0"
          step="0.0001"
          placeholder="0.01"
          value={slippage}
          onChange={(e) => setSlippage(e.target.value)}
        />
      </div>

      {/* Leverage */}
      <div className="field">
        <label htmlFor="leverage">Leverage</label>
        <input
          id="leverage"
          type="number"
          min="1"
          step="1"
          placeholder="10"
          value={leverage}
          onChange={(e) => setLeverage(e.target.value)}
        />
      </div>

      {/* Margin */}
      <div className="field">
        <label>Margin</label>
        <div className="radio-row">
          <label className="radio">
            <input
              type="radio"
              name="margin"
              value="cross"
              checked={margin === "cross"}
              onChange={() => setMargin("cross")}
            />
            <span>Cross</span>
          </label>
          <label className="radio">
            <input
              type="radio"
              name="margin"
              value="isolated"
              checked={margin === "isolated"}
              onChange={() => setMargin("isolated")}
            />
            <span>Isolated</span>
          </label>
        </div>
      </div>

      {/* Actions */}
      <div className="btn-row">
        <button className="btn" onClick={handleOpen} disabled={loadingOpen}>
          {loadingOpen ? "Opening..." : "Open Position"}
        </button>
        <button className="btn" onClick={handleClose} disabled={loadingClose}>
          {loadingClose ? "Closing..." : "Close Position"}
        </button>
      </div>

      {/* Result (auto-hide after 6s, still toggle-able) */}
      {result && (
        <details
          open={showResult}
          onToggle={(e) => setShowResult(e.currentTarget.open)}
          className="details"
        >
          <summary className="summary">
            {result.ok ? "Success" : "Error"}
          </summary>

          <div className={`notice ${result.ok ? "notice-ok" : "notice-err"}`}>
            {result.output && <pre className="mono">{result.output}</pre>}
            {result.error && <pre className="mono">{result.error}</pre>}

            <div className="btn-row" style={{ marginTop: 6 }}>
              <button
                type="button"
                className="btn-link"
                onClick={() => setShowResult(false)}
              >
                Hide now
              </button>
            </div>
          </div>
        </details>
      )}
    </>
  );
}
