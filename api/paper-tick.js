const { fetchKlines } = require("../lib/dataFeed");
const { simulate } = require("../lib/backtest");
const store = require("../lib/store");

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

// Secures the tick endpoint the way Future GPT Pro X's cron did -
// but this time the workflow actually has a `schedule:` trigger (see
// .github/workflows/paper-tick.yml), which was the missing piece there.
function isAuthorized(req) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return true; // no secret configured -> open (fine for local/dev only)
  const auth = req.headers?.authorization || "";
  return auth === `Bearer ${expected}`;
}

module.exports = async function handler(req, res) {
  if (!isAuthorized(req)) return send(res, 401, { message: "Unauthorized" });
  if (!store.configured()) {
    return send(res, 503, { message: "Upstash env vars missing (UPSTASH_REDIS_REST_URL / _TOKEN)." });
  }

  const coinId = req.query?.coin || "bitcoin";

  try {
    const state = await store.getOrInit();
    const candles = await fetchKlines(coinId, "1h", 1000);

    // Full replay against the whole known history. Deterministic given the
    // same candles + strategy params, so we can safely diff against what
    // we've already recorded instead of tracking cursor state separately.
    const { trades } = simulate(candles, { riskPct: 1, startEquity: 10000 });

    const alreadyRecorded = new Set(state.closedTrades.map(t => `${t.entryIndex}-${t.exitIndex}`));
    const newTrades = trades.filter(t => !alreadyRecorded.has(`${t.entryIndex}-${t.exitIndex}`));

    for (const trade of newTrades) {
      state.account.realizedPnl += trade.netPnl;
      state.account.feesPaid += trade.totalFees;
      state.account.equity += trade.netPnl;
      state.closedTrades.unshift({ ...trade, coinId, recordedAt: new Date().toISOString() });
    }
    state.closedTrades = state.closedTrades.slice(0, 500);
    state.lastTickAt = new Date().toISOString();

    await store.set(state);

    return send(res, 200, {
      newTradesRecorded: newTrades.length,
      totalClosedTrades: state.closedTrades.length,
      account: state.account,
    });
  } catch (error) {
    return send(res, 500, { message: error?.message || "Tick failed" });
  }
};
