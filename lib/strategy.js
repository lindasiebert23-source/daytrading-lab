"use strict";

const { ema, rsi, atr, bollingerBands, donchianChannel } = require("./indicators");
const { validateStopDistance, DEFAULT_COSTS } = require("./costModel");

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

function generateTrendCrossSignals(candles, params = PARAMS, costs = DEFAULT_COSTS) {
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);

  const emaFast = ema(closes, params.emaFastPeriod);
  const emaSlow = ema(closes, params.emaSlowPeriod);
  const atrValues = atr(highs, lows, closes, params.atrPeriod);

  const signals = new Array(candles.length).fill(null);
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
  let wasUptrend = false;

  for (let i = 1; i < candles.length; i++) {
    if (emaFast[i] == null || emaSlow[i] == null || atrValues[i] == null) continue;

    diagnostics.barsWithAllIndicators++;
    atrPctSum += (atrValues[i] / closes[i]) * 100;
    atrPctCount++;

    const uptrend = emaFast[i] > emaSlow[i];
    if (uptrend) diagnostics.barsInUptrend++;

    const freshCrossUp = uptrend && !wasUptrend;

    if (freshCrossUp) {
      diagnostics.triggerCandidates++;
      const entryPrice = closes[i];
      const rawStopDistance = atrValues[i] * params.atrStopMultiple;
      const rawStopDistancePct = (rawStopDistance / entryPrice) * 100;
      const validation = validateStopDistance(rawStopDistancePct, costs);

      if (validation.valid) {
        diagnostics.signalsAccepted++;
        signals[i] = {
          side: "LONG",
          reason: "TREND_CROSS",
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
    }
    wasUptrend = uptrend;
  }

  diagnostics.avgAtrPct = atrPctCount ? atrPctSum / atrPctCount : 0;
  return { signals, diagnostics };
}

const MR_PARAMS = {
  emaFastPeriod: 50,
  emaSlowPeriod: 200,
  bbPeriod: 20,
  bbStdDev: 2,
  sidewaysMaxTrendPct: 1.5,
  atrPeriod: 14,
  atrStopMultiple: 1.5,
  target1R: 1,
  target2R: 2,
};

function generateMeanReversionSignals(candles, params = MR_PARAMS, costs = DEFAULT_COSTS) {
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);

  const emaFast = ema(closes, params.emaFastPeriod);
  const emaSlow = ema(closes, params.emaSlowPeriod);
  const atrValues = atr(highs, lows, closes, params.atrPeriod);
  const { lower: bbLower } = bollingerBands(closes, params.bbPeriod, params.bbStdDev);

  const signals = new Array(candles.length).fill(null);
  const diagnostics = {
    barsWithAllIndicators: 0,
    barsSideways: 0,
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
      atrValues[i] == null || bbLower[i] == null
    ) {
      continue;
    }
    diagnostics.barsWithAllIndicators++;
    atrPctSum += (atrValues[i] / closes[i]) * 100;
    atrPctCount++;

    const trendPct = (Math.abs(emaFast[i] - emaSlow[i]) / closes[i]) * 100;
    const sideways = trendPct < params.sidewaysMaxTrendPct;
    if (sideways) diagnostics.barsSideways++;

    const oversoldExtreme = closes[i] < bbLower[i];

    if (sideways && oversoldExtreme) {
      diagnostics.triggerCandidates++;
      const entryPrice = closes[i];
      const rawStopDistance = atrValues[i] * params.atrStopMultiple;
      const rawStopDistancePct = (rawStopDistance / entryPrice) * 100;
      const validation = validateStopDistance(rawStopDistancePct, costs);

      if (validation.valid) {
        diagnostics.signalsAccepted++;
        signals[i] = {
          side: "LONG",
          reason: "MEAN_REVERSION",
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
    }
  }

  diagnostics.avgAtrPct = atrPctCount ? atrPctSum / atrPctCount : 0;
  return { signals, diagnostics };
}

const BREAKOUT_PARAMS = {
  donchianPeriod: 20,
  atrPeriod: 14,
  atrStopMultiple: 1.5,
  target1R: 2,
  target2R: 4,
};

function generateBreakoutSignals(candles, params = BREAKOUT_PARAMS, costs = DEFAULT_COSTS) {
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);

  const atrValues = atr(highs, lows, closes, params.atrPeriod);
  const { upper: donchianUpper } = donchianChannel(highs, lows, params.donchianPeriod);

  const signals = new Array(candles.length).fill(null);
  const diagnostics = {
    barsWithAllIndicators: 0,
    triggerCandidates: 0,
    rejectedByCost: 0,
    signalsAccepted: 0,
    avgAtrPct: 0,
  };
  let atrPctSum = 0;
  let atrPctCount = 0;

  for (let i = 1; i < candles.length; i++) {
    if (atrValues[i] == null || donchianUpper[i] == null) continue;

    diagnostics.barsWithAllIndicators++;
    atrPctSum += (atrValues[i] / closes[i]) * 100;
    atrPctCount++;

    const breakoutNow = closes[i] > donchianUpper[i];

    if (breakoutNow) {
      diagnostics.triggerCandidates++;
      const entryPrice = closes[i];
      const rawStopDistance = atrValues[i] * params.atrStopMultiple;
      const rawStopDistancePct = (rawStopDistance / entryPrice) * 100;
      const validation = validateStopDistance(rawStopDistancePct, costs);

      if (validation.valid) {
        diagnostics.signalsAccepted++;
        signals[i] = {
          side: "LONG",
          reason: "DONCHIAN_BREAKOUT",
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
    }
  }

  diagnostics.avgAtrPct = atrPctCount ? atrPctSum / atrPctCount : 0;
  return { signals, diagnostics };
}

module.exports = {
  PARAMS, generateSignals,
  generateTrendCrossSignals,
  MR_PARAMS, generateMeanReversionSignals,
  BREAKOUT_PARAMS, generateBreakoutSignals,
};
