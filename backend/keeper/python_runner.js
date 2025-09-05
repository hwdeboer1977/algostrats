// backend/keeper/python_runner.js
const { spawn } = require("child_process");
const path = require("path");

const PYTHON_BIN = process.env.PYTHON_BIN || "python";

function runPython(action = "summary", kvArgs = {}, opts = {}) {
  return new Promise((resolve, reject) => {
    const scriptPath =
      opts.scriptPath ||
      path.join(__dirname, "../../tools/hyperliquid/create_orders.py");

    const args = [
      action,
      ...Object.entries(kvArgs).map(([k, v]) => `${k}=${v}`),
    ];

    const child = spawn(
      PYTHON_BIN,
      [
        "-X",
        "utf8", // <— force UTF-8 mode (Py 3.7+)
        scriptPath,
        ...args,
      ],
      {
        cwd: path.dirname(scriptPath),
        env: {
          ...process.env,
          PYTHONIOENCODING: "utf-8", // <— also force stdio encoding
          PYTHONUTF8: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => {
      const s = d.toString();
      stdout += s;
      process.stdout.write(`[py] ${s}`);
    });
    child.stderr.on("data", (d) => {
      const s = d.toString();
      stderr += s;
      process.stderr.write(`[py ERR] ${s}`);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0)
        return reject(new Error(`Python exited ${code}. Stderr: ${stderr}`));
      let json = null;
      try {
        const match = stdout.match(/({[\s\S]*})\s*$/);
        if (match) json = JSON.parse(match[1]);
      } catch {}
      resolve(json ?? { ok: true, stdout });
    });
  });
}

module.exports = { runPython };
