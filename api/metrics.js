const store = require("../lib/store");

const MIN_RELIABLE_TRADES = 8;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round(v, digits = 4) {
  const f = 10 ** digits;
  return Math.round((num(v) + Number.EPSILON) * f) / f;
}

function summarize(trades = []) {
  const valid = trades.filter(Boolean);
  const wins = valid.filter(t => num(t.netPnl) > 0);
  const losses = valid.filter(t => num(t.netPnl) < 0);
  const grossProfit = wins.reduce((s, t) => s + num(t.netPnl), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + num(t.netPnl), 0));
  const netPnl = valid.reduce((s, t) => s + num(t.netPnl), 0);
  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, t) => s + num(t.netPnl), 0) / losses.length : 0;
  const payoffRatio = avgWin > 0 && avgLoss < 0 ? avgWin / Math.abs(avgLoss) : 0;
  const requiredBreakEvenWinRate = payoffRatio > 0 ? 100 / (1 + payoffRatio) : null;
  const winRate = valid.length ? (wins.length / valid.length) * 100 : 0;

  return {
    trades: valid.length,
    sampleSizeWarning: valid.length < MIN_RELIABLE_TRADES,
    wins: wins.length,
    losses: losses.length,
    winRate: round(winRate, 2),
    netPnl: round(netPnl),
    grossProfit: round(grossProfit),
    grossLoss: round(grossLoss),
    profitFactor: round(grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? grossProfit : 0),
    payoffRatio: round(payoffRatio),
    requiredBreakEvenWinRate: requiredBreakEvenWinRate == null ? null : round(requiredBreakEvenWinRate, 2),
    winRateGapPct: requiredBreakEvenWinRate == null ? null : round(winRate - requiredBreakEvenWinRate, 2),
    expectancy: round(valid.length ? netPnl / valid.length : 0),
    avgCostRatio: round(valid.length ? valid.reduce((s, t) => s + num(t.costRatio), 0) / valid.length : 0),
    avgHoldBars: round(valid.length ? valid.reduce((s, t) => s + num(t.holdBars), 0) / valid.length : 0, 2),
  };
}

function groupBy(trades, keyFn) {
  const map = new Map();
  for (const trade of trades) {
    const key = String(keyFn(trade) || "UNKNOWN");
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(trade);
  }
  return [...map.entries()]
    .map(([key, items]) => ({ key, ...summarize(items) }))
    .sort((a, b) => b.trades - a.trades);
}

function bucketize(trades, valueFn, edges) {
  const labels = [];
  for (let i = 0; i <= edges.length; i++) {
    if (i === 0) labels.push(`<${edges[0]}`);
    else if (i === edges.length) labels.push(`${edges[i - 1]}+`);
    else labels.push(`${edges[i - 1]}-${edges[i]}`);
  }
  const buckets = new Map(labels.map(l => [l, []]));
  for (const trade of trades) {
    const v = valueFn(trade);
    if (v == null || !Number.isFinite(v)) continue;
    let idx = edges.findIndex(e => v < e);
    if (idx === -1) idx = edges.length;
    buckets.get(labels[idx]).push(trade);
  }
  return labels.map(label => ({ bucket: label, ...summarize(buckets.get(label)) })).filter(e => e.trades > 0);
}

function costAnalysis(trades) {
  const grossWins = trades.filter(t => num(t.grossPnl) > 0);
  const flipped = grossWins.filter(t => num(t.netPnl) <= 0);
  const totalGrossProfit = trades.reduce((s, t) => s + Math.max(0, num(t.grossPnl)), 0);
  const totalFees = trades.reduce((s, t) => s + num(t.totalFees), 0);

  return {
    grossWinsCount: grossWins.length,
    costFlipCount: flipped.length,
    costFlipRatePct: round(grossWins.length ? (flipped.length / grossWins.length) * 100 : 0, 2),
    totalGrossProfit: round(totalGrossProfit),
    totalFeesPaid: round(totalFees),
    feesAsPctOfGrossProfit: round(totalGrossProfit > 0 ? (totalFees / totalGrossProfit) * 100 : 0, 2),
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return send(res, 405, { message: "Method not allowed" });
  if (!store.configured()) {
    return send(res, 503, { message: "Upstash env vars missing." });
  }

  try {
    const state = await store.get();
    if (!state) return send(res, 200, { message: "Noch kein State vorhanden." });

    const trades = Array.isArray(state.closedTrades) ? state.closedTrades.filter(Boolean) : [];

    return send(res, 200, {
      generatedAt: new Date().toISOString(),
      summary: summarize(trades),
      byExitReason: groupBy(trades, t => t.exitReason),
      byCoin: groupBy(trades, t => t.coinId),
      scoreBuckets: {
        byStopDistancePct: bucketize(trades, t => t.stopDistancePct, [1, 1.5, 2, 3]),
        byCostRatio: bucketize(trades, t => t.costRatio, [0.15, 0.25, 0.35, 0.5]),
        byHoldBars: bucketize(trades, t => t.holdBars, [2, 5, 10, 24]),
      },
      costAnalysis: costAnalysis(trades),
      account: state.account,
    });
  } catch (error) {
    return send(res, 500, { message: error?.message || "Metrics failed" });
  }
};
