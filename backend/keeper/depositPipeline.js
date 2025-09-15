// backend/keeper/depositPipeline.js
const path = require("path");
const { spawn } = require("child_process");
const { ethers } = require("ethers");
const { Connection, PublicKey } = require("@solana/web3.js");
const { getAssociatedTokenAddressSync } = require("@solana/spl-token");

// ---------- tiny utils ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const toKebab = (s) => s.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
const fetchJson = async (url, body) => {
  const f = global.fetch || (await import("node-fetch").then((m) => m.default));
  const r = await f(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
};

// Wait until ERC20 balance increases from `prev`
async function waitForIncrease(
  token,
  addr,
  prev,
  { timeoutMs = 120000, pollMs = 5000 } = {}
) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const now = await token.balanceOf(addr);
    if (now > prev) return now;
    await sleep(pollMs);
  }
  return prev; // timeout → return prev so callers can skip step
}

// read 90% of ERC20 balance as human string
async function ninetyPercentHuman(addr, erc20) {
  const [dec, bal] = await Promise.all([
    erc20.decimals(),
    erc20.balanceOf(addr),
  ]);
  const amtRaw = (bal * 9000n) / 10000n; // 90%
  return ethers.formatUnits(amtRaw, dec);
}

async function getUsdcBalanceHuman(rpcUrl, ownerBase58, mintBase58) {
  const conn = new Connection(rpcUrl, "confirmed");
  const owner = new PublicKey(ownerBase58);
  const mint = new PublicKey(mintBase58);
  const ata = getAssociatedTokenAddressSync(mint, owner, false);
  try {
    const { value } = await conn.getTokenAccountBalance(ata);
    return value.uiAmountString; // 6dp string
  } catch {
    const accs = await conn.getParsedTokenAccountsByOwner(owner, { mint });
    const raw = accs.value.reduce(
      (n, a) => n + BigInt(a.account.data.parsed.info.tokenAmount.amount),
      0n
    );
    return raw === 0n
      ? "0"
      : (Number(raw) / 1e6).toFixed(6).replace(/\.?0+$/, "");
  }
}

async function waitForSolanaFinality(
  signature,
  rpcUrl,
  timeoutMs = 120000,
  pollMs = 2000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const resp = await fetchJson(rpcUrl, {
      jsonrpc: "2.0",
      id: 1,
      method: "getSignatureStatuses",
      params: [[signature], { searchTransactionHistory: true }],
    });
    const st = resp?.result?.value?.[0];
    const cs = st?.confirmationStatus;
    if (cs === "confirmed" || cs === "finalized") return st;
    await sleep(pollMs);
  }
  throw new Error(`Signature ${signature} not confirmed in time`);
}

// ---------- child runners ----------
function getPythonBin() {
  return (
    process.env.PYTHON_BIN || (process.platform === "win32" ? "py" : "python3")
  );
}
function runNodeScript(scriptPath, args = [], env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: path.dirname(scriptPath),
      stdio: "inherit",
      windowsHide: true,
      env: { ...process.env, ...env },
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${path.basename(scriptPath)} exited ${code}`))
    );
  });
}
function runPythonScript(scriptPath, args = [], env = {}) {
  const py = getPythonBin();
  return new Promise((resolve, reject) => {
    const child = spawn(py, [scriptPath, ...args], {
      cwd: path.dirname(scriptPath),
      stdio: "inherit",
      windowsHide: true,
      env: { ...process.env, ...env },
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${path.basename(scriptPath)} exited ${code}`))
    );
  });
}
function runDriftVault(
  driftVaultScript,
  action,
  opts = {},
  env = {},
  { resolveOnSignature = true } = {}
) {
  return new Promise((resolve, reject) => {
    const args = [driftVaultScript, action];
    for (const [k, v] of Object.entries(opts)) {
      const flag = `--${toKebab(k)}`;
      if (typeof v === "boolean") {
        if (v) args.push(flag);
      } else if (Array.isArray(v))
        v.forEach((val) => args.push(flag, String(val)));
      else args.push(flag, String(v));
    }
    const child = spawn(process.execPath, args, {
      cwd: path.dirname(driftVaultScript),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, ...env },
    });

    let out = "",
      err = "";
    child.stdout.on("data", (d) => {
      const s = d.toString();
      out += s;
      process.stdout.write(s);
    });
    child.stderr.on("data", (d) => {
      const s = d.toString();
      err += s;
      process.stderr.write(s);
    });

    child.once("error", reject);
    child.once("exit", async (code) => {
      const sigMatch = out.match(/Transaction signature:\s+([A-Za-z0-9]+)/);
      const sig = sigMatch?.[1];
      const is503 =
        /503|Forwarder error/i.test(out) || /503|Forwarder error/i.test(err);

      if (sig && resolveOnSignature) {
        try {
          const rpc = env.SOLANA_RPC_URL || process.env.SOLANA_RPC_URL;
          if (rpc) await waitForSolanaFinality(sig, rpc);
          console.log(`✅ Drift vault ${action} confirmed: ${sig}`);
          return resolve();
        } catch (e) {
          return reject(e);
        }
      }
      if (code !== 0 && is503) return reject(new Error("Solana RPC 503"));
      return code === 0
        ? resolve()
        : reject(new Error(`vault script exited ${code}`));
    });
  });
}

// ---------- builder ----------
/**
 * Build the deposit pipeline. Nothing runs on import.
 *
 * @param {object} p
 * @param {ethers.Contract} p.wbtc          WBTC ERC20 on Arbitrum
 * @param {ethers.Contract} p.usdc          USDC ERC20 on Arbitrum
 * @param {object} p.wallets                { A: arbitrumAddrA, B: arbitrumAddrB }
 * @param {object} p.privateKeys            { A: pkA, B: pkB }  // used by swap/bridge/HL deposit scripts
 * @param {object} p.scripts                { swap, bridge, hlDeposit, hlOpen, driftVault }
 * @param {object} p.solana                 { rpc, owner, usdcMint }
 * @param {ethers.Provider} p.provider      Ethers provider (used only for waits)
 */
