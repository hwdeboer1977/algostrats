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
    <div className="w-full max-w-xl rounded-2xl border p-6 shadow-sm">
      <h2 className="text-xl font-semibold mb-4">Hyperliquid — Open / Close</h2>

      {/* Coin */}
      <label className="block mb-3">
        <span className="text-sm text-gray-600">Coin</span>
        <input
          className="mt-1 w-full rounded-lg border px-3 py-2"
          placeholder="ETH"
          value={coin}
          onChange={(e) => setCoin(e.target.value.toUpperCase())}
        />
      </label>

      {/* Side */}
      <div className="mb-3">
        <span className="block text-sm text-gray-600 mb-1">Side</span>
        <div className="inline-flex rounded-lg border">
          <button
            type="button"
            aria-pressed={side === "buy"}
            onClick={() => setSide("buy")}
            className={[
              "px-4 py-2 font-medium transition-colors rounded-l-lg",
              side === "buy"
                ? "bg-green-600 text-white"
                : "bg-white text-green-700 hover:bg-green-50",
            ].join(" ")}
          >
            Buy
          </button>
          <button
            type="button"
            aria-pressed={side === "sell"}
            onClick={() => setSide("sell")}
            className={[
              "px-4 py-2 font-medium transition-colors border-l rounded-r-lg",
              side === "sell"
                ? "bg-red-600 text-white"
                : "bg-white text-red-700 hover:bg-red-50",
            ].join(" ")}
          >
            Sell
          </button>
        </div>
        <div className="mt-2 text-sm">
          Currently selected:{" "}
          <span
            className={
              side === "buy"
                ? "text-green-600 font-semibold"
                : "text-red-600 font-semibold"
            }
          >
            {side.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Size */}
      <label className="block mb-3">
        <span className="text-sm text-gray-600">Size</span>
        <input
          type="number"
          min="0"
          step="0.0001"
          className="mt-1 w-full rounded-lg border px-3 py-2"
          placeholder="0.025"
          value={size}
          onChange={(e) => setSize(e.target.value)}
        />
      </label>

      {/* Slippage */}
      <label className="block mb-3">
        <span className="text-sm text-gray-600">Slippage</span>
        <input
          type="number"
          min="0"
          step="0.0001"
          className="mt-1 w-full rounded-lg border px-3 py-2"
          placeholder="0.01"
          value={slippage}
          onChange={(e) => setSlippage(e.target.value)}
        />
      </label>

      {/* Leverage */}
      <label className="block mb-3">
        <span className="text-sm text-gray-600">Leverage</span>
        <input
          type="number"
          min="1"
          step="1"
          className="mt-1 w-full rounded-lg border px-3 py-2"
          placeholder="10"
          value={leverage}
          onChange={(e) => setLeverage(e.target.value)}
        />
      </label>

      {/* Margin */}
      <div className="mb-4">
        <span className="block text-sm text-gray-600 mb-1">Margin</span>
        <div className="flex gap-3">
          <label className="inline-flex items-center gap-2">
            <input
              type="radio"
              name="margin"
              value="cross"
              checked={margin === "cross"}
              onChange={() => setMargin("cross")}
            />
            <span>Cross</span>
          </label>
          <label className="inline-flex items-center gap-2">
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

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={handleOpen}
          disabled={loadingOpen}
          className="rounded-xl px-4 py-2 font-medium bg-black text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {loadingOpen ? "Opening..." : "Open Position"}
        </button>
        <button
          onClick={handleClose}
          disabled={loadingClose}
          className="rounded-xl px-4 py-2 font-medium bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {loadingClose ? "Closing..." : "Close Position"}
        </button>
      </div>

      {/* Result: auto-hide after 6s, but user can reopen via <details> */}
      {result && (
        <details
          open={showResult}
          onToggle={(e) => setShowResult(e.currentTarget.open)}
          className="mt-4"
        >
          <summary className="cursor-pointer select-none">
            {result.ok ? "Success" : "Error"}
          </summary>

          <div
            className={[
              "mt-2 rounded-lg border p-3",
              result.ok
                ? "border-green-300 bg-green-50"
                : "border-red-300 bg-red-50",
            ].join(" ")}
          >
            {result.output && (
              <pre className="whitespace-pre-wrap text-sm text-gray-800">
                {result.output}
              </pre>
            )}
            {result.error && (
              <pre className="whitespace-pre-wrap text-sm text-gray-800">
                {result.error}
              </pre>
            )}

            {/* Optional: a manual hide button */}
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowResult(false)}
                className="text-sm underline"
              >
                Hide now
              </button>
            </div>
          </div>
        </details>
      )}
    </div>
  );
}
