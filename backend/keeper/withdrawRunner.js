// multi_withdraw_runner.js
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { spawn } = require("child_process");
const PIPELINE = path.resolve(__dirname, "withdrawPipeline.js");

const STATE_FILE = path.join(__dirname, "withdraw_state.json");

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
function ensureReqId(state) {
  let id;
  do {
    id = `wd_${randomUUID()}`;
  } while (state.requests.some((r) => r.reqId === id));
  return id;
}
function getArg(name, def) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
}
function nowMs() {
  return Date.now();
}
function hours(ms) {
  return ms / 36e5;
}
function fmt2(n) {
  return Number.isFinite(n) ? n.toFixed(2) : String(n);
}

// Finalize withdrawal after redemption
async function finalizeOne(r) {
  // Sanity checks + spawn with tee'd output
  return new Promise((resolve, reject) => {
    const exists = fs.existsSync(PIPELINE);
    console.log(`[RUNNER] Using pipeline at: ${PIPELINE} (exists=${exists})`);

    const args = [PIPELINE, "--stage=finalize", `--reqId=${r.reqId}`];
    console.log(`[RUNNER] Spawning: node ${args.join(" ")}`);

    const child = spawn(process.execPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      cwd: path.dirname(PIPELINE),
    });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => process.stdout.write(`[PIPELINE] ${d}`));
    child.stderr.on("data", (d) => process.stderr.write(`[PIPELINE:err] ${d}`));

    child.on("error", (err) => {
      console.error("[RUNNER] spawn error:", err);
      reject(err);
    });
    child.on("exit", (code) => {
      console.log(`[RUNNER] Child exited with code ${code}`);
      if (code === 0) {
        console.log(`✅ Finalized ${r.reqId} at ${new Date().toISOString()}`);
        resolve({ txHash: `pipeline:${Date.now()}` });
      } else {
        reject(new Error(`withdrawPipeline finalize exited ${code}`));
      }
    });
  });
}

async function cmdInit() {
  const state = load();
  const reqId = getArg("reqId") || ensureReqId(state);
  const hoursDelay = Number(getArg("hours", "25"));
  const redeemAt = nowMs() + hoursDelay * 3600_000;
  const note = getArg("note", "");

  const rec = {
    reqId,
    redeemAt,
    status: "pending",
    createdAt: nowMs(),
    updatedAt: nowMs(),
    note,
    // optional metadata you might want to store:
    // chainId, vault, user, amount, txHashInit, etc.
  };

  // upsert by reqId
  const i = state.requests.findIndex((r) => r.reqId === reqId);
  if (i >= 0) state.requests[i] = { ...state.requests[i], ...rec };
  else state.requests.push(rec);

  save(state);
  console.log(
    `📝 Saved ${reqId}; due at ${new Date(redeemAt).toLocaleString()} (~${fmt2(
      hoursDelay
    )}h)`
  );
  console.log(`State file: ${STATE_FILE}`);
}

async function cmdRun() {
  const state = load();
  const only = getArg("reqId"); // finalize a single id if provided
  const now = nowMs();

  // pick candidates: pending or processing, due now
  const candidates = state.requests.filter(
    (r) =>
      (!only || r.reqId === only) &&
      (r.status === "pending" || r.status === "processing") &&
      r.redeemAt <= now
  );

  if (candidates.length === 0) {
    console.log("Nothing due. Exiting.");
    return;
  }

  // mark as processing (best-effort claim in single-runner scenario)
  const ids = new Set(candidates.map((r) => r.reqId));
  state.requests = state.requests.map((r) =>
    ids.has(r.reqId) && r.status === "pending"
      ? { ...r, status: "processing", updatedAt: now }
      : r
  );
  save(state);

  let done = 0;
  for (const r of candidates) {
    try {
      if (nowMs() < r.redeemAt) {
        // drifted early? put back
        const s = load();
        s.requests = s.requests.map((x) =>
          x.reqId === r.reqId
            ? { ...x, status: "pending", updatedAt: nowMs() }
            : x
        );
        save(s);
        continue;
      }
      const { txHash } = await finalizeOne(r);
      const s = load();
      s.requests = s.requests.map((x) =>
        x.reqId === r.reqId
          ? { ...x, status: "done", txHash, updatedAt: nowMs() }
          : x
      );
      save(s);
      done++;
    } catch (e) {
      console.error(`❌ Finalize failed for ${r.reqId}:`, e.message);
      const s = load();
      s.requests = s.requests.map((x) =>
        x.reqId === r.reqId
          ? {
              ...x,
              status: "pending",
              lastError: e.message,
              updatedAt: nowMs(),
            }
          : x
      );
      save(s);
    }
  }
  console.log(`Run complete. Finalized ${done} request(s).`);
}

function cmdList() {
  const state = load();
  if (!state.requests.length) {
    console.log("No requests recorded.");
    return;
  }
  const now = nowMs();
  const rows = state.requests
    .slice()
    .sort((a, b) => a.redeemAt - b.redeemAt)
    .map((r) => ({
      reqId: r.reqId,
      status: r.status,
      dueAtLocal: new Date(r.redeemAt).toLocaleString(),
      hoursLeft: fmt2(Math.max(0, hours(r.redeemAt - now))),
      note: r.note || "",
    }));
  console.table(rows);
}

function cmdPurge() {
  const keepDays = Number(getArg("days", "7")); // keep recent history
  const cutoff = nowMs() - keepDays * 86400_000;
  const state = load();
  const before = state.requests.length;
  state.requests = state.requests.filter(
    (r) => !(r.status === "done" && (r.updatedAt ?? r.createdAt) < cutoff)
  );
  save(state);
  console.log(`Purged ${before - state.requests.length} old done record(s).`);
}

(async () => {
  const cmd = process.argv[2];
  if (cmd === "init") return cmdInit();
  if (cmd === "run") return cmdRun();
  if (cmd === "list") return cmdList();
  if (cmd === "purge") return cmdPurge();

  console.log(`Usage:
  node ${path.basename(
    __filename
  )} init  --hours=25 [--reqId=custom] [--note="..."]
  node ${path.basename(
    __filename
  )} run   [--reqId=wd_xxx]    # finalize due (one or all)
  node ${path.basename(__filename)} list
  node ${path.basename(__filename)} purge --days=7
  `);
})();
