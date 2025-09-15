// backend/server.js
//require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const app = express();
app.use(express.json());
app.use(cors({ origin: "*" }));

// 1) EXACT keys used by routes below
const SCRIPTS = {
  "swap-wbtc-usdc": path.resolve(
    "C:/Users/hwdeb/Documents/blockstat_solutions_github/Algostrats/tools/swap/swap_wbtc_to_usdc.cjs"
  ),
  // add others here…
  "bridge-lifi": path.resolve(
    "C:/Users/hwdeb/Documents/blockstat_solutions_github/Algostrats/tools/bridge/lifi_bridge_sol.cjs"
  ),
  "hl-get-pos": path.resolve(
    "C:/Users/hwdeb/Documents/blockstat_solutions_github/Algostrats/tools/hyperliquid/create_orders.py"
  ),
  "drift-get-pos": path.resolve(
    "C:/Users/hwdeb/Documents/blockstat_solutions_github/Algostrats/tools/drift/read_position_info.mjs"
  ),
  "drift-command": path.resolve(
    "C:/Users/hwdeb/Documents/blockstat_solutions_github/Algostrats/tools/drift/vaultNew.mjs"
  ),
  "hl-command": path.resolve(
    "C:/Users/hwdeb/Documents/blockstat_solutions_github/Algostrats/tools/hyperliquid/create_orders.py"
  ),
};

// 2) Runner picks interpreter based on extension
// robust runner
function runScript(scriptKey, argv = [], envAdd = {}) {
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
  const isPy = ext === ".py";

  // pick interpreter
  let cmd;
  if (isPy) {
    cmd = process.platform === "win32" ? "py" : "python3";
  } else {
    // prefer the *current* node binary if it exists
    cmd =
      (process.execPath &&
        fs.existsSync(process.execPath) &&
        process.execPath) ||
      "node";
  }

  const args = [file, ...argv];

  // verify cwd
  const desiredCwd = path.dirname(file);
  const cwdExists = fs.existsSync(desiredCwd);
  const cwd = cwdExists ? desiredCwd : undefined;

  // on Windows, let the shell resolve "node"/"py"
  const useShell =
    process.platform === "win32" && (cmd === "node" || cmd === "py");

  console.log(
    `[runScript] cmd=${cmd} args=${JSON.stringify(args)} cwd=${
      cwd || "<default>"
    } shell=${useShell}`
  );

  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: useShell,
      env: { ...process.env, ...envAdd }, // <- WALLET_SECRET override lives here
    });

    let out = "",
      err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) =>
      resolve({ ok: false, error: `Spawn error: ${e.message}` })
    );
    child.on("close", (code) =>
      resolve({
        ok: code === 0,
        code,
        output: out.trim(),
        error: code === 0 ? null : err || out || `exit ${code}`,
      })
    );
  });
}

// Helper to build key=value args for HL
function buildArgs(action, params = {}) {
  switch (action) {
    case "summary":
      return ["summary"];

    case "open": {
      const { coin, side, size, slippage, leverage, margin, strict } = params;
      if (!coin || !side || !size) {
        throw new Error("Missing required params for open: coin, side, size");
      }
      return [
        "open",
        `coin=${coin}`,
        `side=${side}`,
        `size=${size}`,
        slippage != null ? `slippage=${slippage}` : null, // alias for slippage_frac
        leverage != null ? `leverage=${leverage}` : null,
        margin != null ? `margin=${margin}` : null, // alias for margin_mode
        strict != null ? `strict=${strict}` : null, // "true"/"false"
      ].filter(Boolean);
    }

    case "close": {
      const { coin } = params;
      if (!coin) throw new Error("Missing coin for close");
      return ["close", `coin=${coin}`];
    }

    case "cancel": {
      const { coin } = params;
      if (!coin) throw new Error("Missing coin for cancel");
      return ["cancel", `coin=${coin}`];
    }

    default:
      throw new Error(`Unsupported HL action: ${action}`);
  }
}

// 3) Health + debug
app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.get("/api/debug/scripts", (_req, res) =>
  res.json({ ok: true, scripts: SCRIPTS })
);

// 4) Routes for swap, Hyperliquid, Drift, Bridge

