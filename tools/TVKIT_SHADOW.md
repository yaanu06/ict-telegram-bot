# tvkit shadow comparison

The Mini App now uses TradingView/tvkit as its default market-data provider.
The `tvkit_shadow.py` utility remains useful for diagnostics: it fetches the
same basic closed-candle shape used by the bot so feeds can be compared without
changing Analyze or the Telegram UI.

## Install

Use Python 3.11+ and install the external library in your own environment:

```powershell
python -m pip install tvkit
```

The repository does not store TradingView credentials. Anonymous tvkit access
works for its normal limits; tvkit also supports its own `TVKIT_BROWSER` or
`TVKIT_AUTH_TOKEN` configuration when needed.

## Fetch a shadow snapshot

```powershell
python tools/tvkit_shadow.py --pair XAU/USD --output data/tvkit-shadow/xauusd.json
python tools/tvkit_shadow.py --pair EUR/USD --output data/tvkit-shadow/eurusd.json
```

Default symbol mappings are:

| Bot pair | TradingView symbol |
| --- | --- |
| XAU/USD | `OANDA:XAUUSD` |
| EUR/USD | `FX_IDC:EURUSD` |
| AUD/USD | `FX_IDC:AUDUSD` |

Use `--tv-symbol` when a different TradingView feed is required.

The utility fetches only the production analysis timeframes: `1D`, `4H`,
`1H`, `15M`, and `5M`. It does not add `1W` and it never places orders.

## Compare with a Twelve Data replay

```powershell
python tools/tvkit_shadow.py --pair XAU/USD `
  --compare path\to\twelve-data-replay.json `
  --output data/tvkit-shadow/xauusd-comparison.json
```

The comparison reports candle counts, exact timestamp matches, provider-only
candles, and OHLC differences for each timeframe. The compact diagnostic JSON
copied from the Mini App contains only history counts and boundary timestamps;
the tool labels that input `SUMMARY_ONLY` and compares boundaries only. Full
OHLC comparison requires a replay object containing the candle arrays. Different
feeds can produce different valid candles; the report is diagnostic evidence,
not an automatic instruction to switch providers.
