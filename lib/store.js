"use strict";

const STATE_KEY = "daytrading-lab:state:v1";

function configured() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

async function redisFetch(path, options = {}) {
  const url = `${process.env.UPSTASH_REDIS_REST_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Upstash request failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

function defaultState() {
  return {
    version: "0.1.0",
    createdAt: new Date().toISOString(),
    account: { cash: 10000, equity: 10000, realizedPnl: 0, feesPaid: 0 },
    positions: [],
    closedTrades: [],
  };
}

async function get() {
  if (!configured()) return null;
  const result = await redisFetch(`/get/${encodeURIComponent(STATE_KEY)}`);
  if (!result?.result) return null;
  try {
    return JSON.parse(result.result);
  } catch {
    return null;
  }
}

async function set(state) {
  if (!configured()) throw new Error("Upstash not configured");
  const body = JSON.stringify(state);
  await redisFetch(`/set/${encodeURIComponent(STATE_KEY)}`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body,
  });
}

async function getOrInit() {
  const existing = await get();
  if (existing) return existing;
  const fresh = defaultState();
  await set(fresh);
  return fresh;
}

module.exports = { configured, get, set, getOrInit, defaultState, STATE_KEY };
