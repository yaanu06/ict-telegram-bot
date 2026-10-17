"""Small direct TVKit historical-data adapter used by the JS replay CLI."""
import argparse
import asyncio
import json
import sys
from datetime import datetime, timezone

from tvkit.api.chart.ohlcv import OHLCV
from tvkit_service import tv_symbol as existing_tv_symbol

INTERVALS = {"1m": "1", "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "1D"}


def provider_symbol(symbol: str) -> str:
    return existing_tv_symbol(symbol)


def parse_ms(value: str) -> int:
    text = value.replace("Z", "+00:00")
    return int(datetime.fromisoformat(text).timestamp() * 1000)


async def fetch(symbol: str, timeframe: str, bars: int):
    async with OHLCV() as client:
        raw = await client.get_historical_ohlcv(provider_symbol(symbol), interval=INTERVALS[timeframe], bars_count=bars)
    result = []
    for item in raw or []:
        row = item if isinstance(item, dict) else getattr(item, "__dict__", {})
        timestamp = row.get("timestamp", row.get("time", row.get("t")))
        if isinstance(timestamp, str):
            timestamp = parse_ms(timestamp)
        if timestamp is not None:
            timestamp = float(timestamp)
            timestamp = int(round(timestamp * 1000 if abs(timestamp) < 10_000_000_000 else timestamp))
        if timestamp is None:
            continue
        result.append({
            "timestamp": timestamp,
            "datetime": datetime.fromtimestamp(timestamp / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z"),
            "open": float(row.get("open", row.get("o"))),
            "high": float(row.get("high", row.get("h"))),
            "low": float(row.get("low", row.get("l"))),
            "close": float(row.get("close", row.get("c"))),
            "volume": float(row.get("volume", row.get("v", 0)) or 0),
        })
    return sorted({row["timestamp"]: row for row in result}.values(), key=lambda row: row["timestamp"])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbol", required=True)
    parser.add_argument("--timeframe", choices=sorted(INTERVALS), required=True)
    parser.add_argument("--from", dest="start", required=True)
    parser.add_argument("--to", dest="end", required=True)
    parser.add_argument("--bars", type=int, default=5000)
    parser.add_argument("--summary-only", action="store_true")
    args = parser.parse_args()
    start_ms = parse_ms(args.start)
    end_ms = parse_ms(args.end)
    try:
        rows = asyncio.run(fetch(args.symbol, args.timeframe, args.bars))
        rows = [row for row in rows if start_ms <= row["timestamp"] <= end_ms]
        interval_ms = {"1m": 60000, "5m": 300000, "15m": 900000, "1h": 3600000, "4h": 14400000, "1d": 86400000}[args.timeframe]
        gaps = []
        for left, right in zip(rows, rows[1:]):
            if right["timestamp"] - left["timestamp"] > interval_ms:
                gaps.append({"from": left["timestamp"], "to": right["timestamp"], "missing_intervals": round((right["timestamp"] - left["timestamp"]) / interval_ms) - 1})
        payload = {
            "symbol": args.symbol,
            "provider_symbol": provider_symbol(args.symbol),
            "timeframe": args.timeframe,
            "requested_from": args.start,
            "requested_to": args.end,
            "bars": rows,
            "diagnostics": {
                "requested_start_ms": start_ms,
                "requested_end_ms": end_ms,
                "actual_first_ms": rows[0]["timestamp"] if rows else None,
                "actual_last_ms": rows[-1]["timestamp"] if rows else None,
                "bar_count": len(rows),
                "gaps": gaps,
            },
        }
        if args.summary_only:
            payload["bars"] = []
        print(json.dumps(payload))
        return 0
    except Exception as exc:  # pragma: no cover - provider/network dependent
        print(json.dumps({"error": str(exc), "symbol": args.symbol, "timeframe": args.timeframe}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
