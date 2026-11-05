# tvdatafeed-enhanced market-data service

The Mini App uses `TradingView/tvdatafeed-enhanced` as its default market-data
provider. The browser cannot import the Python package directly, so this small
read-only service exposes the quote and candle endpoints the app already uses.
The provider id and HTTP contract remain `TVKIT` so the V2.7.2 packet, JSON
schema and parser are unchanged; only the ingestion engine was swapped.

## Start it

```powershell
python tools/tvkit_service.py
```

The default address is `http://127.0.0.1:8790`. The service supports the app's
`1D`, `4H`, `1H`, `15M`, and `5M` scan data and has no broker, order, or
execution endpoint.

## Authentication

Anonymous access is used by default:

```python
TvDatafeed()
```

If `TV_USERNAME` and `TV_PASSWORD` exist in the process environment or in a
local `.env` / `server/.env`, the service falls back to:

```python
TvDatafeed(username, password)
```

Never commit the populated `.env` file.

## Endpoints

- `GET /health`
- `GET /quote?symbol=OANDA%3AXAUUSD`
- `GET /time_series?symbol=OANDA%3AXAUUSD&interval=1h&outputsize=200`
- `GET /snapshot?symbol=OANDA%3AXAUUSD` — one concurrent batch for the five scan
  timeframes, including the exact `Y-M-DTH:M:S.000Z` CSV blocks.

`/snapshot` uses `asyncio.to_thread` + `asyncio.gather` to fetch all five
timeframes simultaneously. The browser scan requests the same timeframes in
parallel, so the old serial TVKit wait chain is gone.

## Symbol mapping

| Bot pair | tvdatafeed symbol | exchange |
| --- | --- | --- |
| `XAU/USD` | `XAUUSD` | `OANDA` |
| `EUR/USD` | `EURUSD` | `OANDA` |
| `USD/JPY` | `USDJPY` | `OANDA` |

Provider symbols such as `FX_IDC:EURUSD` are normalized to the same OANDA
mapping before the call.

## Connect the Mini App

In the browser console, run:

```js
setMarketDataProvider('TVKIT', 'http://127.0.0.1:8790')
```

Reload the Mini App after changing the provider. The app uses one provider for
the quote and all five histories in a scan; it does not silently mix
tvdatafeed-enhanced and Twelve Data candles.

## Optional Twelve Data fallback

Twelve Data credentials and routes remain in the app and proxy. To explicitly
select them later:

```js
setMarketDataProvider('TWELVE_DATA')
```

That selection uses the existing Twelve Data key or `/api/twelve/*` proxy. It
does not remove or alter any Twelve Data credential handling.
