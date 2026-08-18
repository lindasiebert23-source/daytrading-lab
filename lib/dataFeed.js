"use strict";

/**
 * Free, no-API-key data sources for crypto OHLC candles.
 * Runs fine on Vercel/GitHub Actions (both have outbound network access).
 */

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

// CoinGecko's free OHLC endpoint returns 4h candles for a 3-30 day window,
// but silently drops to 4-DAY candles beyond that - too coarse for a
// daytrading strategy that needs e.g. EMA200 on hourly bars. Kept here for
// reference/fallback; fetchKlines() below is the primary data source.
async function fetchDailyOhlc(coinId = "bitcoin", vsCurrency = "usd", days = 90) {
  const url = `${COINGECKO_BASE}/coins/${coinId}/ohlc?vs_currency=${vsCurrency}&days=${days}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CoinGecko fetch failed: ${res.status}`);
  const raw = await res.json();

  return raw.map(([time, open, high, low, close]) => ({
    time,
    open,
    high,
    low,
    close,
    volume: null,
  }));
}

// Binance public klines - free, no API key, real intraday candles in
// whatever quantity/interval we need. Binance.com blocks requests from
// US-based IPs (HTTP 451) - Vercel functions often run in US regions by
// default - so we fall back to Binance.US automatically, which mirrors
// the same public klines format.
const BINANCE_HOSTS = ["https://api.binance.com/api/v3", "https://api.binance.us/api/v3"];

const COIN_TO_SYMBOL = {
  bitcoin: "BTCUSDT",
  ethereum: "ETHUSDT",
};

async function fetchKlines(coinId = "bitcoin", interval = "1h", limit = 500) {
  const symbol = COIN_TO_SYMBOL[coinId] || coinId.toUpperCase();
  let lastError;

  for (const base of BINANCE_HOSTS) {
    const url = `${base}/klines?symbol=${symbol}&interval=${interval}&limit=${Math.min(limit, 1000)}`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        lastError = new Error(`Binance fetch failed (${base}): ${res.status}`);
        continue;
      }
      const raw = await res.json();
      return raw.map(row => ({
        time: row[0],
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
      }));
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error("All Binance hosts failed");
}

module.exports = { fetchDailyOhlc, fetchKlines };
