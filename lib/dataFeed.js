"use strict";

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

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

const BINANCE_HOSTS = ["https://api.binance.com/api/v3", "https://api.binance.us/api/v3"];

const COIN_TO_SYMBOL = {
  bitcoin: "BTCUSDT",
  ethereum: "ETHUSDT",
};

async function fetchKlinesPage(base, symbol, interval, limit, endTime) {
  let url = `${base}/klines?symbol=${symbol}&interval=${interval}&limit=${Math.min(limit, 1000)}`;
  if (endTime) url += `&endTime=${endTime}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance fetch failed (${base}): ${res.status}`);
  const raw = await res.json();
  return raw.map(row => ({
    time: row[0],
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  }));
}

async function fetchKlines(coinId = "bitcoin", interval = "1h", limit = 500, endTime) {
  const symbol = COIN_TO_SYMBOL[coinId] || coinId.toUpperCase();

  for (const base of BINANCE_HOSTS) {
    try {
      let all = await fetchKlinesPage(base, symbol, interval, Math.min(limit, 1000), endTime);
      while (all.length < limit) {
        const oldestTime = all[0].time;
        const page = await fetchKlinesPage(
          base, symbol, interval, Math.min(limit - all.length, 1000), oldestTime - 1
        );
        if (!page.length) break;
        all = [...page, ...all];
      }
      return all.slice(-limit);
    } catch (err) {
      continue;
    }
  }

  throw new Error("All Binance hosts failed");
}

module.exports = { fetchDailyOhlc, fetchKlines };
