// backend/keeper/lib/depositPoller.js
const { ethers } = require("ethers");

/**
 * Poll ERC-4626 Deposit(address,address,uint256,uint256) logs without ephemeral filters.
 *
 * @param {Object} opts
 * @param {ethers.Provider} opts.provider
 * @param {ethers.Contract}  opts.vault
 * @param {string}           opts.vaultAddress
 * @param {number}           [opts.confirmations=1]
 * @param {number}           [opts.eventPollMs=4000]
 * @param {number}           [opts.reorgBuffer=Math.max(confirmations-1,2)]
 * @param {number|null}      [opts.startBlock=null]
 * @param {function}         opts.onDeposit  - async ({ args, log, parsed }) => {}
 */
function createDepositPoller({
  provider,
  vault,
  vaultAddress,
  confirmations = 1,
  eventPollMs = 4000,
  reorgBuffer = Math.max(confirmations - 1, 2),
  startBlock = null,
  onDeposit,
}) {
  if (!provider || !vault || !vaultAddress) {
    throw new Error(
      "depositPoller: provider, vault, vaultAddress are required"
    );
  }
  if (typeof onDeposit !== "function") {
    throw new Error("depositPoller: onDeposit callback is required");
  }

  const depositTopic = ethers.id("Deposit(address,address,uint256,uint256)");

  let nextFromBlock;
  let stopped = false;
  let timer = null;

  async function start() {
    const head = await provider.getBlockNumber();
    nextFromBlock = startBlock != null ? startBlock : Math.max(0, head - 1);
    console.log(
      `[depositPoller] starting at block ${nextFromBlock} (head=${head}, reorgBuffer=${reorgBuffer})`
    );
    loop();
  }

  function stop() {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
  }

  async function loop() {
    if (stopped) return;

    try {
      const head = await provider.getBlockNumber();
      const safeTo = head - reorgBuffer;

      if (safeTo >= nextFromBlock) {
        const logs = await provider.getLogs({
          address: vaultAddress,
          fromBlock: nextFromBlock,
          toBlock: safeTo,
          topics: [depositTopic],
        });

        for (const log of logs) {
          let parsed;
          try {
            parsed = vault.interface.parseLog(log);
          } catch (e) {
            console.error("[depositPoller] parseLog failed:", e);
            continue;
          }
          await onDeposit({ args: parsed.args, log, parsed });
        }

        nextFromBlock = safeTo + 1;
      }
    } catch (e) {
      console.error("[depositPoller] error:", e);
    } finally {
      if (!stopped) {
        timer = setTimeout(loop, eventPollMs);
      }
    }
  }

  return { start, stop };
}

module.exports = { createDepositPoller };
