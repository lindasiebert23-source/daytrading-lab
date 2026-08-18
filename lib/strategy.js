"use strict";

const { ema, rsi, atr } = require("./indicators");
const { validateStopDistance, DEFAULT_COSTS } = require("./costModel");

/**
 * BASELINE STRATEGY - "Trend Pullback"
 *
 * This is a starting hypothesis, not a claimed edge:
 *   - Trend filter: EMA50 > EMA200 (only look for longs in an uptrend)
 *   - Entry trigger: RSI(14) dips below 40 then recovers above 45
 *   - Stop: entry - 1.5 * ATR(14), validated against cost model
 *   - Targets: 1.5R and 3R
 */

const PARAMS = {
  emaFastPeriod: 50,
  emaSlowPeriod: 200,
  rsiPeriod: 14,
  rsiOversold: 40,
  rsiRecover: 45,
  atrPeriod: 14,
  atrStopMultiple: 1.5,
  target1R: 1.5,
  target2R: 3,
};

function generateSignals(candles, params = PARAMS, costs = DEFAULT_COSTS) {
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);

  const emaFast = ema(closes, params.emaFastPeriod);
  const emaSlow = ema(closes, params.emaSlowPeriod);
  const rsiValues = rsi(closes, params.rsiPeriod);
  const atrValues = atr(highs, lows, closes, params.atrPeriod);

  const signals = new Array(candles.length).fill(null);

  let wasOversold = false;
  const diagnostics = {
    barsWithAllIndicators: 0,
    barsInUptrend: 0,
    triggerCandidates: 0,
    rejectedByCost: 0,
    signalsAccepted: 0,
    avgAtrPct: 0,
  };
  let atrPctSum = 0;
  let atrPctCount = 0;

  for (let i = 1; i < candles.length; i++) {
    if (
      emaFast[i] == null || emaSlow[i] == null ||
      rsiValues[i] == null || atrValues[i] == null
    ) {
      continue;
    }
    diagnostics.barsWithAllIndicators++;
    atrPctSum += (atrValues[i] / closes[i]) * 100;
    atrPctCount++;

    const uptrend = emaFast[i] > emaSlow[i];
    if (uptrend) diagnostics.barsInUptrend++;

    if (rsiValues[i] < params.rsiOversold) {
      wasOversold = true;
    }

    const triggerNow = wasOversold && rsiValues[i] >= params.rsiRecover;

    if (uptrend && triggerNow) {
      diagnostics.triggerCandidates++;
      const entryPrice = closes[i];
      const rawStopDistance = atrValues[i] * params.atrStopMultiple;
      const rawStopDistancePct = (rawStopDistance / entryPrice) * 100;
      const validation = validateStopDistance(rawStopDistancePct, costs);

      if (validation.valid) {
        diagnostics.signalsAccepted++;
        signals[i] = {
          side: "LONG",
          reason: "TREND_PULLBACK",
          entryPrice,
          stopDistance: rawStopDistance,
          stopDistancePct: rawStopDistancePct,
          stopPrice: entryPrice - rawStopDistance,
          target1Price: entryPrice + rawStopDistance * params.target1R,
          target2Price: entryPrice + rawStopDistance * params.target2R,
          costRatio: validation.costRatio,
        };
      } else {
        diagnostics.rejectedByCost++;
      }
      wasOversold = false;
    }
  }

  diagnostics.avgAtrPct = atrPctCount ? atrPctSum / atrPctCount : 0;
  return { signals, diagnostics };
}

module.exports = { PARAMS, generateSignals };
