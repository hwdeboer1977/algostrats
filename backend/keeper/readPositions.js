// readPositions.js (CJS)
const { spawn } = require("child_process");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const { runPython } = require("./python_runner.js");

// run a Node script and capture stdout
function runNode(file, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let out = "",
      err = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve(out) : reject(new Error(err || `exit ${code}`))
    );
  });
}

// parse Drift reader output for Balance (USD)
function parseBalanceUsd(text) {
  const m = /Balance\s*\(USD\)\s*:\s*([-\d.,]+)/i.exec(text);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

// parse HL stdout for total_usd
function parseTotalUsd(text) {
  const m = /total_usd:\s*([-\d.]+)/i.exec(text);
  return m ? Number(m[1]) : null;
}

(async () => {
  // Drift balanceUsd
  const driftScript = path.resolve(
    __dirname,
    "../../tools/drift/read_position_info.mjs"
  );
  const driftOut = await runNode(driftScript, []);
  const balanceUsd = parseBalanceUsd(driftOut);

  // HL total_usd (expects runPython("summary") to return { stdout })
  const hlRes = await runPython("summary");
  const hlStdout =
    hlRes && typeof hlRes.stdout === "string" ? hlRes.stdout : "";
  const totalUsd = parseTotalUsd(hlStdout);

  console.log("balanceUsd", balanceUsd ?? "");
  console.log("total_usd", totalUsd ?? "");
})().catch((e) => {
  console.error("readPositions failed:", e.message || e);
  process.exit(1);
});
