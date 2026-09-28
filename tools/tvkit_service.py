#!/usr/bin/env python3
"""Small read-only HTTP adapter that exposes tvkit to the Mini App.

The browser app already understands quote and time_series responses. This
service translates those requests to tvkit/TradingView and returns the same
small JSON shape without exposing credentials or adding any order capability.
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import sys
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any
from urllib.parse import parse_qs, urlparse


INTERVALS = {
    "1min": ("1", 60_000),
    "5min": ("5", 300_000),
    "15min": ("15", 900_000),
    "1h": ("60", 3_600_000),
    "4h": ("240", 14_400_000),
    "1day": ("1D", 86_400_000),
}

SYMBOLS = {
    "XAU/USD": "OANDA:XAUUSD",
    "XAG/USD": "OANDA:XAGUSD",
    "BTC/USD": "BINANCE:BTCUSDT",
}


def value(item: Any, name: str) -> Any:
    if isinstance(item, dict):
        return item.get(name)
    return getattr(item, name, None)


def timestamp_ms(raw: Any) -> int:
    if isinstance(raw, datetime):
        dt = raw if raw.tzinfo else raw.replace(tzinfo=timezone.utc)
        return int(dt.timestamp() * 1000)
    number = float(raw)
    if not math.isfinite(number):
        raise ValueError("timestamp is not finite")
    return int(round(number * 1000 if abs(number) < 10_000_000_000 else number))


def iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def tv_symbol(symbol: str) -> str:
    normalized = str(symbol or "").strip().upper().replace(" ", "")
    if ":" in normalized:
        return normalized
    if normalized in SYMBOLS:
        return SYMBOLS[normalized]
    if "/" in normalized:
        instrument = normalized.replace("/", "")
        return f"FX_IDC:{instrument}"
    return normalized


def params(query: dict[str, list[str]], key: str, default: str = "") -> str:
    return str(query.get(key, [default])[0] or default).strip()


def response_bar(bar: Any, interval: str, interval_ms: int) -> dict[str, Any]:
    raw_timestamp = value(bar, "timestamp")
    if raw_timestamp is None:
        raise ValueError("tvkit candle has no timestamp")
    ts = timestamp_ms(raw_timestamp)
    result = {
        "datetime": iso(ts),
        "timestamp": ts,
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


async def fetch_time_series(symbol: str, interval: str, outputsize: int) -> dict[str, Any]:
    try:
        from tvkit.api.chart.ohlcv import OHLCV
    except ModuleNotFoundError as error:
        raise RuntimeError("tvkit is not installed; run: python -m pip install tvkit") from error
    tv_interval, interval_ms = INTERVALS[interval]
    provider_symbol = tv_symbol(symbol)
    async with OHLCV() as client:
        bars = await client.get_historical_ohlcv(
            exchange_symbol=provider_symbol,
            interval=tv_interval,
            bars_count=outputsize,
        )
    values = [response_bar(bar, interval, interval_ms) for bar in bars]
    values.sort(key=lambda item: item["timestamp"], reverse=True)
    return {
        "values": values,
        "meta": {
            "provider": "TVKIT",
            "provider_symbol": provider_symbol,
            "interval": interval,
            "timezone": "UTC",
            "raw_count": len(values),
        },
    }


async def fetch_quote(symbol: str) -> dict[str, Any]:
    try:
        from tvkit.api.chart.ohlcv import OHLCV
    except ModuleNotFoundError as error:
        raise RuntimeError("tvkit is not installed; run: python -m pip install tvkit") from error
    provider_symbol = tv_symbol(symbol)
    async with OHLCV() as client:
        async for quote in client.get_quote_data(provider_symbol, interval="1", bars_count=1):
            raw_price = value(quote, "current_price")
            if raw_price is None:
                raw_price = value(quote, "price")
            if raw_price is None:
                continue
            return {
                "price": float(raw_price),
                "timestamp": iso(int(datetime.now(tz=timezone.utc).timestamp() * 1000)),
                "symbol": provider_symbol,
                "provider": "TVKIT",
            }
    raise RuntimeError(f"tvkit returned no quote for {provider_symbol}")


def json_bytes(payload: Any) -> bytes:
    return json.dumps(payload, separators=(",", ":")).encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    server_version = "ict-tvkit-service/1.0"

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
            self.send_json(200, {"ok": True, "provider": "TVKIT"})
            return
        query = parse_qs(parsed.query)
        try:
            symbol = params(query, "symbol")
            if not symbol or len(symbol) > 64:
                raise ValueError("symbol is required")
            if parsed.path == "/quote":
                self.send_json(200, asyncio.run(fetch_quote(symbol)))
                return
            if parsed.path == "/price":
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
            self.send_json(404, {"error": "route not found"})
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
        except Exception as error:  # service reports provider failures as JSON
            self.send_json(502, {"error": str(error)[:500]})

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[tvkit] {self.address_string()} - {format % args}", file=sys.stderr)


def main() -> None:
    host = os.environ.get("TVKIT_HOST", "127.0.0.1")
    port = int(os.environ.get("TVKIT_PORT", "8790"))
    # tvkit opens an async WebSocket connection. On Windows its connection
    # stack is more reliable when asyncio.run executes on the main thread;
    # keep this small provider adapter serial and let the browser reuse its
    # normal request cache/in-flight handling.
    server = HTTPServer((host, port), Handler)
    print(f"tvkit service listening on http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
