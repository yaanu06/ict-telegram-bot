"""Resident adapter for the official shiyu-coder/Kronos implementation.

The worker speaks newline-delimited JSON so the Node proxy can keep one model
resident.  It deliberately has no fallback model: when the official package,
weights, or required data are unavailable it returns a typed unavailable/error
result and never fabricates a forecast.
"""

from __future__ import annotations

import json
import os
import random
import sys
import time
from pathlib import Path

MODEL_ID = os.getenv("KRONOS_MODEL_ID", os.getenv("KRONOS_MODEL", "NeoQuasar/Kronos-small"))
if MODEL_ID.strip().lower() == "small":
    MODEL_ID = "NeoQuasar/Kronos-small"
TOKENIZER_ID = os.getenv("KRONOS_TOKENIZER_ID", "NeoQuasar/Kronos-Tokenizer-base")
MAX_CONTEXT = min(512, max(1, int(os.getenv("KRONOS_MAX_CONTEXT", "512"))))
_PREDICTOR = None
_DEVICE = None
_LOAD_MS = None


def _emit(request_id, payload):
    result = {"id": request_id, **payload}
    sys.stdout.write(json.dumps(result, separators=(",", ":"), allow_nan=False) + "\n")
    sys.stdout.flush()


def _device():
    requested = os.getenv("KRONOS_DEVICE", "auto").strip().lower()
    if requested not in {"auto", "cpu", "cuda"}:
        requested = "auto"
    try:
        import torch

        if requested == "cuda":
            if not torch.cuda.is_available():
                raise RuntimeError("CUDA was requested but torch.cuda.is_available() is false")
            return "cuda:0"
        return "cuda:0" if requested == "auto" and torch.cuda.is_available() else "cpu"
    except ImportError as exc:
        raise RuntimeError("PyTorch is not installed") from exc


def _load_predictor():
    global _PREDICTOR, _DEVICE, _LOAD_MS
    if _PREDICTOR is not None:
        return _PREDICTOR, _DEVICE, _LOAD_MS
    started = time.perf_counter()
    repo_path = os.getenv("KRONOS_REPO_PATH", "").strip()
    if repo_path:
        sys.path.insert(0, str(Path(repo_path).expanduser().resolve()))
    try:
        import torch
        from model import Kronos, KronosPredictor, KronosTokenizer
    except ImportError as exc:
        raise RuntimeError(
            "official Kronos package is unavailable; install shiyu-coder/Kronos and its requirements"
        ) from exc
    device = _device()
    tokenizer = KronosTokenizer.from_pretrained(TOKENIZER_ID)
    model = Kronos.from_pretrained(MODEL_ID)
    tokenizer.eval()
    model.eval()
    _PREDICTOR = KronosPredictor(model, tokenizer, device=device, max_context=MAX_CONTEXT)
    _DEVICE = device
    _LOAD_MS = round((time.perf_counter() - started) * 1000, 2)
    return _PREDICTOR, _DEVICE, _LOAD_MS


def _validate_candles(candles, lookback):
    import pandas as pd

    if not isinstance(candles, list):
        raise ValueError("candles must be an array")
    if len(candles) < 2:
        raise ValueError("at least two closed candles are required")
    rows = []
    previous = None
    for item in candles:
        if not isinstance(item, dict):
            raise ValueError("candle must be an object")
        timestamp = item.get("timestamp", item.get("t"))
        if timestamp is None:
            raise ValueError("candle timestamp is required")
        if isinstance(timestamp, (int, float)):
            timestamp = pd.Timestamp(timestamp, unit="ms", tz="UTC").isoformat()
        else:
            timestamp = pd.Timestamp(timestamp, tz="UTC").isoformat()
        values = [item.get(name) for name in ("open", "high", "low", "close")]
        if not all(isinstance(value, (int, float)) and value == value for value in values):
            raise ValueError("candle OHLC values must be finite numbers")
        if item.get("is_closed") is False:
            raise ValueError("incomplete candles are not accepted")
        if values[2] <= 0 or values[1] < max(values[0], values[3], values[2]) or values[2] > min(values[0], values[3], values[1]):
            raise ValueError("candle OHLC relationship is invalid")
        if previous is not None and str(timestamp) <= str(previous):
            raise ValueError("candles must be strictly chronological")
        previous = timestamp
        row = {"timestamps": timestamp, "open": float(values[0]), "high": float(values[1]), "low": float(values[2]), "close": float(values[3])}
        if item.get("volume") is not None or item.get("v") is not None:
            row["volume"] = float(item.get("volume", item.get("v")))
            row["amount"] = float(item.get("amount", item.get("a", 0.0)))
        rows.append(row)
    return rows[-min(MAX_CONTEXT, max(1, int(lookback))):]


