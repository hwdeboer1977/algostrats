// backend/server/server.js
require("dotenv").config({
  path: require("path").resolve(__dirname, "../../.env"),
});

const express = require("express");
const cors = require("cors");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const { makeLogger } = require("./logger");
const logger = makeLogger("server");

const app = express();
app.use(express.json());
app.use(cors({ origin: "*" }));

// ----------------------------
// Script registry (portable)
// ----------------------------
const SCRIPTS = {
  "swap-wbtc-usdc": path.resolve(
    __dirname,
    "../../tools/swap/swap_wbtc_to_usdc.cjs"
  ),
  "bridge-lifi": path.resolve(
    __dirname,
    "../../tools/bridge/lifi_bridge_sol.cjs"
  ),
  "hl-command": path.resolve(
    __dirname,
    "../../tools/hyperliquid/create_orders.py"
  ),
  "hl-get-pos": path.resolve(
    __dirname,
    "../../tools/hyperliquid/create_orders.py"
  ),
  "drift-get-pos": path.resolve(
    __dirname,
    "../../tools/drift/read_position_info.mjs"
  ),
  "drift-command": path.resolve(__dirname, "../../tools/drift/vaultNew.mjs"),
};

// ----------------------------
// Redaction + request logging
// ----------------------------
const SENSITIVE_KEYS = new Set([
  "pk",
  "privateKey",
  "wallet_secret",
  "walletsecret",
  "seed",
  "mnemonic",
  "secret",
  "apiKey",
  "apikey",
  "WALLET_SECRET",
  "PK_OWNER",
  "PK_RECIPIENT_A",
  "PK_RECIPIENT_B",
  "SOLANA_KEYPAIR",
  "WALLET_SOLANA_SECRET",
]);

function redact(val, keyHint = "") {
  if (val == null) return val;
  if (typeof val === "string") {
    if (keyHint && SENSITIVE_KEYS.has(keyHint)) return "***";
    if (/^(0x)?[a-f0-9]{32,}$/i.test(val))
      return val.slice(0, 6) + "…" + val.slice(-4);
    return val;
  }
  if (Array.isArray(val)) return val.map((v) => redact(v));
  if (typeof val === "object") {
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = SENSITIVE_KEYS.has(k) ? "***" : redact(v, k);
    }
    return out;
  }
  return val;
}

// attach a request id + log request/response
app.use((req, res, next) => {
  const rid = crypto.randomUUID();
  req.rid = rid;
  const startedAt = process.hrtime.bigint();
  const { method } = req;
  const url = req.originalUrl || req.url;
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

  logger.info("api.request", {
    rid,
    method,
    url,
    ip,
    params: redact(req.params),
    query: redact(req.query),
    body: redact(req.body),
  });

  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
    logger.info("api.response", {
      rid,
      method,
      url,
      status: res.statusCode,
      duration_ms: Math.round(ms),
      length: Number(res.getHeader("content-length") || 0),
    });
  });
  next();
});

// ----------------------------
// Runner (logs spawns)
// ----------------------------
function runScript(scriptKey, argv = [], envAdd = {}, ctx = {}) {
  const file = SCRIPTS[scriptKey];
  if (!file) {
    logger.error("spawn.unknown_script", { ...ctx, scriptKey });
    return Promise.resolve({
      ok: false,
      error: `Unknown script key: ${scriptKey}. Known: ${Object.keys(
        SCRIPTS
      ).join(", ")}`,
    });
  }

  const ext = path.extname(file).toLowerCase();
  const isPy = ext === ".py";

  let cmd;
  if (isPy) {
    cmd = process.platform === "win32" ? "py" : "python3";
  } else {
    cmd =
      (process.execPath &&
        fs.existsSync(process.execPath) &&
        process.execPath) ||
      "node";
  }

  const args = [file, ...argv];
  const desiredCwd = path.dirname(file);
  const cwd = fs.existsSync(desiredCwd) ? desiredCwd : undefined;
  const shell =
    process.platform === "win32" && (cmd === "node" || cmd === "py");

  const envKeys = Object.keys(envAdd || {});
  logger.info("spawn.start", { ...ctx, scriptKey, cmd, args, cwd, envKeys });

  const t0 = Date.now();
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell,
      env: { ...process.env, ...envAdd },
    });

    let out = "",
      err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => {
      logger.error("spawn.error", { ...ctx, scriptKey, error: e.message });
      resolve({ ok: false, error: `Spawn error: ${e.message}` });
    });
    child.on("close", (code) => {
      const ms = Date.now() - t0;
      const ok = code === 0;
      logger[ok ? "info" : "error"]("spawn.done", {
        ...ctx,
        scriptKey,
        code,
        duration_ms: ms,
      });
      resolve({
        ok,
        code,
        output: out.trim(),
        error: ok ? null : err || out || `exit ${code}`,
      });
    });
  });
}

