"use strict";

const { ema, rsi, atr, bollingerBands, donchianChannel } = require("./indicators");
const { validateStopDistance, DEFAULT_COSTS } = require("./costModel");

const PARAMS = {
  emaFastPeriod: 50,
  emaSlowPeriod: 200,
  rsiPeriod: 14,
  rsiOversold: 40,
  rsiRecover: 45,
  rsiOverbought: 60,
  rsiFallback: 55,
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
  let wasOverbought = false;
  const diagnostics = {
    barsWithAllIndicators: 0,
    barsInUptrend: 0,
    barsInDowntrend: 0,
    triggerCandidates: 0,
    rejectedByCost: 0,
    signalsAccepted: 0,
    avgAtrPct: 0,
  };
  let atrPctSum = 0;
  let atrPctCount = 0;

  function acceptOrReject(side, entryPrice, stopDistance, target1R, target2R, i) {
    diagnostics.triggerCandidates++;
    const rawStopDistancePct = (stopDistance / entryPrice) * 100;
    const validation = validateStopDistance(rawStopDistancePct, costs);
    if (!validation.valid) {
      diagnostics.rejectedByCost++;
      return;
    }
    diagnostics.signalsAccepted++;
    const sign = side === "LONG" ? 1 : -1;
    signals[i] = {
      side,
      reason: side === "LONG" ? "TREND_PULLBACK" : "TREND_PULLBACK_SHORT",
      entryPrice,
      stopDistance,
      stopDistancePct: rawStopDistancePct,
      stopPrice: entryPrice - sign * stopDistance,
      target1Price: entryPrice + sign * stopDistance * target1R,
      target2Price: entryPrice + sign * stopDistance * target2R,
      costRatio: validation.costRatio,
    };
  }

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
    const downtrend = emaFast[i] < emaSlow[i];
    if (uptrend) diagnostics.barsInUptrend++;
    if (downtrend) diagnostics.barsInDowntrend++;

    if (rsiValues[i] < params.rsiOversold) wasOversold = true;
    if (rsiValues[i] > params.rsiOverbought) wasOverbought = true;

    const triggerLong = wasOversold && rsiValues[i] >= params.rsiRecover;
    const triggerShort = wasOverbought && rsiValues[i] <= params.rsiFallback;

    if (uptrend && triggerLong) {
      const stopDistance = atrValues[i] * params.atrStopMultiple;
      acceptOrReject("LONG", closes[i], stopDistance, params.target1R, params.target2R, i);
      wasOversold = false;
    } else if (downtrend && triggerShort) {
      const stopDistance = atrValues[i] * params.atrStopMultiple;
      acceptOrReject("SHORT", closes[i], stopDistance, params.target1R, params.target2R, i);
      wasOverbought = false;
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
    barsInDowntrend: 0,
    triggerCandidates: 0,
    rejectedByCost: 0,
    signalsAccepted: 0,
    avgAtrPct: 0,
  };
  let atrPctSum = 0;
  let atrPctCount = 0;
  let wasUptrend = false;
  let wasDowntrend = false;

  for (let i = 1; i < candles.length; i++) {
    if (emaFast[i] == null || emaSlow[i] == null || atrValues[i] == null) continue;

    diagnostics.barsWithAllIndicators++;
    atrPctSum += (atrValues[i] / closes[i]) * 100;
    atrPctCount++;

    const uptrend = emaFast[i] > emaSlow[i];
    const downtrend = emaFast[i] < emaSlow[i];
    if (uptrend) diagnostics.barsInUptrend++;
    if (downtrend) diagnostics.barsInDowntrend++;

    const freshCrossUp = uptrend && !wasUptrend;
    const freshCrossDown = downtrend && !wasDowntrend;

    if (freshCrossUp || freshCrossDown) {
      diagnostics.triggerCandidates++;
      const side = freshCrossUp ? "LONG" : "SHORT";
      const sign = side === "LONG" ? 1 : -1;
      const entryPrice = closes[i];
      const rawStopDistance = atrValues[i] * params.atrStopMultiple;
      const rawStopDistancePct = (rawStopDistance / entryPrice) * 100;
      const validation = validateStopDistance(rawStopDistancePct, costs);

      if (validation.valid) {
        diagnostics.signalsAccepted++;
        signals[i] = {
          side,
          reason: side === "LONG" ? "TREND_CROSS" : "TREND_CROSS_SHORT",
          entryPrice,
          stopDistance: rawStopDistance,
          stopDistancePct: rawStopDistancePct,
          stopPrice: entryPrice - sign * rawStopDistance,
          target1Price: entryPrice + sign * rawStopDistance * params.target1R,
          target2Price: entryPrice + sign * rawStopDistance * params.target2R,
          costRatio: validation.costRatio,
        };
      } else {
        diagnostics.rejectedByCost++;
      }
    }
    wasUptrend = uptrend;
    wasDowntrend = downtrend;
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
  const { lower: bbLower, upper: bbUpper } = bollingerBands(closes, params.bbPeriod, params.bbStdDev);

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
      atrValues[i] == null || bbLower[i] == null || bbUpper[i] == null
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
    const overboughtExtreme = closes[i] > bbUpper[i];

    if (sideways && (oversoldExtreme || overboughtExtreme)) {
      diagnostics.triggerCandidates++;
      const side = oversoldExtreme ? "LONG" : "SHORT";
      const sign = side === "LONG" ? 1 : -1;
      const entryPrice = closes[i];
      const rawStopDistance = atrValues[i] * params.atrStopMultiple;
      const rawStopDistancePct = (rawStopDistance / entryPrice) * 100;
      const validation = validateStopDistance(rawStopDistancePct, costs);

      if (validation.valid) {
        diagnostics.signalsAccepted++;
        signals[i] = {
          side,
          reason: side === "LONG" ? "MEAN_REVERSION" : "MEAN_REVERSION_SHORT",
          entryPrice,
          stopDistance: rawStopDistance,
          stopDistancePct: rawStopDistancePct,
          stopPrice: entryPrice - sign * rawStopDistance,
          target1Price: entryPrice + sign * rawStopDistance * params.target1R,
          target2Price: entryPrice + sign * rawStopDistance * params.target2R,
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
  const { upper: donchianUpper, lower: donchianLower } = donchianChannel(highs, lows, params.donchianPeriod);

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
    if (atrValues[i] == null || donchianUpper[i] == null || donchianLower[i] == null) continue;

    diagnostics.barsWithAllIndicators++;
    atrPctSum += (atrValues[i] / closes[i]) * 100;
    atrPctCount++;

    const breakoutUp = closes[i] > donchianUpper[i];
    const breakoutDown = closes[i] < donchianLower[i];

    if (breakoutUp || breakoutDown) {
      diagnostics.triggerCandidates++;
      const side = breakoutUp ? "LONG" : "SHORT";
      const sign = side === "LONG" ? 1 : -1;
      const entryPrice = closes[i];
      const rawStopDistance = atrValues[i] * params.atrStopMultiple;
      const rawStopDistancePct = (rawStopDistance / entryPrice) * 100;
      const validation = validateStopDistance(rawStopDistancePct, costs);

      if (validation.valid) {
        diagnostics.signalsAccepted++;
        signals[i] = {
          side,
          reason: side === "LONG" ? "DONCHIAN_BREAKOUT" : "DONCHIAN_BREAKOUT_SHORT",
          entryPrice,
          stopDistance: rawStopDistance,
          stopDistancePct: rawStopDistancePct,
          stopPrice: entryPrice - sign * rawStopDistance,
          target1Price: entryPrice + sign * rawStopDistance * params.target1R,
          target2Price: entryPrice + sign * rawStopDistance * params.target2R,
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
