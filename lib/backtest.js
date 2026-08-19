"use strict";

const {
  generateSignals, generateTrendCrossSignals, generateMeanReversionSignals, generateBreakoutSignals,
} = require("./strategy");
const { applyEntryCosts, applyExitCosts, slippedPrice, DEFAULT_COSTS } = require("./costModel");

const MIN_RELIABLE_TRADES = 8;

function simulate(
  candles,
  { riskPct = 1, startEquity = 10000 } = {},
  costs = DEFAULT_COSTS,
  strategyParams,
  mode = "rsi_pullback",
  allowedSides = ["LONG", "SHORT"]
) {
  const signalFn =
    mode === "trend_cross" ? generateTrendCrossSignals :
    mode === "mean_reversion" ? generateMeanReversionSignals :
    mode === "breakout" ? generateBreakoutSignals :
    generateSignals;
  const { signals, diagnostics } = signalFn(candles, strategyParams, costs);
  const trades = [];
  let equity = startEquity;
  let position = null;

  for (let i = 0; i < candles.length; i++) {
    if (position) {
      const bar = candles[i];
      const isShort = position.side === "SHORT";

      const favorableThisBar = isShort ? position.entryPrice - bar.low : bar.high - position.entryPrice;
      const adverseThisBar = isShort ? bar.high - position.entryPrice : position.entryPrice - bar.low;
      if (favorableThisBar > position.mfe) position.mfe = favorableThisBar;
      if (adverseThisBar > position.mae) position.mae = adverseThisBar;

      let exitPrice = null;
      let exitReason = null;

      if (!isShort) {
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
      } else {
        if (bar.high >= position.stopPrice) {
          exitPrice = position.stopPrice;
          exitReason = "STOP_LOSS";
        } else if (bar.low <= position.target2Price) {
          exitPrice = position.target2Price;
          exitReason = "TARGET_2";
        } else if (bar.low <= position.target1Price && !position.partialTaken) {
          exitPrice = position.target1Price;
          exitReason = "TARGET_1";
        } else if (i - position.entryIndex >= position.maxHoldBars) {
          exitPrice = bar.close;
          exitReason = "TIME_EXIT";
        }
      }

      if (exitPrice != null) {
        const filledExit = slippedPrice(exitPrice, isShort ? "BUY" : "SELL", costs);
        const exitNotional = filledExit * position.quantity;
        const exitFee = applyExitCosts(exitNotional, costs);
        const grossPnl = isShort
          ? (position.entryPrice - filledExit) * position.quantity
          : (filledExit - position.entryPrice) * position.quantity;
        const netPnl = grossPnl - position.entryFee - exitFee;

        equity += netPnl;

        const stopDistance = Math.abs(position.entryPrice - position.stopPrice);

        trades.push({
          entryIndex: position.entryIndex,
          exitIndex: i,
          entryTime: candles[position.entryIndex].time,
          exitTime: bar.time,
          side: position.side,
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
          mfeR: stopDistance > 0 ? round(position.mfe / stopDistance) : 0,
          maeR: stopDistance > 0 ? round(position.mae / stopDistance) : 0,
        });

        position = null;
      }
    }

    if (!position && signals[i] && allowedSides.includes(signals[i].side)) {
      const sig = signals[i];
      const entryBar = candles[i + 1];
      if (!entryBar) continue;

      const isShort = sig.side === "SHORT";
      const filledEntry = slippedPrice(entryBar.open, isShort ? "SELL" : "BUY", costs);
      const riskAmount = equity * (riskPct / 100);
      const quantity = riskAmount / Math.abs(sig.entryPrice - sig.stopPrice);
      const entryNotional = filledEntry * quantity;
      const entryFee = applyEntryCosts(entryNotional, costs);

      position = {
        side: sig.side,
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
        mfe: 0,
        mae: 0,
      };
    }
  }

  return { trades, endEquity: equity, diagnostics };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function avg(items, key) {
  return items.length ? items.reduce((s, t) => s + num(t[key]), 0) / items.length : 0;
}

function summarize(trades) {
  const wins = trades.filter(t => t.netPnl > 0);
  const losses = trades.filter(t => t.netPnl < 0);
  const stopLossTrades = trades.filter(t => t.exitReason === "STOP_LOSS");
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
    avgMfeR: round(avg(trades, "mfeR")),
    avgMaeR: round(avg(trades, "maeR")),
    stopLossCount: stopLossTrades.length,
    avgMfeRBeforeStop: round(avg(stopLossTrades, "mfeR")),
  };
}

function round(v, digits = 4) {
  const f = 10 ** digits;
  return Math.round((num(v) + Number.EPSILON) * f) / f;
}

function computeBuyHold(candles, costs = DEFAULT_COSTS, startEquity = 10000) {
  if (!candles.length) {
    return { netPnl: 0, pctReturn: 0, startPrice: null, endPrice: null };
  }
  const startPrice = candles[0].open;
  const endPrice = candles[candles.length - 1].close;

  const filledEntry = slippedPrice(startPrice, "BUY", costs);
  const quantity = startEquity / filledEntry;
  const entryNotional = filledEntry * quantity;
  const entryFee = applyEntryCosts(entryNotional, costs);

  const filledExit = slippedPrice(endPrice, "SELL", costs);
  const exitNotional = filledExit * quantity;
  const exitFee = applyExitCosts(exitNotional, costs);

  const grossPnl = (filledExit - filledEntry) * quantity;
  const netPnl = grossPnl - entryFee - exitFee;

  return {
    startPrice: round(startPrice),
    endPrice: round(endPrice),
    netPnl: round(netPnl),
    pctReturn: round((netPnl / startEquity) * 100, 2),
  };
}

function walkForwardBacktest(candles, opts, costs, strategyParams, mode, allowedSides) {
  const splitIndex = Math.floor(candles.length * 0.7);
  const inSample = candles.slice(0, splitIndex);
  const outOfSample = candles.slice(splitIndex);

  const inSampleResult = simulate(inSample, opts, costs, strategyParams, mode, allowedSides);
  const outOfSampleResult = simulate(outOfSample, opts, costs, strategyParams, mode, allowedSides);
  const startEquity = opts?.startEquity || 10000;

  return {
    inSample: {
      ...summarize(inSampleResult.trades),
      trades: inSampleResult.trades,
      diagnostics: inSampleResult.diagnostics,
      buyHold: computeBuyHold(inSample, costs, startEquity),
    },
    outOfSample: {
      ...summarize(outOfSampleResult.trades),
      trades: outOfSampleResult.trades,
      diagnostics: outOfSampleResult.diagnostics,
      buyHold: computeBuyHold(outOfSample, costs, startEquity),
    },
  };
}

module.exports = { simulate, summarize, computeBuyHold, walkForwardBacktest, MIN_RELIABLE_TRADES };