function buildDepositPipeline({
  wbtc,
  usdc,
  wallets,
  privateKeys,
  scripts,
  solana,
  provider,
}) {
  if (!wbtc || !usdc) throw new Error("wbtc/usdc contract instances required");
  if (!wallets?.A || !wallets?.B)
    throw new Error("wallets.A and wallets.B required");
  if (
    !scripts?.swap ||
    !scripts?.bridge ||
    !scripts?.hlDeposit ||
    !scripts?.hlOpen ||
    !scripts?.driftVault
  ) {
    throw new Error(
      "scripts paths missing (swap, bridge, hlDeposit, hlOpen, driftVault)"
    );
  }
  if (!solana?.rpc || !solana?.owner || !solana?.usdcMint) {
    throw new Error("solana.rpc, solana.owner, solana.usdcMint required");
  }

  async function runSwap({ amount, pk }) {
    const env = pk ? { WALLET_SECRET: pk } : {};
    console.log(`[swap] node ${scripts.swap} ${amount}`);
    await runNodeScript(scripts.swap, [String(amount)], env);
  }
  async function runBridge({ amount, pk }) {
    const env = pk ? { WALLET_SECRET: pk } : {};
    console.log(`[bridge] node ${scripts.bridge} ${amount}`);
    await runNodeScript(scripts.bridge, [String(amount)], env);
  }
  async function runHlDeposit({ amount, pk }) {
    const env = {
      ARB_RPC: process.env.ARBITRUM_ALCHEMY_MAINNET,
      USER: wallets.B,
    };
    if (pk) env.PK = pk;
    await runPythonScript(scripts.hlDeposit, [String(amount)], env);
  }
  async function runHlOrdersKV(subcmd, kv = {}, env = {}) {
    const kvArgs = Object.entries(kv).map(([k, v]) => `${k}=${String(v)}`);
    await runPythonScript(scripts.hlOpen, [subcmd, ...kvArgs], env);
  }

  // The actual pipeline
  return async function depositPipeline({
    txHash,
    caller,
    owner,
    assets,
    shares,
  }) {
    console.log(`➡️  Pipeline start for ${txHash}`);

    // 1) ensure WBTC arrived (brief wait against current balances)
    const [preA, preB] = await Promise.all([
      wbtc.balanceOf(wallets.A),
      wbtc.balanceOf(wallets.B),
    ]);
    let postA = preA,
      postB = preB;
    try {
      postA = await waitForIncrease(wbtc, wallets.A, preA, {
        timeoutMs: 60_000,
      });
    } catch {}
    try {
      postB = await waitForIncrease(wbtc, wallets.B, preB, {
        timeoutMs: 60_000,
      });
    } catch {}
    console.log(`WBTC A: ${preA} → ${postA} ; B: ${preB} → ${postB}`);

    // 2) swap WBTC→USDC (90%) for each wallet that received WBTC
    if (postA > preA) {
      const amtA = await ninetyPercentHuman(wallets.A, wbtc);
      if (parseFloat(amtA) > 0)
        await runSwap({ amount: amtA, pk: privateKeys?.A });
    } else {
      console.log("[A] no new WBTC, skip swap");
    }
    if (postB > preB) {
      const amtB = await ninetyPercentHuman(wallets.B, wbtc);
      if (parseFloat(amtB) > 0)
        await runSwap({ amount: amtB, pk: privateKeys?.B });
    } else {
      console.log("[B] no new WBTC, skip swap");
    }

    // 3) bridge 85% of A's USDC → Solana
    const usdcA90 = await ninetyPercentHuman(wallets.A, usdc); // current USDC*90%
    const bridgeAmt =
      Math.floor(parseFloat(usdcA90 || "0") * 0.9444 * 1e6) / 1e6;
    // note: if you want exactly 85% of full balance, change to reading full balance and *0.85
    if (bridgeAmt > 0) {
      const amtStr = bridgeAmt.toFixed(6).replace(/\.?0+$/, "");
      await runBridge({ amount: amtStr, pk: privateKeys?.A });
    } else {
      console.log("[A] no USDC to bridge");
    }

    // 4) Hyperliquid: deposit B's USDC and open position
    const usdcB90 = await ninetyPercentHuman(wallets.B, usdc);
    if (parseFloat(usdcB90) > 0) {
      await runHlDeposit({ amount: usdcB90, pk: privateKeys?.B });
      await runHlOrdersKV("open", {
        coin: "ETH",
        side: "buy",
        size: "0.003",
        slippage: "0.005",
        leverage: "10",
        margin: "cross",
      });
    } else {
      console.log("[B] no USDC to deposit/open on HL");
    }

    // 5) Drift vault: deposit 90% of Solana USDC
    const solUsdc = await getUsdcBalanceHuman(
      solana.rpc,
      solana.owner,
      solana.usdcMint
    );
    const dep = Math.floor(parseFloat(solUsdc || "0") * 0.9 * 1e6) / 1e6;
    if (dep > 0) {
      const depStr = dep.toFixed(6).replace(/\.?0+$/, "");
      await runDriftVault(
        scripts.driftVault,
        "deposit",
        { amount: depStr },
        { SOLANA_RPC_URL: solana.rpc }
      );
    } else {
      console.log("[Drift] no USDC on Solana to deposit");
    }

    console.log(`✅ Pipeline finished for ${txHash}`);
  };
}

module.exports = { buildDepositPipeline };
