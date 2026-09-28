# tvkit market-data service

The Mini App uses `TradingView/tvkit` as its default market-data provider. The
browser cannot import the Python package directly, so this small read-only
service exposes the quote and candle endpoints the app already uses.

## Start it

```powershell
python tools/tvkit_service.py
```

The default address is `http://127.0.0.1:8790`. The service uses the tvkit
package and supports the app's `1D`, `4H`, `1H`, `15M`, and `5M` scan data.
It has no broker, order, or execution endpoint.

If tvkit requires a TradingView browser or authentication setting in your
environment, configure the documented `TVKIT_*` environment variables before
starting the service.

## Connect the Mini App

In the browser console, run:

```js
setMarketDataProvider('TVKIT', 'http://127.0.0.1:8790')
```

Reload the Mini App after changing the provider. The app uses one provider for
the quote and all five histories in a scan; it does not silently mix tvkit and
Twelve Data candles.

## Optional Twelve Data fallback

Twelve Data credentials and routes remain in the app and proxy. To explicitly
select them later:

```js
setMarketDataProvider('TWELVE_DATA')
```

That selection uses the existing Twelve Data key or `/api/twelve/*` proxy. It
does not remove or alter any Twelve Data credential handling.
