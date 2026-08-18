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
  const raw = await res.json(); // [[timestamp, open, high, low, close], ...]

  return raw.map(([time, open, high, low, close]) => ({
    time,
    open,
    high,
    low,
    close,
    volume: null, // this endpoint doesn't include volume
  }));
}

// Binance public klines - free, no API key, real intraday candles in
// whatever quantity/interval we need. This is the primary data source now.
const BINANCE_BASE = "https://api.binance.com/api/v3";

const COIN_TO_SYMBOL = {
  bitcoin: "BTCUSDT",
  ethereum: "ETHUSDT",
};

async function fetchKlines(coinId = "bitcoin", interval = "1h", limit = 500) {
  const symbol = COIN_TO_SYMBOL[coinId] || coinId.toUpperCase();
  const url = `${BINANCE_BASE}/klines?symbol=${symbol}&interval=${interval}&limit=${Math.min(limit, 1000)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance fetch failed: ${res.status}`);
  const raw = await res.json();
  // [openTime, open, high, low, close, volume, closeTime, ...]
  return raw.map(row => ({
    time: row[0],
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  }));
}

module.exports = { fetchDailyOhlc, fetchKlines };
