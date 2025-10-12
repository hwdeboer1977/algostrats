// backend/keeper/withdrawChecker.js
// Runs a minute-by-minute poll (configurable) and finalizes due withdrawals
// by spawning withdrawPipeline.js with --stage=finalize --reqId=<id>.
// Usage:
//   node withdrawChecker.js                 # loop forever (default 60s)
//   node withdrawChecker.js --once          # process due items once, then exit
//   node withdrawChecker.js --interval=30000 # 30s
//   node withdrawChecker.js --reqId=wd_...  # only process a single id (once or each tick)

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

// Keep small buffer
const FINALIZE_BUFFER_SEC = Number(process.env.FINALIZE_BUFFER_SEC || 30);

// --- Config ---
const STATE_FILE = path.resolve(__dirname, "withdraw_state.json");
const PIPELINE = path.resolve(__dirname, "withdrawPipeline.js");

// --- CLI/env ---
function getArg(name, def) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  if (a) return a.slice(name.length + 3);
  if (process.argv.includes(`--${name}`)) return true; // flags like --once
  return def;
}
const INTERVAL_MS = Number(
  getArg("interval", process.env.FINALIZE_POLL_MS || 60_000)
);
const ONCE = Boolean(getArg("once", false));
const ONLY_REQ = getArg("reqId", null);

// --- Utils ---
function ts() {
  return new Date().toISOString();
}

// Prefer on-chain unlockAt (sec) if present; else recorded redeemAt (ms)
function dueAtMs(r) {
  if (typeof r.redeemAt === "number" && !Number.isNaN(r.redeemAt)) {
    return r.redeemAt; // already ms
  }
  if (r.unlockAt != null) {
    const u = Number(r.unlockAt);
    if (!Number.isNaN(u) && u > 0) return u * 1000; // sec -> ms
  }
  return null;
}

function isDue(r, now = Date.now()) {
  const t = dueAtMs(r);
  if (t == null) return false;
  const bufMs = FINALIZE_BUFFER_SEC * 1000; // small safety buffer
  return now + bufMs >= t;
}

function load() {
  try {
    const j = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return Array.isArray(j.requests) ? j : { requests: [] };
  } catch {
    return { requests: [] };
  }
}

function save(state) {
  const tmp = STATE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

function markProcessing(ids) {
  const state = load();
  const now = Date.now();
  const set = new Set(ids);
  state.requests = state.requests.map((r) =>
    set.has(r.reqId) && r.status === "pending"
      ? { ...r, status: "processing", updatedAt: now }
      : r
  );
  save(state);
}

function markDone(id, extra = {}) {
  const state = load();
  const now = Date.now();
  state.requests = state.requests.map((r) =>
    r.reqId === id ? { ...r, status: "done", updatedAt: now, ...extra } : r
  );
  save(state);
}

function markPending(id, reason = "") {
  const state = load();
  const now = Date.now();
  state.requests = state.requests.map((r) =>
    r.reqId === id
      ? { ...r, status: "pending", lastError: reason, updatedAt: now }
      : r
  );
  save(state);
}

function pickDue(limit = 50) {
  const { requests } = load();
  const now = Date.now();
  const list = requests
    .filter((r) => {
      if (ONLY_REQ && r.reqId !== ONLY_REQ) return false;
      const pendingish = r.status === "pending" || r.status === "processing";
      return pendingish && isDue(r, now);
    })
    .sort((a, b) => (dueAtMs(a) ?? Infinity) - (dueAtMs(b) ?? Infinity));
  return list.slice(0, limit);
}

function verifyFiles() {
  const pipelineExists = fs.existsSync(PIPELINE);
  const stateExists = fs.existsSync(STATE_FILE);
  console.log(`[${ts()}] 🧭 PIPELINE: ${PIPELINE} (exists=${pipelineExists})`);
  console.log(`[${ts()}] 🧾 STATE   : ${STATE_FILE} (exists=${stateExists})`);
  if (!stateExists) save({ requests: [] });
}

// --- Spawn finalize (tees child output with prefix) ---
async function finalizeViaPipeline(reqId) {
  return new Promise((resolve, reject) => {
    const args = [PIPELINE, "--stage=finalize", `--reqId=${reqId}`];
    console.log(`[${ts()}] [RUN] node ${args.join(" ")}`);

    const child = spawn(process.execPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      cwd: path.dirname(PIPELINE),
    });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => process.stdout.write(`[PIPELINE] ${d}`));
    child.stderr.on("data", (d) => process.stderr.write(`[PIPELINE:err] ${d}`));

    child.on("error", (err) => reject(err));
    child.on("exit", (code) => {
      console.log(`[${ts()}] [RUN] child exit code=${code}`);
      code === 0 ? resolve() : reject(new Error(`pipeline exited ${code}`));
    });
  });
}

// --- Main tick ---
let running = false;
async function finalizeDueOnce() {
  console.log(`[${ts()}] 🔎 Checking for available withdrawals to finalize…`);
  if (running) {
    console.log(`[${ts()}] ⏭️ Previous run still in progress, skipping.`);
    return;
  }
  running = true;

  try {
    const due = pickDue(50);
    const total = load().requests.length;
    console.log(
      `[${ts()}] 📋 Found ${due.length} due / ${total} total recorded.`
    );
    if (due.length === 0) return;

    // claim (mark processing) to avoid double-finalize in case of overlapping ticks
    markProcessing(due.map((r) => r.reqId));

    for (const r of due) {
      try {
        console.log(`[${ts()}] ▶️ Finalizing ${r.reqId}…`);
        // (Optional) Re-check on-chain redeemAt/finalized here before spawning.
        await finalizeViaPipeline(r.reqId);
        console.log(`[${ts()}] ✅ Finalized ${r.reqId}`);
        markDone(r.reqId);
      } catch (e) {
        console.error(`[${ts()}] ❌ Finalize failed ${r.reqId}: ${e.message}`);
        markPending(r.reqId, e.message);
      }
    }
  } finally {
    console.log(`[${ts()}] 🟢 Tick complete.`);
    running = false;
  }
}

// --- Boot ---
console.log(`[${ts()}] 🏁 withdrawChecker boot pid=${process.pid}`);
verifyFiles();

(async () => {
  if (ONCE) {
    await finalizeDueOnce();
    process.exit(0);
  } else {
    await finalizeDueOnce(); // run once on boot
    setInterval(() => {
      finalizeDueOnce().catch((e) =>
        console.error(`[${ts()}] Unhandled error:`, e)
      );
    }, INTERVAL_MS);
  }
})();
