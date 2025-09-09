// backend/server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { spawn } = require("child_process");
const path = require("path");

const app = express();
app.use(express.json());
app.use(cors({ origin: "*" }));

// 1) EXACT keys used by routes below
const SCRIPTS = {
  "swap-wbtc-usdc": path.resolve(
    "C:/Users/hwdeb/Documents/blockstat_solutions_github/Algostrats/tools/swap/swap_wbtc_to_usdc.cjs"
  ),
  "hl-get-pos": path.resolve(
    "C:/Users/hwdeb/Documents/blockstat_solutions_github/Algostrats/tools/hyperliquid/create_orders.py"
  ),
  "drift-get-pos": path.resolve(
    "C:/Users/hwdeb/Documents/blockstat_solutions_github/Algostrats/tools/drift/read_position_info.mjs"
  ),
  "drift-command": path.resolve(
    "C:/Users/hwdeb/Documents/blockstat_solutions_github/Algostrats/tools/drift/testDriftService.mjs"
  ),
};

// 2) Runner picks interpreter based on extension
function runScript(scriptKey, argv = []) {
  const file = SCRIPTS[scriptKey];
  if (!file) {
    return Promise.resolve({
      ok: false,
      error: `Unknown script key: ${scriptKey}. Known: ${Object.keys(
        SCRIPTS
      ).join(", ")}`,
    });
  }
  const ext = path.extname(file).toLowerCase();
  // Command for python scripts
  const cmd =
    ext === ".py"
      ? process.platform === "win32"
        ? "py"
        : "python3"
      : process.execPath;

  return new Promise((resolve) => {
    const child = spawn(cmd, [file, ...argv], {
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let out = "",
      err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) =>
      resolve({ ok: false, error: `Spawn error: ${e.message}` })
    );
    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        code,
        output: out.trim(),
        error: code === 0 ? null : err || out || `exit ${code}`,
      });
    });
  });
}

// 3) Health + debug
app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.get("/api/debug/scripts", (_req, res) =>
  res.json({ ok: true, scripts: SCRIPTS })
);

// 4) Routes for swap, Hyperliquid, Drift, Bridge
app.post("/api/swap/wbtc-usdc", async (req, res) => {
  const r = await runScript("swap-wbtc-usdc", []);
  res.status(r.ok ? 200 : 500).json(r);
});

app.post("/api/hl/get-pos-HL", async (req, res) => {
  const r = await runScript("hl-get-pos", []);
  res.status(r.ok ? 200 : 500).json(r);
});

app.post("/api/drift/get-pos-drift", async (req, res) => {
  const r = await runScript("drift-get-pos", []);
  res.status(r.ok ? 200 : 500).json(r);
});

app.post("/api/drift/deposit-drift", async (req, res) => {
  const { amount } = req.body || {};
  const r = await runScript("drift-command", ["deposit", String(amount || 1)]);
  res.status(r.ok ? 200 : 500).json(r);
});

// 404 JSON
app.use((_req, res) => res.status(404).json({ ok: false, error: "Not found" }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`API on :${PORT}`));
