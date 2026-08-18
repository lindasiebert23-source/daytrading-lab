const { fetchKlines } = require("../lib/dataFeed");
const { walkForwardBacktest } = require("../lib/backtest");

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return send(res, 405, { message: "Method not allowed" });

  const coinId = req.query?.coin || "bitcoin";
  const interval = req.query?.interval || "1h";
  const limit = Number(req.query?.limit || 1000);

  try {
    const candles = await fetchKlines(coinId, interval, limit);
    const result = walkForwardBacktest(candles, { riskPct: 1, startEquity: 10000 });

    return send(res, 200, {
      coinId,
      interval,
      candleCount: candles.length,
      inSample: { ...result.inSample, trades: result.inSample.trades.length },
      outOfSample: { ...result.outOfSample, trades: result.outOfSample.trades.length },
      outOfSampleTrades: result.outOfSample.trades,
    });
  } catch (error) {
    return send(res, 500, { message: error?.message || "Backtest failed" });
  }
};
