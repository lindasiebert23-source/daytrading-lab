"use strict";

/**
 * Free, no-API-key data source for crypto OHLC candles.
 * Runs fine on Vercel/GitHub Actions (both have outbound network access).
 * NOTE: this repo's dev sandbox may not have network access when you test
 * locally in some environments - if fetch() fails locally with a network
 * error, that's expected there; it will work once deployed.
 */

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

// CoinGecko's free OHLC endpoint returns 4h candles for a 30-90 day window
// and daily candles beyond that. For real intraday day-trading candles
// (1m/5m/1h) you'll eventually want a dedicated source (e.g. Binance public
// klines API, also free/no-key) - swapped in here once you're ready to move
// past daily/4h research and into real intraday backtesting.
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

module.exports = { fetchDailyOhlc };
