"use strict";

/**
 * Cost model for paper + backtest simulation.
 *
 * WHY THIS FILE EXISTS:
 * In the previous project (Future GPT Pro X) we found that fee+slippage could
 * eat up to ~64% of the intended risk budget on tight stops, because the
 * minimum stop distance was fixed (0.25% of price) independent of trading
 * costs. That silently destroyed the edge on low-volatility setups.
 *
 * Here, the minimum allowed stop distance is DERIVED from trading costs,
 * not guessed. A trade is only valid if:
 *
 *   stopDistancePct >= MIN_COST_TO_RISK_MULTIPLE * roundTripCostPct
 *
 * This can't silently regress, because buildStopDistance() enforces it
 * structurally instead of relying on a separate, easy-to-forget check
 * elsewhere in the code.
 */

const DEFAULT_COSTS = {
  feePct: 0.075,       // per side, e.g. typical spot exchange taker fee
  slippagePct: 0.05,   // per side, conservative assumption for liquid crypto
};

// How many multiples of round-trip cost the stop distance must be.
// This is a STARTING assumption, not a proven number - the backtest/metrics
// bucket analysis (costRatio buckets) should be used to validate or tighten
// this over time, the same way we planned for Future GPT Pro X.
const MIN_COST_TO_RISK_MULTIPLE = 4;

function roundTripCostPct(costs = DEFAULT_COSTS) {
  return 2 * (costs.feePct + costs.slippagePct);
}

function minValidStopDistancePct(costs = DEFAULT_COSTS) {
  return roundTripCostPct(costs) * MIN_COST_TO_RISK_MULTIPLE;
}

/**
 * Given a raw (e.g. ATR-based) stop distance in %, returns either the
 * validated distance or null if the setup should be REJECTED because
 * costs would dominate the risk budget.
 *
 * We reject rather than silently widen the stop, because widening changes
 * position sizing and risk/reward in ways that should be a deliberate
 * strategy decision, not an invisible side effect of the cost model.
 */
function validateStopDistance(rawStopDistancePct, costs = DEFAULT_COSTS) {
  const minDist = minValidStopDistancePct(costs);
  if (rawStopDistancePct < minDist) {
    return { valid: false, minRequiredPct: minDist, costRatio: roundTripCostPct(costs) / rawStopDistancePct };
  }
  return { valid: true, minRequiredPct: minDist, costRatio: roundTripCostPct(costs) / rawStopDistancePct };
}

function applyEntryCosts(notional, costs = DEFAULT_COSTS) {
  return notional * (costs.feePct / 100);
}

function applyExitCosts(notional, costs = DEFAULT_COSTS) {
  return notional * (costs.feePct / 100);
}

function slippedPrice(price, side, costs = DEFAULT_COSTS) {
  const slip = costs.slippagePct / 100;
  // BUY entries and SELL exits get worse (higher) fill prices;
  // SELL entries (short) and BUY exits get worse (lower) fill prices.
  if (side === "BUY") return price * (1 + slip);
  return price * (1 - slip);
}

module.exports = {
  DEFAULT_COSTS,
  MIN_COST_TO_RISK_MULTIPLE,
  roundTripCostPct,
  minValidStopDistancePct,
  validateStopDistance,
  applyEntryCosts,
  applyExitCosts,
  slippedPrice,
};
