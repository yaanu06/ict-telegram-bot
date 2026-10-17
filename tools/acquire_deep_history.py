"""Acquire the research window from reproducible public minute archives.

FX symbols use FXCM's public weekly BID/ASK minute archive. XAU/USD uses a
public monthly BID mirror whose README identifies Dukascopy as the source.
Both are normalized to the repository candle schema and aggregated to UTC 5M.
"""

from __future__ import annotations

import argparse
import csv
import json
import time
import urllib.error
import urllib.request
from calendar import monthrange
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from dukascopy_history import aggregate_5m, validate_bars


FXCM_SYMBOLS = {"AUD/USD": "AUDUSD", "GBP/JPY": "GBPJPY"}
XAU_BASE = "https://raw.githubusercontent.com/3650326613-png/dukascopy_xauusd_1m_data/main/xauusd/bid/m1/xauusd_bid_m1_"


def fetch(url: str, destination: Path, retries: int = 3, pause: float = 2.0) -> bytes:
    if destination.exists() and destination.stat().st_size:
        return destination.read_bytes()
    request = urllib.request.Request(url, headers={"User-Agent": "ict-telegram-bot-deep-history/1.0"})
    last_error = None
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                payload = response.read()
            if payload:
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(payload)
                return payload
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as error:
            last_error = error
        if attempt < retries:
            time.sleep(pause * (attempt + 1))
    raise RuntimeError(f"Unable to fetch {url}: {last_error}")


def fxcm_week_rows(symbol: str, start: date, end: date, raw_dir: Path) -> list[dict]:
    instrument = FXCM_SYMBOLS[symbol]
    first = start + timedelta(days=(6 - start.weekday()) % 7)
    rows = []
    current = first
    while current <= end:
        iso_year, iso_week, _ = current.isocalendar()
        # FXCM files are indexed by the calendar year and Sunday-start week.
        year = current.year
        week = int(current.strftime("%U")) + 1
        url = f"https://candledata.fxcorporate.com/m1/{instrument}/{year}/{week:02d}.csv.gz"
        raw_path = raw_dir / f"{instrument.lower()}_{year}_W{week:02d}.csv.gz"
        import gzip
        try:
            payload = gzip.decompress(fetch(url, raw_path))
        except RuntimeError as error:
            if "HTTP Error 404" in str(error):
                current += timedelta(days=7)
                continue
            raise
        text = payload.decode("utf-8-sig")
        for row in csv.DictReader(text.splitlines()):
            timestamp = datetime.strptime(row["DateTime"], "%m/%d/%Y %H:%M:%S.%f").replace(tzinfo=timezone.utc)
            timestamp_ms = int(timestamp.timestamp() * 1000)
            if start <= timestamp.date() <= end:
                rows.append({"timestamp": timestamp_ms, "open": float(row["BidOpen"]), "high": float(row["BidHigh"]), "low": float(row["BidLow"]), "close": float(row["BidClose"]), "volume": 0.0})
        current += timedelta(days=7)
    return sorted({row["timestamp"]: row for row in rows}.values(), key=lambda row: row["timestamp"])


def xau_month_rows(start: date, end: date, raw_dir: Path) -> list[dict]:
    rows = []
    current = date(start.year, start.month, 1)
    while current <= end:
        month_end = date(current.year, current.month, monthrange(current.year, current.month)[1])
        url = f"{XAU_BASE}{current.year:04d}_{current.month:02d}.csv"
        raw_path = raw_dir / f"xauusd_bid_m1_{current.year:04d}_{current.month:02d}.csv"
        text = fetch(url, raw_path).decode("utf-8-sig")
        for row in csv.DictReader(text.splitlines()):
            timestamp = int(row["timestamp"])
            timestamp_date = datetime.fromtimestamp(timestamp / 1000, tz=timezone.utc).date()
            if start <= timestamp_date <= end:
                rows.append({"timestamp": timestamp, "open": float(row["open"]), "high": float(row["high"]), "low": float(row["low"]), "close": float(row["close"]), "volume": 0.0})
        current = month_end + timedelta(days=1)
    return sorted({row["timestamp"]: row for row in rows}.values(), key=lambda row: row["timestamp"])


def write_payload(symbol: str, provider: str, rows: list[dict], start: date, end: date, output_dir: Path) -> dict:
    bars = aggregate_5m(rows)
    payload = {"symbol": symbol, "provider": provider, "price_type": "BID", "base_timeframe": "1m", "timeframe": "5m", "timezone": "UTC", "requested_from": start.isoformat(), "requested_to": end.isoformat(), "bars": bars, "diagnostics": validate_bars(bars), "source_minute_count": len(rows)}
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{symbol.replace('/', '').lower()}_5m_{start.isoformat()}_{end.isoformat()}.json"
    output_path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    return {"symbol": symbol, "data_file": str(output_path), "provider": provider, "diagnostics": payload["diagnostics"], "source_minute_count": len(rows)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--from", dest="start", default="2025-03-01")
    parser.add_argument("--to", dest="end", default="2025-09-30")
    parser.add_argument("--output-dir", default="data/deep-history/research")
    parser.add_argument("--raw-dir", default="data/deep-history/research-raw")
    args = parser.parse_args()
    start, end = date.fromisoformat(args.start), date.fromisoformat(args.end)
    raw_dir = Path(args.raw_dir)
    results = []
    for symbol in FXCM_SYMBOLS:
        rows = fxcm_week_rows(symbol, start, end, raw_dir / "fxcm")
        results.append(write_payload(symbol, "FXCM public weekly M1 BID archive", rows, start, end, Path(args.output_dir)))
        print(json.dumps(results[-1]))
    xau_rows = xau_month_rows(start, end, raw_dir / "xauusd-dukascopy-mirror")
    results.append(write_payload("XAU/USD", "Dukascopy BID M1 public mirror (provenance documented in source README)", xau_rows, start, end, Path(args.output_dir)))
    print(json.dumps(results[-1]))
    manifest = {"dataset_id": "V2_DEEP_HISTORY_2025_MAR_SEP", "provider_selection": {"AUD/USD": "FXCM public weekly M1 BID archive", "GBP/JPY": "FXCM public weekly M1 BID archive", "XAU/USD": "Dukascopy BID M1 public mirror"}, "from": args.start, "to": args.end, "context_start": args.start, "scored_start": "2025-04-01", "scored_end": args.end, "base_timeframe": "1m", "derived_timeframes": ["5m", "15m", "1h", "4h", "1d"], "timezone": "UTC", "symbols": results}
    Path(args.output_dir).mkdir(parents=True, exist_ok=True)
    (Path(args.output_dir) / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
