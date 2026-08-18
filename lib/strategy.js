"use strict";

const { ema, rsi, atr } = require("./indicators");
const { validateStopDistance, DEFAULT_COSTS } = require("./costModel");

/**
 * BASELINE STRATEGY - "Trend Pullback"
 *
 * This is a starting hypothesis, not a claimed edge:
 *   - Trend filter: EMA50 > EMA200 (only look for longs in an uptrend)
 *   - Entry trigger: RSI(14) dips below 40 then recovers above 45
 *     (a pullback within the trend, not a reversal bet)
 *   - Stop: entry - 1.5 * ATR(14), validated against cost model
 *   - Targets: 1.5R and 3R (partial at 1.5R, trail remainder)
 *
 * This exists to give the backtester (lib/backtest.js) something concrete
 * to test. Whether it should survive at all, and with which parameters,
 * is an empirical question - see the bucket-analysis output after running
 * a backtest. Do not tune these numbers by hand based on a handful of
 * trades; that's the exact trap the previous project fell into.
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

/**
 * candles: array of { time, open, high, low, close, volume }, oldest first.
 * Returns an array of signals aligned by index: null or
 * { side: 'LONG', reason, stopDistancePct, entryPrice }
 */
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

  for (let i = 1; i < candles.length; i++) {
    if (
      emaFast[i] == null || emaSlow[i] == null ||
      rsiValues[i] == null || atrValues[i] == null
    ) {
      continue;
    }

    const uptrend = emaFast[i] > emaSlow[i];

    if (rsiValues[i] < params.rsiOversold) {
      wasOversold = true;
    }

    const triggerNow = wasOversold && rsiValues[i] >= params.rsiRecover;

    if (uptrend && triggerNow) {
      const entryPrice = closes[i];
      const rawStopDistance = atrValues[i] * params.atrStopMultiple;
      const rawStopDistancePct = (rawStopDistance / entryPrice) * 100;
      const validation = validateStopDistance(rawStopDistancePct, costs);

      if (validation.valid) {
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
      }
      // Whether valid or rejected on cost grounds, reset the trigger so we
      // don't fire again on the very next bar for the same pullback.
      wasOversold = false;
    }
  }

  return signals;
}

module.exports = { PARAMS, generateSignals };
