// backend/keeper/eventPoller.js
// CommonJS, ethers v6

const { ethers } = require("ethers");

/**
 * Create a robust multi-event poller for a single contract.
 *
 * @param {object} cfg
 * @param {ethers.Provider} cfg.provider        - Ethers provider
 * @param {ethers.Contract}  cfg.contract       - Ethers contract instance (used to parse logs)
 * @param {string}           cfg.address        - Contract address
 * @param {Array<{name:string, signature:string, handler:function}>} cfg.events
 *        events[i].signature is the full event signature, e.g.
 *        "Deposit(address,address,uint256,uint256)" or
 *        "WithdrawInitiated(address,uint256,uint256)"
 * @param {number} [cfg.confirmations=1]        - Target confirmations; used to set a reorg guard
 * @param {number} [cfg.eventPollMs=4000]       - Poll interval
 * @param {number} [cfg.reorgBuffer]            - Blocks kept unprocessed to avoid reorgs (default: max(confirmations-1,2))
 * @param {number|null} [cfg.startBlock=null]   - Backfill start; null = auto (head-1)
 * @param {function} [cfg.onError]              - Error hook (err) => void
 * @param {function} [cfg.onStart]              - Start hook ({fromBlock, head}) => void
 * @param {object} [cfg.logger=console]         - Logger with info/warn/error
 *
 * @returns {{ start:() => Promise<void>, stop:() => void }}
 */
function createEventPoller(cfg) {
  const {
    provider,
    contract,
    address,
    events,
    confirmations = 1,
    eventPollMs = 4000,
    reorgBuffer = Math.max(confirmations - 1, 2),
    startBlock = null,
    onError,
    onStart,
    logger = console,
  } = cfg || {};

  if (!provider || !contract || !address) {
    throw new Error("eventPoller: provider, contract, address are required");
  }
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error("eventPoller: 'events' array is required");
  }

  // Precompute topic0 for each event signature
  const topicToHandler = new Map();
  const topicOr = [];
  for (const ev of events) {
    if (!ev.signature || !ev.handler) {
      throw new Error("eventPoller: each event needs { signature, handler }");
    }
    const topic = ethers.id(ev.signature);
    topicOr.push(topic);
    topicToHandler.set(topic, ev);
  }

  let nextFromBlock;
  let stopped = false;
  let timer = null;
  const processed = new Set(); // de-dupe: `${txHash}|${logIndex}`

  async function start() {
    const head = await provider.getBlockNumber();
    nextFromBlock = startBlock != null ? startBlock : Math.max(0, head - 1);

    logger.info?.(
      "eventPoller.start",
      JSON.stringify({
        address,
        fromBlock: nextFromBlock,
        head,
        reorgBuffer,
        eventPollMs,
        events: events.map((e) => e.name || e.signature),
      })
    );

    try {
      onStart?.({ fromBlock: nextFromBlock, head });
    } catch {}

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
        // One query for all events via OR on topic0
        const logs = await provider.getLogs({
          address,
          fromBlock: nextFromBlock,
          toBlock: safeTo,
          topics: [topicOr],
        });

        for (const log of logs) {
          const key = `${log.transactionHash}|${log.logIndex}`;
          if (processed.has(key)) continue;

          const ev = topicToHandler.get(log.topics?.[0]);
          if (!ev) continue;

          let parsed;
          try {
            parsed = contract.interface.parseLog(log);
          } catch (e) {
            logger.error?.("eventPoller.parseLog", e?.message || String(e));
            continue;
          }

          try {
            await Promise.resolve(
              ev.handler({ args: parsed.args, log, parsed, eventName: ev.name })
            );
            processed.add(key);
          } catch (handlerErr) {
            logger.error?.(
              "eventPoller.handlerError",
              handlerErr?.message || String(handlerErr)
            );
          }
        }

        nextFromBlock = safeTo + 1;
      }
    } catch (e) {
      logger.error?.("eventPoller.loopError", e?.message || String(e));
      try {
        onError?.(e);
      } catch {}
    } finally {
      if (!stopped) timer = setTimeout(loop, eventPollMs);
    }
  }

  return { start, stop };
}

module.exports = { createEventPoller };
