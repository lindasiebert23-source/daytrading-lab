# daytrading-lab

Ein eigenständiges, research-first Daytrading-Bot-Projekt (Krypto, Paper-Trading zuerst).
Kein Weiterbau von Future GPT Pro X, aber bewusst an den dortigen Lehren orientiert.

## Warum anders als beim letzten Projekt

Bei Future GPT Pro X kamen zwei strukturelle Probleme heraus:

1. **Kosten-Blindheit**: Ein fester Mindest-Stop von 0,25 % konnte von Gebühren+Slippage
   (0,16 % Round-Trip) zu 64 % aufgefressen werden – unabhängig vom Score-System.
2. **Ungeprüfte Scores**: Mehrere gestapelte, handgewichtete Scores wurden über Live-Paper-Trades
   in kleinen Stichproben (20–50 Trades) nachjustiert, ohne je zu prüfen, ob sie überhaupt
   etwas vorhersagen.

Dieses Projekt behebt beides strukturell, nicht nur als nachträglichen Check:

- `lib/costModel.js` **verweigert** Trades, deren Stop-Distanz die Kosten nicht mit
  mindestens Faktor 4 abdeckt (siehe `MIN_COST_TO_RISK_MULTIPLE`), statt es dem Score
  zu überlassen.
- `lib/strategy.js` verwendet nur 3 einfache, bekannte Indikatoren (EMA-Trend, RSI-Pullback,
  ATR-Stop) statt gestapelter Scores.
- `lib/backtest.js` liefert `sampleSizeWarning: true` für jede Gruppe/jeden Bucket mit
  weniger als 8 Trades – Ergebnisse aus zu kleinen Stichproben sind klar markiert.
- **Walk-Forward-Split**: jeder Backtest trennt In-Sample (erste 70 %) und Out-of-Sample
  (letzte 30 %) automatisch, damit nicht auf denselben Daten "optimiert und bestätigt" wird.

## Ehrlicher Stand

Die Strategie in `lib/strategy.js` ("Trend Pullback") ist eine **Ausgangshypothese, kein
geprüfter Edge**. Ob sie funktioniert, entscheidet der Backtest auf echten Daten – das ist
in dieser Sandbox nicht möglich (kein Netzwerkzugriff hier), funktioniert aber auf
Vercel/GitHub Actions normal. Ein Sanity-Check mit synthetischen Zufallsdaten hat nur
bestätigt, dass die Pipeline (Signal → Entry → Exit → Auswertung) fehlerfrei durchläuft –
das ist eine Aussage über den Code, keine über Profitabilität.

## Architektur

```
lib/indicators.js   EMA, RSI, ATR (schlank, bekannt, keine Scores)
lib/costModel.js    Fee/Slippage-Modell + strukturelle Mindest-Stop-Prüfung
lib/strategy.js     Eine Regel: EMA-Trend-Filter + RSI-Pullback + ATR-Stop
lib/backtest.js     Walk-Forward-Simulation, Kennzahlen, Sample-Size-Warnung
lib/dataFeed.js     Historische Kerzendaten (CoinGecko, kostenlos, kein API-Key)
lib/store.js        Upstash-Redis-Anbindung (REST API)
api/backtest.js     GET /api/backtest?coin=bitcoin&days=180
api/paper-tick.js   GET /api/paper-tick?coin=bitcoin (Cron-geschützt via CRON_SECRET)
api/metrics.js      GET /api/metrics (Research-Auswertung wie bei Future GPT Pro X)
```

## Roadmap (bewusst in dieser Reihenfolge)

1. **Backtest validieren** (`/api/backtest`) auf mehreren Coins/Zeiträumen. Erst wenn
   Out-of-Sample-PF > 1 und `winRateGapPct` positiv sind (und `sampleSizeWarning: false`),
   lohnt sich Schritt 2.
2. **Paper-Trading laufen lassen** (`/api/paper-tick` per Cron) und `/api/metrics`
   regelmäßig prüfen, inkl. Bucket-Analysen.
3. **Erst danach**: TradingView-Anbindung für den Livehandel mit echtem Geld (Pine-Script-
   Alert → Webhook → eigener Broker-Endpoint). Braucht mindestens TradingView Essential-Plan.
   Kein Bestandteil von Phase 1/2.

## Deployment

1. Repo auf GitHub anlegen, diese Dateien pushen.
2. In Vercel importieren, Env-Vars aus `.env.example` setzen (Upstash-Zugangsdaten aus
   deinem Upstash-Dashboard, `CRON_SECRET` frei wählen).
3. In GitHub → Repo-Settings → Secrets: `APP_URL` (deine Vercel-URL) und `CRON_SECRET`
   (identisch zu Vercel) hinterlegen.
4. `vercel.json` enthält bereits einen Cron-Trigger (alle 4h) als Vercel-natives Backup
   zur GitHub-Actions-Variante – beide sind idempotent, doppeltes Ticken schadet nicht.

## Nächste sinnvolle Schritte

- Mehrere Coins/Zeiträume durch `/api/backtest` laufen lassen und die Ergebnisse vergleichen,
  bevor irgendetwas an den Parametern geändert wird.
- Intraday-Daten (statt Daily-Candles) einbauen, sobald die tägliche Version überhaupt
  einen Hinweis auf echten Edge zeigt – siehe Hinweis in `lib/dataFeed.js`.
