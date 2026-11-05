#!/usr/bin/env python3
"""Read-only HTTP adapter that exposes tvdatafeed-enhanced to the Mini App.

The browser app already understands quote and time_series responses. This
service translates those requests to tvdatafeed-enhanced/TradingView and
returns the same small JSON shape without exposing credentials or adding any
order capability.

The engine was swapped from tvkit to ``tvdatafeed-enhanced`` to remove the
per-request WebSocket latency and improve reliability on Render. The HTTP
contract, the candle schema and the downstream V2.7.2 packet remain unchanged.
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import sys
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

# Query interval -> (tvdatafeed Interval attribute, timeframe duration, bars).
INTERVALS = {
    "1min": ("in_1_minute", 60_000, 50),
    "5min": ("in_5_minute", 300_000, 50),
    "15min": ("in_15_minute", 900_000, 50),
    "1h": ("in_1_hour", 3_600_000, 50),
    "4h": ("in_4_hour", 14_400_000, 30),
    "1day": ("in_daily", 86_400_000, 15),
}

# Canonical pair -> (tvdatafeed symbol, exchange).
PAIRS = {
    "XAU/USD": ("XAUUSD", "OANDA"),
    "EUR/USD": ("EURUSD", "OANDA"),
    "USD/JPY": ("USDJPY", "OANDA"),
    "XAG/USD": ("XAGUSD", "OANDA"),
    "BTC/USD": ("BTCUSDT", "BINANCE"),
}
FIAT_CURRENCY_CODES = {
    "USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD", "HKD",
    "SGD", "NOK", "SEK", "CNH", "CNY", "MXN", "ZAR", "TRY", "PLN",
}
SNAPSHOT_TIMEFRAMES = (
    ("1D", "in_daily", 15),
    ("4H", "in_4_hour", 30),
    ("1H", "in_1_hour", 50),
    ("15M", "in_15_minute", 50),
    ("5M", "in_5_minute", 50),
)
FETCH_ATTEMPTS = 3
FETCH_RETRY_DELAY_SECONDS = 2


def load_env_file() -> None:
    """Load TV_USERNAME/TV_PASSWORD from a local .env when present.

    Render injects the variables directly into the process environment. The
    local Mini App has no dotenv dependency, so this small read-only loader
    keeps the documented username/password fallback working without adding a
    package or committing credentials.
    """
    candidates = [Path(".env"), Path("server") / ".env"]
    for path in candidates:
        if not path.is_file():
            continue
        try:
            for raw_line in path.read_text(encoding="utf-8").splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                if key not in {"TV_USERNAME", "TV_PASSWORD"}:
                    continue
                if os.environ.get(key):
                    continue
                os.environ[key] = value.strip().strip('"').strip("'")
        except OSError:
            continue


def value(item: Any, name: str) -> Any:
    if isinstance(item, dict):
        return item.get(name)
    return getattr(item, name, None)


def timestamp_ms(raw: Any) -> int:
    if isinstance(raw, datetime):
        dt = raw if raw.tzinfo else raw.replace(tzinfo=timezone.utc)
        return int(dt.timestamp() * 1000)
    if isinstance(raw, str):
        value_text = raw.strip()
        if value_text:
            try:
                dt = datetime.fromisoformat(value_text.replace("Z", "+00:00"))
                dt = dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
                return int(dt.timestamp() * 1000)
            except ValueError:
                pass
    number = float(raw)
    if not math.isfinite(number):
        raise ValueError("timestamp is not finite")
    return int(round(number * 1000 if abs(number) < 10_000_000_000 else number))


def iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def normalize_symbol_pair(symbol: str) -> str:
    normalized = str(symbol or "").strip().upper().replace(" ", "")
    if ":" in normalized:
        normalized = normalized.split(":", 1)[1]
    return normalized.replace("-", "/")


def provider_symbol(symbol: str) -> tuple[str, str]:
    """Return ``(tv_symbol, exchange)`` using the documented OANDA mapping."""
    raw = str(symbol or "").strip().upper().replace(" ", "")
    pair = normalize_symbol_pair(raw)
    if pair in PAIRS:
        return PAIRS[pair]
    if ":" in raw:
        exchange, tv_symbol = raw.split(":", 1)
        canonical = normalize_symbol_pair(tv_symbol)
        if canonical in PAIRS:
            return PAIRS[canonical]
        if len(tv_symbol) == 6 and tv_symbol[:3] in FIAT_CURRENCY_CODES and tv_symbol[3:] in FIAT_CURRENCY_CODES:
            return tv_symbol, "OANDA"
        return tv_symbol, exchange
    if "/" in pair:
        instrument = pair.replace("/", "")
        if len(instrument) == 6 and instrument[:3] in FIAT_CURRENCY_CODES and instrument[3:] in FIAT_CURRENCY_CODES:
            return instrument, "OANDA"
        return instrument, "OANDA"
    return pair, "OANDA"


def tv_symbol(symbol: str) -> str:
    """Compatibility helper retained for callers that expect OANDA:XAUUSD."""
    tv_symbol_value, exchange = provider_symbol(symbol)
    return f"{exchange}:{tv_symbol_value}"


def quote_provider_timestamp_ms(quote: Any) -> int | None:
    """Return the timestamp belonging to the provider's last-price update.

    tvdatafeed-enhanced quotes are derived from the latest closed candle, so
    this helper accepts either a candle-like object or a dict with a timestamp.
    Missing provider time is never replaced by local receipt time.
    """
    candidates = [
        value(quote, "timestamp"),
        value(quote, "datetime"),
        value(quote, "last_update"),
        value(quote, "lp_time"),
    ]
    for candidate in candidates:
        if candidate is None:
            continue
        try:
            return timestamp_ms(candidate)
        except (TypeError, ValueError, OverflowError):
            continue
    return None


def params(query: dict[str, list[str]], key: str, default: str = "") -> str:
    return str(query.get(key, [default])[0] or default).strip()


def _interval_enum(interval_name: str) -> Any:
    from tvDatafeed import Interval

    return getattr(Interval, interval_name)


def _create_client() -> Any:
    """Create a tvdatafeed-enhanced client, using credentials when supplied."""
    load_env_file()
    from tvDatafeed import TvDatafeed

    username = str(os.environ.get("TV_USERNAME") or "").strip()
    password = str(os.environ.get("TV_PASSWORD") or "").strip()
    if username and password:
        return TvDatafeed(username, password)
    return TvDatafeed()


def _get_hist(symbol: str, exchange: str, interval: Any, n_bars: int) -> Any:
    client = _create_client()
    return client.get_hist(
        symbol=symbol,
        exchange=exchange,
        interval=interval,
        n_bars=n_bars,
    )


async def fetch_tf(symbol: str, exchange: str, interval: Any, n_bars: int) -> Any:
    """Fetch one timeframe with bounded retries.

    tvdatafeed-enhanced returns ``None`` (or an empty frame) when TradingView
    rejects or drops a session. Render sees that intermittently, so retry up to
    ``FETCH_ATTEMPTS`` times. A missing frame is returned as ``None``; the
    formatting paths turn it into an explicit zero-candle block so the AI never
    mistakes the timeframe for fresh data.
    """
    interval_label = getattr(interval, "name", str(interval))
    for attempt in range(FETCH_ATTEMPTS):
        provider_error = False
        try:
            df = await asyncio.to_thread(_get_hist, symbol, exchange, interval, n_bars)
        except Exception as error:  # provider/socket failures are retryable
            print(
                f"TradingView fetch error for {symbol} {interval_label} "
                f"(attempt {attempt + 1}/{FETCH_ATTEMPTS}): {error}",
                file=sys.stderr,
                flush=True,
            )
            df = None
            provider_error = True
        if df is not None and not df.empty:
            return df
        if not provider_error:
            print(
                f"TradingView returned None for {symbol} {interval_label} "
                f"(attempt {attempt + 1}/{FETCH_ATTEMPTS})",
                file=sys.stderr,
                flush=True,
            )
        if attempt < FETCH_ATTEMPTS - 1:
            await asyncio.sleep(FETCH_RETRY_DELAY_SECONDS)
    return None


async def fetch_all(symbol: str, exchange: str) -> list[Any]:
    """Fetch the five scan timeframes concurrently.

    Returns the DataFrames in ``SNAPSHOT_TIMEFRAMES`` order: 1D, 4H, 1H, 15M,
    5M. This is the latency fix: one concurrent batch instead of five serial
    TradingView sessions.
    """
    tasks = []
    for _tf_name, interval_name, n_bars in SNAPSHOT_TIMEFRAMES:
        tasks.append(fetch_tf(symbol, exchange, _interval_enum(interval_name), n_bars))
    return list(await asyncio.gather(*tasks))


def strip_timezone(df: Any) -> Any:
    if df is None or df.empty:
        return df
    try:
        df.index = df.index.tz_localize(None)
    except (AttributeError, TypeError):
        df.index = df.index.tz_convert("UTC").tz_localize(None)
    return df


def format_df_to_csv(df: Any, tf_name: str, limit: int) -> str:
    if df is None or df.empty:
        return "\n".join([
            f"======== TIMEFRAME: {tf_name.lower()} ========",
            "CANDLE_COUNT=0",
            f"CANDLE_LIMIT={limit}",
            "CANDLE_POLICY=CLOSED_ONLY",
            "DATA_STATUS=UNAVAILABLE",
            f"======== END {tf_name.lower()} ========",
            "",
        ])

    # Strip timezone to ensure raw string formatting.
    df = strip_timezone(df)

    lines = [f"======== TIMEFRAME: {tf_name.lower()} ========"]
    lines.append(f"CANDLE_COUNT={len(df)}")
    lines.append(f"CANDLE_LIMIT={limit}")
    lines.append("CANDLE_POLICY=CLOSED_ONLY")
    lines.append("FORMAT: time,open,high,low,close,volume")

    for index, row in df.iterrows():
        time_str = index.strftime("%Y-%m-%dT%H:%M:%S.000Z")
        lines.append(f"{time_str},{row['open']},{row['high']},{row['low']},{row['close']},{row['volume']}")

    lines.append(f"======== END {tf_name.lower()} ========\n")
    return "\n".join(lines)


def response_bar(bar: Any, interval: str, interval_ms: int) -> dict[str, Any]:
    raw_timestamp = value(bar, "timestamp")
    if raw_timestamp is None:
        raise ValueError("candle has no timestamp")
    ts = timestamp_ms(raw_timestamp)
    result = {
        "datetime": iso(ts),
        "timestamp": ts,
        "provider_timestamp": ts,
        "open_time": iso(ts),
        "close_time": iso(ts + interval_ms),
        "timestamp_semantics": "OPEN",
        "open": float(value(bar, "open")),
        "high": float(value(bar, "high")),
        "low": float(value(bar, "low")),
        "close": float(value(bar, "close")),
        "volume": None,
    }
    raw_volume = value(bar, "volume")
    if raw_volume is not None:
        try:
            result["volume"] = float(raw_volume)
        except (TypeError, ValueError):
            pass
    result["is_closed"] = ts + interval_ms <= int(datetime.now(tz=timezone.utc).timestamp() * 1000)
    return result


def dataframe_bars(df: Any, interval: str, interval_ms: int) -> list[dict[str, Any]]:
    if df is None or df.empty:
        return []
    df = strip_timezone(df)
    bars = []
    for index, row in df.iterrows():
        bars.append(response_bar(
            {
                "timestamp": index,
                "open": row["open"],
                "high": row["high"],
                "low": row["low"],
                "close": row["close"],
                "volume": row.get("volume"),
            },
            interval,
            interval_ms,
        ))
    bars.sort(key=lambda item: item["timestamp"], reverse=True)
    return bars


def quote_market_fields(quote: Any) -> dict[str, Any]:
    """Return safe provider quote facts without account/session credentials."""
    info = value(quote, "symbol_info")
    if not isinstance(info, dict):
        info = value(quote, "quote_data")
    info = info if isinstance(info, dict) else {}

    def finite_number(*names: str) -> float | None:
        for name in names:
            raw = info.get(name)
            if raw is None:
                continue
            try:
                number = float(raw)
            except (TypeError, ValueError):
                continue
            if math.isfinite(number) and number > 0:
                return number
        return None

    safe_metadata_keys = (
        "exchange", "listed_exchange", "type", "currency_code", "timezone",
        "session", "current_session", "market_status", "pricescale", "minmov",
        "minmove2", "fractional",
    )
    metadata = {key: info[key] for key in safe_metadata_keys if info.get(key) is not None}
    bid = finite_number("bid", "bid_price")
    ask = finite_number("ask", "ask_price")
    return {
        "bid": bid,
        "ask": ask,
        "spread": ask - bid if bid is not None and ask is not None and ask >= bid else None,
        "tradeable": info.get("tradeable") if isinstance(info.get("tradeable"), bool) else None,
        "market_status": info.get("market_status") or info.get("current_session"),
        "symbol_metadata": metadata,
    }


def latest_closed_bar(df: Any, interval_ms: int) -> dict[str, Any] | None:
    if df is None or df.empty:
        return None
    df = strip_timezone(df)
    now_ms = int(datetime.now(tz=timezone.utc).timestamp() * 1000)
    closed = [index for index in df.index if timestamp_ms(index) + interval_ms <= now_ms]
    index = closed[-1] if closed else df.index[-1]
    row = df.loc[index]
    return {
        "timestamp": timestamp_ms(index),
        "open": row["open"],
        "high": row["high"],
        "low": row["low"],
        "close": row["close"],
        "volume": row.get("volume"),
    }


async def fetch_time_series(symbol: str, interval: str, outputsize: int) -> dict[str, Any]:
    interval_name, interval_ms, _default_bars = INTERVALS[interval]
    tv_symbol_value, exchange = provider_symbol(symbol)
    df = await fetch_tf(tv_symbol_value, exchange, _interval_enum(interval_name), outputsize)
    values = dataframe_bars(df, interval, interval_ms)
    return {
        "values": values,
        "meta": {
            "provider": "TVKIT",
            "engine": "tvdatafeed-enhanced",
            "provider_symbol": f"{exchange}:{tv_symbol_value}",
            "exchange": exchange,
            "interval": interval,
            "timezone": "UTC",
            "timestamp_semantics": "OPEN",
            "timestamp_unit": "MILLISECONDS",
            "bar_time_meaning": "BAR_OPEN_TIME",
            "interval_ms": interval_ms,
            "fetched_at": iso(int(datetime.now(tz=timezone.utc).timestamp() * 1000)),
            "raw_count": len(values),
            "data_status": "OK" if values else "UNAVAILABLE",
        },
    }


async def fetch_snapshot(symbol: str) -> dict[str, Any]:
    """One concurrent batch for all five scan timeframes."""
    tv_symbol_value, exchange = provider_symbol(symbol)
    frames = await fetch_all(tv_symbol_value, exchange)
    timeframes = {}
    csv_blocks = {}
    for (tf_name, _interval_name, limit), df in zip(SNAPSHOT_TIMEFRAMES, frames):
        interval_key = {
            "1D": "1day", "4H": "4h", "1H": "1h", "15M": "15min", "5M": "5min",
        }[tf_name]
        interval_ms = INTERVALS[interval_key][1]
        timeframes[tf_name] = {
            "values": dataframe_bars(df, interval_key, interval_ms),
            "meta": {
                "provider": "TVKIT",
                "engine": "tvdatafeed-enhanced",
                "provider_symbol": f"{exchange}:{tv_symbol_value}",
                "exchange": exchange,
                "timeframe": tf_name,
                "interval": interval_key,
                "interval_ms": interval_ms,
                "raw_count": 0 if df is None or df.empty else len(df),
                "data_status": "UNAVAILABLE" if df is None or df.empty else "OK",
            },
        }
        csv_blocks[tf_name] = format_df_to_csv(df, tf_name, limit)
    return {
        "provider": "TVKIT",
        "engine": "tvdatafeed-enhanced",
        "symbol": f"{exchange}:{tv_symbol_value}",
        "exchange": exchange,
        "timeframes": timeframes,
        "csv_blocks": csv_blocks,
    }


async def fetch_quote(symbol: str) -> dict[str, Any]:
    tv_symbol_value, exchange = provider_symbol(symbol)
    df = await fetch_tf(tv_symbol_value, exchange, _interval_enum("in_5_minute"), 2)
    bar = latest_closed_bar(df, INTERVALS["5min"][1])
    if bar is None:
        raise RuntimeError(
            f"TradingView returned no 5min data for {exchange}:{tv_symbol_value} "
            f"after {FETCH_ATTEMPTS} attempts"
        )
    ts = bar["timestamp"]
    return {
        "price": float(bar["close"]),
        "timestamp": iso(ts),
        "symbol": f"{exchange}:{tv_symbol_value}",
        "provider": "TVKIT",
        "engine": "tvdatafeed-enhanced",
        "bid": None,
        "ask": None,
        "spread": None,
        "tradeable": None,
        "market_status": None,
        "symbol_metadata": {"exchange": exchange, "timezone": "Etc/UTC"},
    }


def json_bytes(payload: Any) -> bytes:
    return json.dumps(payload, separators=(",", ":")).encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    server_version = "ict-tvdatafeed-service/2.0"

    def send_json(self, status: int, payload: Any) -> None:
        body = json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            self.send_json(200, {"ok": True, "provider": "TVKIT", "engine": "tvdatafeed-enhanced"})
            return
        query = parse_qs(parsed.query)
        try:
            symbol = params(query, "symbol")
            if not symbol or len(symbol) > 64:
                raise ValueError("symbol is required")
            if parsed.path in ("/quote", "/price"):
                self.send_json(200, asyncio.run(fetch_quote(symbol)))
                return
            if parsed.path == "/time_series":
                interval = params(query, "interval").lower()
                if interval not in INTERVALS:
                    raise ValueError("interval is unsupported")
                outputsize = int(params(query, "outputsize", "200"))
                if outputsize < 20 or outputsize > 5000:
                    raise ValueError("outputsize is invalid")
                self.send_json(200, asyncio.run(fetch_time_series(symbol, interval, outputsize)))
                return
            if parsed.path == "/snapshot":
                self.send_json(200, asyncio.run(fetch_snapshot(symbol)))
                return
            self.send_json(404, {"error": "route not found"})
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
        except Exception as error:  # service reports provider failures as JSON
            self.send_json(502, {"error": str(error)[:500]})

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[tvdatafeed] {self.address_string()} - {format % args}", file=sys.stderr)


def verify_provider_import() -> None:
    """Fail fast with a clear log if tvdatafeed-enhanced cannot be imported.

    The package declares ``websockets`` but its code imports ``websocket``
    (websocket-client). Without that explicit dependency the lazy per-request
    import raises ModuleNotFoundError and every market query returns 502.
    """
    try:
        from tvDatafeed import Interval, TvDatafeed  # noqa: F401
    except Exception as error:
        print(
            f"FATAL: tvdatafeed-enhanced import failed: {error}. "
            "Install its dependencies with: python -m pip install -r requirements-render.txt",
            file=sys.stderr,
            flush=True,
        )
        raise
    print("tvdatafeed-enhanced import OK", file=sys.stderr, flush=True)


def main() -> None:
    load_env_file()
    verify_provider_import()
    host = os.environ.get("TVKIT_HOST", "0.0.0.0")
    port = int(os.environ.get("TVKIT_PORT", "8790"))
    # ThreadingHTTPServer lets the five scan requests run concurrently while
    # each tvdatafeed-enhanced call executes in its own worker thread. This is
    # the latency fix requested for Render; the old serial server forced every
    # TradingView session to wait for the previous one.
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"tvdatafeed-enhanced service listening on http://{host}:{port}", flush=True)
    print(f"Python TVDatafeed service running on port {port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
