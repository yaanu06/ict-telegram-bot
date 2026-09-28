#!/usr/bin/env python3
"""Fetch TradingView candles through tvkit for comparison and diagnostics.

The production Mini App can use the same tvkit source through
``tools/tvkit_service.py``. This utility remains read-only and never sends
orders or changes the bot.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


TIMEFRAMES = {
    "1D": ("1D", 86_400_000),
    "4H": ("240", 14_400_000),
    "1H": ("60", 3_600_000),
    "15M": ("15", 900_000),
    "5M": ("5", 300_000),
}

DEFAULT_SYMBOLS = {
    "XAU/USD": "OANDA:XAUUSD",
    "EUR/USD": "FX_IDC:EURUSD",
    "AUD/USD": "FX_IDC:AUDUSD",
    "GBP/USD": "FX_IDC:GBPUSD",
    "USD/JPY": "FX_IDC:USDJPY",
    "NZD/USD": "FX_IDC:NZDUSD",
}


def normalize_pair(value: str) -> str:
    return str(value or "").strip().upper().replace("-", "/").replace(" ", "")


def to_milliseconds(value: Any) -> int:
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("timestamp is not finite")
    return int(round(number * 1000 if abs(number) < 10_000_000_000 else number))


def bar_value(bar: Any, name: str) -> Any:
    if isinstance(bar, dict):
        return bar.get(name)
    return getattr(bar, name, None)


def normalize_bar(bar: Any, timeframe: str, captured_at_ms: int) -> dict[str, Any]:
    timestamp = bar_value(bar, "timestamp")
    if timestamp is None:
        raise ValueError(f"{timeframe} bar has no timestamp")
    result = {
        "t": to_milliseconds(timestamp),
        "o": float(bar_value(bar, "open")),
        "h": float(bar_value(bar, "high")),
        "l": float(bar_value(bar, "low")),
        "c": float(bar_value(bar, "close")),
        "v": None,
        "timeframe": timeframe,
        "source": "TRADINGVIEW_TVKIT",
        "timestamp_source": "PROVIDER",
    }
    volume = bar_value(bar, "volume")
    if volume is not None:
        try:
            result["v"] = float(volume)
        except (TypeError, ValueError):
            result["v"] = None
    interval_ms = TIMEFRAMES[timeframe][1]
    # This deliberately uses a conservative closed-candle rule. Daily bars
    # can be session buckets, so a full interval must have elapsed before a
    # bar is admitted to the comparison snapshot.
    result["is_closed"] = result["t"] + interval_ms <= captured_at_ms
    return result


def normalize_history(bars: list[Any], timeframe: str, captured_at_ms: int) -> list[dict[str, Any]]:
    normalized = [normalize_bar(bar, timeframe, captured_at_ms) for bar in bars]
    normalized.sort(key=lambda bar: bar["t"])
    unique: dict[int, dict[str, Any]] = {}
    for bar in normalized:
        if not all(math.isfinite(bar[field]) for field in ("o", "h", "l", "c")):
            raise ValueError(f"{timeframe} bar contains a non-finite OHLC value")
        if bar["h"] < max(bar["o"], bar["c"]) or bar["l"] > min(bar["o"], bar["c"]) or bar["h"] < bar["l"]:
            raise ValueError(f"{timeframe} bar contains impossible OHLC geometry")
        unique[bar["t"]] = bar
    return [bar for bar in unique.values() if bar["is_closed"]]


def iso_time(timestamp_ms: int | None) -> str | None:
    if timestamp_ms is None:
        return None
    return datetime.fromtimestamp(timestamp_ms / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")


async def fetch_snapshot(pair: str, tv_symbol: str, bars_count: int) -> dict[str, Any]:
    try:
        from tvkit.api.chart.ohlcv import OHLCV
    except ModuleNotFoundError as error:
        raise RuntimeError("tvkit is not installed; install it with: pip install tvkit") from error

    captured_at_ms = int(datetime.now(tz=timezone.utc).timestamp() * 1000)
    history: dict[str, list[dict[str, Any]]] = {}
    provider_metadata: dict[str, dict[str, Any]] = {}

    async with OHLCV() as client:
        for timeframe, (interval, _) in TIMEFRAMES.items():
            bars = await client.get_historical_ohlcv(
                exchange_symbol=tv_symbol,
                interval=interval,
                bars_count=bars_count,
            )
            closed = normalize_history(list(bars), timeframe, captured_at_ms)
            if not closed:
                raise RuntimeError(f"TradingView returned no closed {timeframe} candles for {tv_symbol}")
            history[timeframe] = closed
            provider_metadata[timeframe] = {
                "provider": "TRADINGVIEW_TVKIT",
                "symbol": tv_symbol,
                "timeframe": timeframe,
                "interval": interval,
                "raw_count": len(bars),
                "closed_count": len(closed),
                "open_candles_filtered": len(bars) - len(closed),
                "timestamp_contract": "UNIX_SECONDS_CONVERTED_TO_MS",
            }

        quote_price = None
        quote_error = None
        try:
            async for quote in client.get_quote_data(tv_symbol, interval="1", bars_count=1):
                quote_price = getattr(quote, "current_price", None)
                if quote_price is None and isinstance(quote, dict):
                    quote_price = quote.get("current_price") or quote.get("price")
                if quote_price is not None:
                    quote_price = float(quote_price)
                    break
        except Exception as error:  # quote fallback must not discard usable history
            quote_error = str(error)[:300]

    latest = history["5M"][-1]
    quote = {
        "price": quote_price if quote_price is not None else latest["c"],
        "quote_time": iso_time(captured_at_ms if quote_price is not None else latest["t"]),
        "quote_source": "TRADINGVIEW_QUOTE" if quote_price is not None else "CLOSED_CANDLE_CLOSE_FALLBACK",
    }
    if quote_error:
        quote["quote_error"] = quote_error
    return {
        "schema_version": 1,
        "provider": "TRADINGVIEW_TVKIT",
        "pair": pair,
        "provider_symbol": tv_symbol,
        "captured_at": iso_time(captured_at_ms),
        "quote": quote,
        "history": history,
        "provider_metadata": provider_metadata,
        "notes": [
            "Read-only TradingView/tvkit comparison snapshot; no orders are sent.",
            "Closed candles are filtered conservatively from TradingView timestamps.",
            "Provider differences are diagnostic evidence, not proof that either feed is correct.",
        ],
    }


def replay_history(replay: dict[str, Any], timeframe: str) -> list[dict[str, Any]] | None:
    value = replay.get("history", {}).get(timeframe, [])
    if isinstance(value, dict):
        # The Mini App's compact diagnostic export stores only counts and
        # boundary timestamps. It cannot support OHLC comparison.
        value = value.get("candles")
        if value is None:
            return None
    return [bar for bar in value if isinstance(bar, dict) and all(key in bar for key in ("t", "o", "h", "l", "c"))]


def compare_histories(twelve_replay: dict[str, Any], tv_snapshot: dict[str, Any]) -> dict[str, Any]:
    comparison: dict[str, Any] = {}
    for timeframe in TIMEFRAMES:
        twelve = replay_history(twelve_replay, timeframe)
        tradingview = tv_snapshot.get("history", {}).get(timeframe, [])
        source_history = twelve_replay.get("history", {}).get(timeframe, [])
        if twelve is None:
            comparison[timeframe] = {
                "comparison_status": "SUMMARY_ONLY",
                "twelve_data_count": source_history.get("count") if isinstance(source_history, dict) else None,
                "twelve_first_closed": source_history.get("first_closed") if isinstance(source_history, dict) else None,
                "twelve_last_closed": source_history.get("last_closed") if isinstance(source_history, dict) else None,
                "tradingview_count": len(tradingview),
                "tradingview_first_closed": tradingview[0]["t"] if tradingview else None,
                "tradingview_last_closed": tradingview[-1]["t"] if tradingview else None,
                "exact_timestamp_matches": None,
                "note": "The supplied replay file contains boundaries only; provide full candle arrays for OHLC comparison.",
            }
            continue
        tv_by_time = {int(bar["t"]): bar for bar in tradingview}
        matched = []
        for bar in twelve:
            timestamp = int(bar["t"])
            candidate = tv_by_time.get(timestamp)
            if candidate is None:
                continue
            differences = {
                field: abs(float(bar[field]) - float(candidate[field]))
                for field in ("o", "h", "l", "c")
            }
            matched.append({"t": timestamp, "ohlc_abs_difference": differences})
        max_difference = max(
            (difference for item in matched for difference in item["ohlc_abs_difference"].values()),
            default=0,
        )
        comparison[timeframe] = {
            "comparison_status": "FULL_CANDLE_DATA",
            "twelve_data_count": len(twelve),
            "tradingview_count": len(tradingview),
            "exact_timestamp_matches": len(matched),
            "twelve_only_count": max(0, len(twelve) - len(matched)),
            "tradingview_only_count": max(0, len(tradingview) - len(matched)),
            "max_ohlc_absolute_difference": max_difference,
            "latest_twelve_timestamp": twelve[-1]["t"] if twelve else None,
            "latest_tradingview_timestamp": tradingview[-1]["t"] if tradingview else None,
        }
    return comparison


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pair", required=True, help="Bot pair, for example XAU/USD or EUR/USD")
    parser.add_argument("--tv-symbol", help="TradingView symbol override, for example OANDA:XAUUSD")
    parser.add_argument("--bars", type=int, default=200, help="Historical bars per timeframe (default: 200)")
    parser.add_argument("--output", type=Path, help="Write the tvkit snapshot JSON to this file")
    parser.add_argument("--compare", type=Path, help="Compare timestamps/OHLC against a saved Twelve Data replay JSON")
    return parser.parse_args()


async def async_main(args: argparse.Namespace) -> int:
    pair = normalize_pair(args.pair)
    if not pair or "/" not in pair:
        raise ValueError("--pair must look like EUR/USD")
    if args.bars < 20 or args.bars > 5000:
        raise ValueError("--bars must be between 20 and 5000")
    tv_symbol = args.tv_symbol or DEFAULT_SYMBOLS.get(pair)
    if not tv_symbol:
        raise ValueError(f"No default TradingView symbol for {pair}; provide --tv-symbol")
    snapshot = await fetch_snapshot(pair, tv_symbol, args.bars)
    if args.compare:
        with args.compare.open("r", encoding="utf-8") as handle:
            snapshot["comparison_to_twelve_data_replay"] = compare_histories(json.load(handle), snapshot)
    encoded = json.dumps(snapshot, indent=2, sort_keys=False)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded + "\n", encoding="utf-8")
        print(f"Wrote tvkit shadow snapshot: {args.output}")
    else:
        print(encoded)
    return 0


def main() -> int:
    try:
        return asyncio.run(async_main(parse_args()))
    except KeyboardInterrupt:
        return 130
    except Exception as error:
        print(f"tvkit shadow fetch failed: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
