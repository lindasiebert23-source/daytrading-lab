"use strict";

const { generateSignals } = require("./strategy");
const { applyEntryCosts, applyExitCosts, slippedPrice, DEFAULT_COSTS } = require("./costModel");

const MIN_RELIABLE_TRADES = 8;

function simulate(candles, { riskPct = 1, startEquity = 10000 } = {}, costs = DEFAULT_COSTS, strategyParams) {
  const { signals, diagnostics } = generateSignals(candles, strategyParams, costs);
  const trades = [];
  let equity = startEquity;
  let position = null;

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
          ex