def _future_timestamps(last_timestamp, timeframe, horizon):
    import pandas as pd

    value = pd.Timestamp(last_timestamp)
    freq = {"1h": "1h", "4h": "4h"}.get(str(timeframe).lower())
    if not freq:
        raise ValueError("Kronos supports only 1h and 4h candidates")
    return pd.Series(pd.date_range(value + pd.Timedelta(freq), periods=horizon, freq=freq), name="timestamps")


def _forecast(request):
    import numpy as np
    import pandas as pd
    import torch

    timeframe = str(request.get("timeframe", "")).lower()
    lookback = min(MAX_CONTEXT, max(1, int(request.get("lookback", 400))))
    horizon = max(1, int(request.get("horizon", 12 if timeframe == "1h" else 6)))
    paths = max(1, min(50, int(request.get("paths", 1))))
    seed = int(request.get("seed", 42))
    rows = _validate_candles(request.get("candles"), lookback)
    predictor, device, load_ms = _load_predictor()
    frame = pd.DataFrame(rows)
    timestamps = pd.to_datetime(frame.pop("timestamps"), utc=True)
    feature_names = ["open", "high", "low", "close"]
    if "volume" in frame:
        feature_names += ["volume", "amount"]
    x_df = frame[feature_names].reset_index(drop=True)
    x_timestamp = pd.Series(timestamps).reset_index(drop=True)
    y_timestamp = _future_timestamps(x_timestamp.iloc[-1], timeframe, horizon)
    paths_data = []
    started = time.perf_counter()
    for index in range(paths):
        path_seed = seed + index
        random.seed(path_seed)
        np.random.seed(path_seed)
        torch.manual_seed(path_seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(path_seed)
        with torch.no_grad():
            predicted = predictor.predict(
                df=x_df,
                x_timestamp=x_timestamp,
                y_timestamp=y_timestamp,
                pred_len=horizon,
                T=1.0,
                top_p=0.9,
                top_k=0,
                verbose=False,
                sample_count=1,
            )
        path = []
        for stamp, row in predicted.reset_index(drop=True).iterrows():
            record = {
                "timestamp": y_timestamp.iloc[stamp].isoformat(),
                "open": float(row["open"]),
                "high": float(row["high"]),
                "low": float(row["low"]),
                "close": float(row["close"]),
            }
            path.append(record)
        paths_data.append(path)
    return {
        "status": "OK",
        "model": MODEL_ID,
        "tokenizer": TOKENIZER_ID,
        "device": device,
        "timeframe": timeframe,
        "lookback": len(rows),
        "horizon": horizon,
        "paths": paths,
        "seed": seed,
        "start_price": float(rows[-1]["close"]),
        "paths_data": paths_data,
        "load_ms": load_ms,
        "forecast_ms": round((time.perf_counter() - started) * 1000, 2),
    }


def _warmup():
    _, device, load_ms = _load_predictor()
    return {
        "status": "OK",
        "model": MODEL_ID,
        "tokenizer": TOKENIZER_ID,
        "device": device,
        "model_loaded": True,
        "load_ms": load_ms,
    }


def handle(message):
    request_id = message.get("id")
    try:
        return request_id, _warmup() if message.get("op") == "warmup" else _forecast(message)
    except (ImportError, ModuleNotFoundError) as exc:
        return request_id, {"status": "UNAVAILABLE", "model": MODEL_ID, "device": _DEVICE, "error": str(exc)}
    except Exception as exc:  # worker boundary: never take down the live scan
        message = f"{type(exc).__name__}: {exc}"
        status = "UNAVAILABLE" if any(token in message.lower() for token in ("not installed", "official kronos", "cuda was requested")) else "ERROR"
        return request_id, {"status": status, "model": MODEL_ID, "device": _DEVICE, "error": message}


def main():
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            message = json.loads(line)
            request_id, result = handle(message)
        except Exception as exc:
            request_id, result = None, {"status": "ERROR", "model": MODEL_ID, "error": f"worker protocol error: {exc}"}
        _emit(request_id, result)


if __name__ == "__main__":
    main()
