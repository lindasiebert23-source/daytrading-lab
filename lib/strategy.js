"use strict";

const { ema, rsi, atr } = require("./indicators");
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
