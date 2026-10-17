"""Acquire reproducible deep history from Dukascopy's public candle feed.

The feed exposes one LZMA-compressed BID candle artifact per instrument/day.
Artifacts are cached individually so interrupted downloads can be resumed.
The raw minute records are normalized and aggregated to UTC-aligned 5-minute
bars without interpolating gaps.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import lzma
import math
import struct
import time
import urllib.error
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from pathlib import Path


INSTRUMENTS = {"AUD/USD": "AUDUSD", "GBP/JPY": "GBPJPY", "XAU/USD": "XAUUSD"}
PRICE_SCALES = {"AUDUSD": 100000, "GBPJPY": 1000, "XAUUSD": 1000}
RECORD_SIZE = 24
INTERVAL_MS = 300000
FEED_ROOT = "https://datafeed.dukascopy.com/datafeed"


def parse_day(value: str) -> date:
    return date.fromisoformat(value)


def instrument_id(symbol: str) -> str:
    key = symbol.upper().replace(" ", "")
    if key in INSTRUMENTS:
        return INSTRUMENTS[key]
    compact = key.replace("/", "")
    if compact in PRICE_SCALES:
        return compact
    raise ValueError(f"Unsupported Dukascopy symbol: {symbol}")


def artifact_url(instrument: str, day: date, price_type: str = "BID") -> str:
    return f"{FEED_ROOT}/{instrument}/{day.year:04d}/{day.month - 1:02d}/{day.day:02d}/{price_type}_candles_min_1.bi5"


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def request_bytes(url: str, retries: int, retry_pause: float, timeout: float) -> tuple[bytes | None, str]:
    request = urllib.request.Request(url, headers={"User-Agent": "ict-telegram-bot-deep-history/1.0"})
    last_error = ""
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload = response.read()
            if not payload:
                return None, "empty_response"
            return payload, "downloaded"
        except urllib.error.HTTPError as error:
            last_error = f"http_{error.code}"
            if error.code in {404, 410}:
                return None, last_error
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            last_error = type(error).__name__
        if attempt < retries:
            time.sleep(retry_pause * (attempt + 1))
    return None, last_error or "download_failed"


def decode_artifact(payload: bytes, day: date, instrument: str) -> list[dict]:
    decoded = lzma.decompress(payload)
    if len(decoded) % RECORD_SIZE:
        raise ValueError(f"{instrument} {day}: decoded size is not a multiple of {RECORD_SIZE}")
    scale = PRICE_SCALES[instrument]
    day_start_ms = int(datetime(day.year, day.month, day.day, tzinfo=timezone.utc).timestamp() * 1000)
    bars = []
    for offset in range(0, len(decoded), RECORD_SIZE):
        # Dukascopy candle records are: offset, open, close, low, high, volume.
        seconds, open_raw, close_raw, low_raw, high_raw, volume_raw = struct.unpack(">IIIIII", decoded[offset : offset + RECORD_SIZE])
        timestamp = day_start_ms + seconds * 1000
        values = [open_raw / scale, high_raw / scale, low_raw / scale, close_raw / scale]
        if not all(math.isfinite(value) and value > 0 for value in values):
            raise ValueError(f"{instrument} {day}: invalid decoded price")
        bars.append({"timestamp": timestamp, "open": values[0], "high": values[1], "low": values[2], "close": values[3], "volume": struct.unpack(">f", struct.pack(">I", volume_raw))[0]})
    return bars


def aggregate_5m(minute_bars: list[dict]) -> list[dict]:
    groups: dict[int, list[dict]] = defaultdict(list)
    for bar in sorted(minute_bars, key=lambda item: item["timestamp"]):
        groups[(bar["timestamp"] // INTERVAL_MS) * INTERVAL_MS].append(bar)
    result = []
    for timestamp, group in sorted(groups.items()):
        result.append({
            "timestamp": timestamp,
            "datetime": datetime.fromtimestamp(timestamp / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z"),
            "open": group[0]["open"],
            "high": max(item["high"] for item in group),
            "low": min(item["low"] for item in group),
            "close": group[-1]["close"],
            "volume": sum(item["volume"] for item in group),
            "is_closed": True,
            "close_time_ms": timestamp + INTERVAL_MS,
            "source_bar_count": len(group),
        })
    return result


def validate_bars(bars: list[dict]) -> dict:
    timestamps = [bar["timestamp"] for bar in bars]
    duplicates = len(timestamps) - len(set(timestamps))
    invalid = sum(1 for bar in bars if not (bar["high"] >= max(bar["open"], bar["close"]) and bar["low"] <= min(bar["open"], bar["close"]) and min(bar["open"], bar["high"], bar["low"], bar["close"]) > 0))
    gaps = []
    for left, right in zip(timestamps, timestamps[1:]):
        if right - left > INTERVAL_MS:
            gaps.append({"from": left, "to": right, "missing_intervals": (right - left) // INTERVAL_MS - 1})
    return {"count": len(bars), "duplicate_timestamps": duplicates, "invalid_ohlc": invalid, "gaps": gaps, "first": timestamps[0] if timestamps else None, "last": timestamps[-1] if timestamps else None}


def acquire_symbol(symbol: str, start: date, end: date, output_dir: Path, cache_dir: Path, retries: int, retry_pause: float, request_pause: float, request_timeout: float, workers: int) -> dict:
    instrument = instrument_id(symbol)
    raw_dir = cache_dir / instrument.lower()
    raw_dir.mkdir(parents=True, exist_ok=True)
    minute_bars = []
    day_rows = []
    days = []
    current = start
    while current <= end:
        if current.weekday() not in {5, 6}:  # Preserve the real weekend gap; no interpolation.
            days.append(current)
        current += timedelta(days=1)

    def fetch_day(day: date):
        raw_path = raw_dir / f"{day.isoformat()}.bi5"
        if raw_path.exists() and raw_path.stat().st_size:
            return day, raw_path.read_bytes(), "cache"
        if request_pause:
            time.sleep(request_pause)
        payload, status = request_bytes(artifact_url(instrument, day), retries, retry_pause, request_timeout)
        if payload:
            raw_path.write_bytes(payload)
        return day, payload, status

    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = [pool.submit(fetch_day, day) for day in days]
        fetched = {future.result()[0]: future.result()[1:] for future in as_completed(futures)}
    for day in sorted(fetched):
        payload, status = fetched[day]
        if payload:
            try:
                decoded = decode_artifact(payload, day, instrument)
                minute_bars.extend(decoded)
                day_rows.append({"date": day.isoformat(), "status": status, "raw_bytes": len(payload), "sha256": sha256_bytes(payload), "minute_bars": len(decoded)})
            except (ValueError, lzma.LZMAError) as error:
                day_rows.append({"date": day.isoformat(), "status": "decode_error", "error": str(error), "raw_bytes": len(payload)})
        else:
            day_rows.append({"date": day.isoformat(), "status": status})
    for day in (start + timedelta(days=index) for index in range((end - start).days + 1)):
        if day.weekday() in {5, 6}:
            day_rows.append({"date": day.isoformat(), "status": "weekend_skipped"})
    day_rows.sort(key=lambda row: row["date"])
    bars = aggregate_5m(minute_bars)
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{instrument.lower()}_5m_{start.isoformat()}_{end.isoformat()}.json"
    payload = {"symbol": symbol, "instrument": instrument, "provider": "Dukascopy public datafeed", "price_type": "BID", "timeframe": "5m", "timezone": "UTC", "requested_from": start.isoformat(), "requested_to": end.isoformat(), "price_scale": PRICE_SCALES[instrument], "bars": bars, "diagnostics": validate_bars(bars), "daily_artifacts": day_rows}
    output_path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    return {"symbol": symbol, "instrument": instrument, "output": str(output_path), "diagnostics": payload["diagnostics"], "daily_artifacts": day_rows}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbols", default="AUD/USD,GBP/JPY,XAU/USD")
    parser.add_argument("--from", dest="start", required=True)
    parser.add_argument("--to", dest="end", required=True)
    parser.add_argument("--output-dir", default="data/deep-history/dukascopy")
    parser.add_argument("--cache-dir", default="data/deep-history/dukascopy-cache")
    parser.add_argument("--retries", type=int, default=4)
    parser.add_argument("--retry-pause", type=float, default=2.0)
    parser.add_argument("--request-pause", type=float, default=0.25)
    parser.add_argument("--request-timeout", type=float, default=15.0)
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()
    start, end = parse_day(args.start), parse_day(args.end)
    if start > end:
        raise SystemExit("--from must not be after --to")
    results = []
    for symbol in [item.strip() for item in args.symbols.split(",") if item.strip()]:
        result = acquire_symbol(symbol, start, end, Path(args.output_dir), Path(args.cache_dir), args.retries, args.retry_pause, args.request_pause, args.request_timeout, args.workers)
        results.append(result)
        print(json.dumps({"symbol": symbol, "diagnostics": result["diagnostics"], "output": result["output"]}))
    manifest = {"provider": "Dukascopy public datafeed", "price_type": "BID", "base_timeframe": "m1", "output_timeframe": "5m", "timezone": "UTC", "from": args.start, "to": args.end, "symbols": results}
    Path(args.output_dir).mkdir(parents=True, exist_ok=True)
    (Path(args.output_dir) / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
