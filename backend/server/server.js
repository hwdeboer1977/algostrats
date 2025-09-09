// backend/server.cjs
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { spawn } = require("child_process");
const path = require("path");

const app = express();
app.use(express.json());
app.use(cors({ origin: "*" }));

const SCRIPTS = {
  "swap-wbtc-usdc": path.resolve(
    "C:/Users/hwdeb/Documents/blockstat_solutions_github/Algostrats/tools/swap/swap_wbtc_to_usdc.cjs"
  ),
};

function runScript(scriptKey, argv = []) {
  return new Promise((resolve) => {
    const file = SCRIPTS[scriptKey];
    if (!file) return resolve({ ok: false, error: "Unknown script key" });

    const child = spawn(process.execPath, [file, ...argv], {
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => {
      resolve({ ok: false, error: `Spawn error: ${e.message}` });
    });
    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        code,
        output: out,
        error: code === 0 ? null : err || out || `exit ${code}`,
      });
    });
  });
}

// health
app.get("/api/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

// swap route
app.post("/api/swap/wbtc-usdc", async (req, res) => {
  try {
    const { amountIn, recipient, slippageBps } = req.body || {};
    const args = [];
    if (amountIn) args.push(String(amountIn));
    if (recipient) args.push(String(recipient));
    if (slippageBps) args.push(String(slippageBps));

    const r = await runScript("swap-wbtc-usdc", args);
    if (!r.ok) return res.status(500).json(r);
    res.json(r);
  } catch (e) {
    console.error("Route error:", e);
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

// 404 JSON fallback
app.use((_req, res) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`API running on :${PORT}`));
