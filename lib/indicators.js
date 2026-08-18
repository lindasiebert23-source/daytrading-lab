"use strict";

/**
 * Deliberately small, well-known indicator set.
 *
 * WHY: in the previous project, entry decisions ran through 4-5 stacked
 * weighted scores (componentScores -> strategySignalScore -> entryIntelligence
 * -> masterBrain -> portfolioFit), each with hand-picked weights. Nobody had
 * validated whether any single layer actually predicted outcomes, so we
 * couldn't tell which parts (if any) carried real signal.
 *
 * Here we start with 3 plain, textbook indicators. The backtest/metrics
 * bucket analysis (see /lib/backtest.js) is what decides whether each one
 * earns a place in the strategy - not intuition.
 */

function ema(values, period) {
  const k = 2 / (period + 1);
  const out = new Array(values.length).fill(null);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    if (values[i] == null) continue;
    prev = prev == null ? values[i] : values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  let gainSum = 0;
  let lossSum = 0;

  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = Math.max(0, change);
    const loss = Math.max(0, -change);

    if (i <= period) {
      gainSum += gain;
      lossSum += loss;
      if (i === period) {
        const avgGain = gainSum / period;
        const avgLoss = lossSum / period;
        out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
      }
      continue;
    }

    // Wilder's smoothing
    const prevAvgGain = gainSum;
    const prevAvgLoss = lossSum;
    gainSum = (prevAvgGain * (period - 1) + gain) / period;
    lossSum = (prevAvgLoss * (period - 1) + loss) / period;
    out[i] = lossSum === 0 ? 100 : 100 - 100 / (1 + gainSum / lossSum);
  }
  return out;
}

// True Range / ATR - used both for the strategy's stop distance and for the
// cost-to-risk validation in costModel.js.
function atr(highs, lows, closes, period = 14) {
  const tr = new Array(closes.length).fill(null);
  for (let i = 0; i < closes.length; i++) {
    if (i === 0) {
      tr[i] = highs[i] - lows[i];
      continue;
    }
    tr[i] = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
  }

  const out = new Array(closes.length).fill(null);
  let prev = null;
  for (let i = 0; i < tr.length; i++) {
    if (i < period - 1) continue;
    if (prev == null) {
      const slice = tr.slice(i - period + 1, i + 1);
      prev = slice.reduce((a, b) => a + b, 0) / period;
    } else {
      prev = (prev * (period - 1) + tr[i]) / period;
    }
    out[i] = prev;
  }
  return out;
}

module.exports = { ema, rsi, atr };