// ----------------------------
// HL argv builder
// ----------------------------
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
        slippage != null ? `slippage=${slippage}` : null,
        leverage != null ? `leverage=${leverage}` : null,
        margin != null ? `margin=${margin}` : null,
        strict != null ? `strict=${strict}` : null,
      ].filter(Boolean);
    }
    case "close":
      if (!params.coin) throw new Error("Missing coin for close");
      return ["close", `coin=${params.coin}`];
    case "cancel":
      if (!params.coin) throw new Error("Missing coin for cancel");
      return ["cancel", `coin=${params.coin}`];
    default:
      throw new Error(`Unsupported HL action: ${action}`);
  }
}

// ----------------------------
// Health & debug
// ----------------------------
app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.get("/api/debug/scripts", (_req, res) =>
  res.json({ ok: true, scripts: SCRIPTS })
);

// ----------------------------
// Routes
// ----------------------------

// SWAP (inject WALLET_SECRET for owner / A / B)
app.post("/api/swap/wbtc-usdc", async (req, res) => {
  const { amountIn, wallet } = req.body || {};
  const ctx = { rid: req.rid, route: "swap-wbtc-usdc", wallet, amountIn };

  try {
    if (amountIn !== undefined && isNaN(Number(amountIn))) {
      logger.warn("route.swap.invalid_amount", ctx);
      return res
        .status(400)
        .json({ ok: false, error: "amountIn must be numeric" });
    }
    const allowed = new Set(["owner", "A", "B"]);
    if (!allowed.has(wallet)) {
      logger.warn("route.swap.invalid_wallet", ctx);
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
    if (!pk) {
      logger.error("route.swap.missing_pk", ctx);
      return res
        .status(500)
        .json({ ok: false, error: `Missing PK for wallet ${wallet}` });
    }

    const argv = amountIn !== undefined ? [String(amountIn)] : [];
    const r = await runScript(
      "swap-wbtc-usdc",
      argv,
      { WALLET_SECRET: pk },
      ctx
    );

    if (!r.ok)
      logger.error("route.swap.failed", {
        ...ctx,
        code: r.code,
        error: r.error?.slice(0, 500),
      });
    else logger.info("route.swap.ok", { ...ctx, code: r.code });

    return res.status(r.ok ? 200 : 500).json(r);
  } catch (e) {
    logger.error("route.swap.exception", { ...ctx, error: e.message });
    return res
      .status(500)
      .json({ ok: false, error: e.message || "swap route error" });
  }
});

// BRIDGE (forwards amount to lifi script)
app.post("/api/bridge/bridge-lifi", async (req, res) => {
  const { amountIn } = req.body || {};
  const ctx = { rid: req.rid, route: "bridge-lifi", amountIn };

  try {
    if (amountIn !== undefined && isNaN(Number(amountIn))) {
      logger.warn("route.bridge.invalid_amount", ctx);
      return res
        .status(400)
        .json({ ok: false, error: "amountIn must be numeric" });
    }
    const argv = amountIn !== undefined ? [String(amountIn)] : [];
    const r = await runScript("bridge-lifi", argv, {}, ctx);

    if (!r.ok)
      logger.error("route.bridge.failed", {
        ...ctx,
        code: r.code,
        error: r.error?.slice(0, 500),
      });
    else logger.info("route.bridge.ok", { ...ctx, code: r.code });

    return res.status(r.ok ? 200 : 500).json(r);
  } catch (e) {
    logger.error("route.bridge.exception", { ...ctx, error: e.message });
    return res
      .status(500)
      .json({ ok: false, error: e.message || "bridge route error" });
  }
});

app.post("/api/drift/get-pos-drift", async (req, res) => {
  const ctx = { rid: req.rid, route: "drift-get-pos" };
  const r = await runScript("drift-get-pos", [], {}, ctx);
  res.status(r.ok ? 200 : 500).json(r);
});

// deposit to Drift vault
app.post("/api/drift/deposit-drift", async (req, res) => {
  const { amount } = req.body || {};
  const ctx = { rid: req.rid, route: "drift:deposit", amount };

  try {
    const argv = ["deposit"];
    if (amount !== undefined && amount !== "") {
      if (isNaN(Number(amount))) {
        logger.warn("route.drift.deposit.invalid_amount", ctx);
        return res
          .status(400)
          .json({ ok: false, error: "'amount' must be numeric" });
      }
      argv.push("--amount", String(amount));
    }
    const r = await runScript("drift-command", argv, {}, ctx);

    if (!r.ok)
      logger.error("route.drift.deposit.failed", {
        ...ctx,
        code: r.code,
        error: r.error?.slice(0, 500),
      });
    else logger.info("route.drift.deposit.ok", { ...ctx, code: r.code });

    res.status(r.ok ? 200 : 500).json({ ...r, argv });
  } catch (e) {
    logger.error("route.drift.deposit.exception", { ...ctx, error: e.message });
    res
      .status(500)
      .json({ ok: false, error: e.message || "deposit route error" });
  }
});

// request-withdraw from Drift
app.post("/api/drift/withdraw", async (req, res) => {
  const { amount } = req.body || {};
  const ctx = { rid: req.rid, route: "drift:request-withdraw", amount };

  try {
    const argv = ["request-withdraw"];
    if (amount !== undefined && amount !== "") {
      if (isNaN(Number(amount))) {
        logger.warn("route.drift.withdraw.invalid_amount", ctx);
        return res
          .status(400)
          .json({ ok: false, error: "'amount' must be numeric" });
      }
      argv.push("--amount", String(amount));
    }
    const r = await runScript("drift-command", argv, {}, ctx);

    if (!r.ok)
      logger.error("route.drift.withdraw.failed", {
        ...ctx,
        code: r.code,
        error: r.error?.slice(0, 500),
      });
    else logger.info("route.drift.withdraw.ok", { ...ctx, code: r.code });

    res.status(r.ok ? 200 : 500).json({ ...r, argv });
  } catch (e) {
    logger.error("route.drift.withdraw.exception", {
      ...ctx,
      error: e.message,
    });
    res
      .status(500)
      .json({ ok: false, error: e.message || "request-withdraw route error" });
  }
});

// finalize withdraw (no amount)
app.post("/api/drift/finalize", async (req, res) => {
  const ctx = { rid: req.rid, route: "drift:finalize" };

  try {
    const r = await runScript("drift-command", ["withdraw"], {}, ctx);

    if (!r.ok)
      logger.error("route.drift.finalize.failed", {
        ...ctx,
        code: r.code,
        error: r.error?.slice(0, 500),
      });
    else logger.info("route.drift.finalize.ok", { ...ctx, code: r.code });

    res.status(r.ok ? 200 : 500).json({ ...r, argv: ["withdraw"] });
  } catch (e) {
    logger.error("route.drift.finalize.exception", {
      ...ctx,
      error: e.message,
    });
    res
      .status(500)
      .json({ ok: false, error: e.message || "finalize route error" });
  }
});

// Hyperliquid command proxy
app.post("/api/hl-command", async (req, res) => {
  const { action, params = {} } = req.body || {};
  const ctx = {
    rid: req.rid,
    route: "hl-command",
    action,
    params: redact(params),
  };

  try {
    if (!action) {
      logger.warn("route.hl.missing_action", ctx);
      return res.status(400).json({ ok: false, error: "Missing 'action'." });
    }

    const argv = buildArgs(action, params);
    const r = await runScript("hl-command", argv, {}, ctx);

    if (!r.ok)
      logger.error("route.hl.failed", {
        ...ctx,
        code: r.code,
        error: r.error?.slice(0, 500),
      });
    else logger.info("route.hl.ok", { ...ctx, code: r.code });

    res.status(r.ok ? 200 : 500).json({ ...r, argv });
  } catch (e) {
    logger.error("route.hl.exception", { ...ctx, error: e.message });
    res.status(500).json({ ok: false, error: e.message || "HL route error" });
  }
});

// 404 JSON
app.use((_req, res) => res.status(404).json({ ok: false, error: "Not found" }));

// Start
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  logger.info("API starting", { port: PORT });
  console.log(`API on :${PORT}`);
});