// SWAP (server signs with Owner / A / B by injecting WALLET_SECRET)
app.post("/api/swap/wbtc-usdc", async (req, res) => {
  try {
    const { amountIn, wallet } = req.body || {};

    if (amountIn !== undefined && isNaN(Number(amountIn))) {
      return res
        .status(400)
        .json({ ok: false, error: "amountIn must be numeric" });
    }
    const allowed = new Set(["owner", "A", "B"]);
    if (!allowed.has(wallet)) {
      return res
        .status(400)
        .json({ ok: false, error: "wallet must be 'owner' | 'A' | 'B'" });
    }

    const PK_MAP = {
      owner: process.env.PK_OWNER,
      A: process.env.PK_RECIPIENT_A,
      B: process.env.PK_RECIPIENT_B,
    };
    const pk = PK_MAP[wallet];
    if (!pk)
      return res
        .status(500)
        .json({ ok: false, error: `Missing PK for wallet ${wallet}` });

    const argv = amountIn !== undefined ? [String(amountIn)] : [];

    // inject the correct key so swap_wbtc_to_usdc.cjs uses it
    const r = await runScript("swap-wbtc-usdc", argv, { WALLET_SECRET: pk });

    return res.status(r.ok ? 200 : 500).json(r);
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: e.message || "swap route error" });
  }
});

// BRIDGE (forwards amountIn to lifi_bridge_sol.cjs)
app.post("/api/bridge/bridge-lifi", async (req, res) => {
  try {
    const { amountIn } = req.body || {};
    if (amountIn !== undefined && isNaN(Number(amountIn))) {
      return res.status(400).json({
        ok: false,
        error: "amountIn must be numeric (string or number)",
      });
    }
    const argv = amountIn !== undefined ? [String(amountIn)] : [];
    const r = await runScript("bridge-lifi", argv);
    return res.status(r.ok ? 200 : 500).json(r);
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: e.message || "bridge route error" });
  }
});

app.post("/api/drift/get-pos-drift", async (req, res) => {
  const r = await runScript("drift-get-pos", []);
  res.status(r.ok ? 200 : 500).json(r);
});

// Replace your existing deposit route with this:
app.post("/api/drift/deposit-drift", async (req, res) => {
  try {
    const { amount } = req.body || {};
    const argv = ["deposit"];
    if (amount !== undefined && amount !== "") {
      if (isNaN(Number(amount))) {
        return res
          .status(400)
          .json({ ok: false, error: "'amount' must be numeric" });
      }
      argv.push("--amount", String(amount));
    }
    const r = await runScript("drift-command", argv);
    res.status(r.ok ? 200 : 500).json({ ...r, argv });
  } catch (e) {
    res
      .status(500)
      .json({ ok: false, error: e.message || "deposit route error" });
  }
});

// NEW: request-withdraw (matches your frontend /api/drift/withdraw)
app.post("/api/drift/withdraw", async (req, res) => {
  try {
    const { amount } = req.body || {};
    const argv = ["request-withdraw"];
    if (amount !== undefined && amount !== "") {
      if (isNaN(Number(amount))) {
        return res
          .status(400)
          .json({ ok: false, error: "'amount' must be numeric" });
      }
      argv.push("--amount", String(amount));
    }
    const r = await runScript("drift-command", argv);
    res.status(r.ok ? 200 : 500).json({ ...r, argv });
  } catch (e) {
    res
      .status(500)
      .json({ ok: false, error: e.message || "request-withdraw route error" });
  }
});

// NEW: finalize withdraw (matches your frontend /api/drift/finalize)
// No amount needed; vaultNew.mjs will auto-derive the VaultDepositor PDA.
app.post("/api/drift/finalize", async (_req, res) => {
  try {
    const r = await runScript("drift-command", ["withdraw"]);
    res.status(r.ok ? 200 : 500).json({ ...r, argv: ["withdraw"] });
  } catch (e) {
    res
      .status(500)
      .json({ ok: false, error: e.message || "finalize route error" });
  }
});

// POST /api/hl
// body: { action: "summary" | "open" | "close" | "cancel", params?: {...} }
app.post("/api/hl-command", async (req, res) => {
  try {
    const { action, params = {} } = req.body || {};
    if (!action)
      return res.status(400).json({ ok: false, error: "Missing 'action'." });

    const argv = buildArgs(action, params);
    const r = await runScript("hl-command", argv);

    // Helpful: echo back the argv we actually ran
    res.status(r.ok ? 200 : 500).json({ ...r, argv });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || "HL route error" });
  }
});

// 404 JSON
app.use((_req, res) => res.status(404).json({ ok: false, error: "Not found" }));

// const PORT = process.env.PORT || 4000;
const PORT = 4000;
app.listen(PORT, () => console.log(`API on :${PORT}`));
