"use strict";

const { generateSignals, generateTrendCrossSignals, generateMeanReversionSignals } = require("./strategy");
const { applyEntryCosts, applyExitCosts, slippedPrice, DEFAULT_COSTS } = require("./costModel");

const MIN_RELIABLE_TRADES = 8;

function simulate(
  candles,
  { riskPct = 1, startEquity = 10000 } = {},
  costs = DEFAULT_COSTS,
  strategyParams,
  mode = "rsi_pullback"
) {
  const signalFn =
    mode === "trend_cross" ? generateTrendCrossSignals :
    mode === "mean_reversion" ? generateMeanReversionSignals :
    generateSignals;
  const { signals, diagnostics } = signalFn(candles, strategyParams, costs);

  for (let i = 0; i < candles.length; i++) {
    if (position) {
      const bar = candles[i];
      let exitPrice = null;
      let exitReason = null;

      if (bar.low <= position.stopPrice) {
        exitPrice = position.stopPrice;
        exitReason = "STOP_LOSS";
      } else if (bar.high >= position.target2Price) {
        exitPrice = position.target2Price;
        exitReason = "TARGET_2";
      } else if (bar.high >= position.target1Price && !position.partialTaken) {
        exitPrice = position.target1Price;
        exitReason = "TARGET_1";
      } else if (i - position.entryIndex >= position.maxHoldBars) {
        exitPrice = bar.close;
        exitReason = "TIME_EXIT";
      }

      if (exitPrice != null) {
        const filledExit = slippedPrice(exitPrice, "SELL", costs);
        const exitNotional = filledExit * position.quantity;
        const exitFee = applyExitCosts(exitNotional, costs);
        const grossPnl = (filledExit - position.entryPrice) * position.quantity;
        const netPnl = grossPnl - position.entryFee - exitFee;

        equity += netPnl;

        trades.push({
          entryIndex: position.entryIndex,
          exitIndex: i,
          entryTime: candles[position.entryIndex].time,
          exitTime: bar.time,
          entryPrice: position.entryPrice,
          exitPrice: filledExit,
          quantity: position.quantity,
          stopDistancePct: position.stopDistancePct,
          costRatio: position.costRatio,
          grossPnl,
          totalFees: position.entryFee + exitFee,
          netPnl,
          exitReason,
          holdBars: i - position.entryIndex,
        });

        position = null;
      }
    }

    if (!position && signals[i]) {
      const sig = signals[i];
      const entryBar = candles[i + 1];
      if (!entryBar) continue;

      const filledEntry = slippedPrice(entryBar.open, "BUY", costs);
      const riskAmount = equity * (riskPct / 100);
      const quantity = riskAmount / (sig.entryPrice - sig.stopPrice);
      const entryNotional = filledEntry * quantity;
      const entryFee = applyEntryCosts(entryNotional, costs);

      position = {
        entryIndex: i + 1,
        entryPrice: filledEntry,
        quantity,
        stopPrice: sig.stopPrice,
        target1Price: sig.target1Price,
        target2Price: sig.target2Price,
        stopDistancePct: sig.stopDistancePct,
        costRatio: sig.costRatio,
        entryFee,
        maxHoldBars: 48,
        partialTaken: false,
      };
    }
  }

  return { trades, endEquity: equity, diagnostics };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function summarize(trades) {
  const wins = trades.filter(t => t.netPnl > 0);
  const losses = trades.filter(t => t.netPnl < 0);
  const grossProfit = wins.reduce((s, t) => s + t.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netPnl, 0));
  const netPnl = trades.reduce((s, t) => s + t.netPnl, 0);
  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, t) => s + t.netPnl, 0) / losses.length : 0;
  const payoffRatio = avgWin > 0 && avgLoss < 0 ? avgWin / Math.abs(avgLoss) : 0;
  const requiredBreakEvenWinRate = payoffRatio > 0 ? 100 / (1 + payoffRatio) : null;
  const winRate = trades.length ? (wins.length / trades.length) * 100 : 0;

  return {
    trades: trades.length,
    sampleSizeWarning: trades.length < MIN_RELIABLE_TRADES,
    wins: wins.length,
    losses: losses.length,
    winRate: round(winRate),
    netPnl: round(netPnl),
    profitFactor: round(grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? grossProfit : 0),
    payoffRatio: round(payoffRatio),
    requiredBreakEvenWinRate: requiredBreakEvenWinRate == null ? null : round(requiredBreakEvenWinRate),
    winRateGapPct: requiredBreakEvenWinRate == null ? null : round(winRate - requiredBreakEvenWinRate),
    expectancy: round(trades.length ? netPnl / trades.length : 0),
    avgCostRatio: round(
      trades.length ? trades.reduce((s, t) => s + num(t.costRatio), 0) / trades.length : 0
    ),
  };
}

function round(v, digits = 4) {
  const f = 10 ** digits;
  return Math.round((num(v) + Number.EPSILON) * f) / f;
}

function walkForwardBacktest(candles, opts, costs, strategyParams, mode) {
  const splitIndex = Math.floor(candles.length * 0.7);
  const inSample = candles.slice(0, splitIndex);
  const outOfSample = candles.slice(splitIndex);

  const inSampleResult = simulate(inSample, opts, costs, strategyParams, mode);
  const outOfSampleResult = simulate(outOfSample, opts, costs, strategyParams, mode);

  return {
    inSample: {
      ...summarize(inSampleResult.trades),
      trades: inSampleResult.trades,
      diagnostics: inSampleResult.diagnostics,
    },
    outOfSample: {
      ...summarize(outOfSampleResult.trades),
      trades: outOfSampleResult.trades,
      diagnostics: outOfSampleResult.diagnostics,
    },
  };
}

module.exports = { simulate, summarize, walkForwardBacktest, MIN_RELIABLE_TRADES };
