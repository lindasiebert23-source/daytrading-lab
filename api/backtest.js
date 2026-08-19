const { fetchKlines } = require("../lib/dataFeed");
const { walkForwardBacktest } = require("../lib/backtest");
const { PARAMS, MR_PARAMS, BREAKOUT_PARAMS } = require("../lib/strategy");
const { DEFAULT_COSTS } = require("../lib/costModel");

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
  const limit = Number(req.query?.limit || 5000);
  const endTime = req.query?.endDate ? new Date(req.query.endDate).getTime() : undefined;
  const validModes = ["rsi_pullback", "trend_cross", "mean_reversion", "breakout"];
  const mode = validModes.includes(req.query?.mode) ? req.query.mode : "rsi_pullback";
  const baseParams =
    mode === "mean_reversion" ? MR_PARAMS :
    mode === "breakout" ? BREAKOUT_PARAMS :
    PARAMS;
  const strategyParams = {
    ...baseParams,
    ...(req.query?.atrMult ? { atrStopMultiple: Number(req.query.atrMult) } : {}),
    ...(req.query?.sidewaysMaxTrendPct
      ? { sidewaysMaxTrendPct: Number(req.query.sidewaysMaxTrendPct) }
      : {}),
    ...(req.query?.bbStdDev ? { bbStdDev: Number(req.query.bbStdDev) } : {}),
    ...(req.query?.donchianPeriod ? { donchianPeriod: Number(req.query.donchianPeriod) } : {}),
  };

  try {
    const candles = await fetchKlines(coinId, interval, limit, endTime);
    const result = walkForwardBacktest(
      candles,
      { riskPct: 1, startEquity: 10000 },
      DEFAULT_COSTS,
      strategyParams,
      mode
    );

    return send(res, 200, {
      coinId,
      interval,
      mode,
      candleCount: candles.length,
      periodStart: candles[0] ? new Date(candles[0].time).toISOString() : null,
      periodEnd: candles[candles.length - 1] ? new Date(candles[candles.length - 1].time).toISOString() : null,
      atrStopMultiple: strategyParams.atrStopMultiple,
      sidewaysMaxTrendPct: strategyParams.sidewaysMaxTrendPct,
      bbStdDev: strategyParams.bbStdDev,
      inSample: { ...result.inSample, trades: result.inSample.trades.length },
      outOfSample: { ...result.outOfSample, trades: result.outOfSample.trades.length },
      outOfSampleTrades: result.outOfSample.trades,
    });
  } catch (error) {
    return send(res, 500, { message: error?.message || "Backtest failed" });
  }
};
