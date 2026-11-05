import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd

from tools.tvkit_service import (
    fetch_quote,
    format_df_to_csv,
    provider_symbol,
    quote_market_fields,
    quote_provider_timestamp_ms,
    response_bar,
)


def frame(times, closes=None):
    closes = closes or [100.0 + index for index in range(len(times))]
    index = pd.to_datetime(times)
    return pd.DataFrame(
        {
            "open": closes,
            "high": [value + 1 for value in closes],
            "low": [value - 1 for value in closes],
            "close": closes,
            "volume": [10.0 for _ in closes],
        },
        index=index,
    )


class FakeClient:
    def get_hist(self, symbol, exchange, interval, n_bars):
        self.last_request = (symbol, exchange, interval, n_bars)
        return frame(["2026-10-09T19:55:00", "2026-10-09T20:00:00"], [4179.0, 4179.15])


class TvdatafeedQuoteTests(unittest.TestCase):
    def test_uses_provider_last_price_time(self):
        quote = {"lp_time": 1791662400}
        self.assertEqual(quote_provider_timestamp_ms(quote), 1791662400000)

    def test_accepts_iso_timestamp_compatibility_field(self):
        quote = {"timestamp": "2026-10-09T20:00:00Z"}
        self.assertEqual(quote_provider_timestamp_ms(quote), 1791576000000)

    def test_does_not_invent_local_receipt_time_when_provider_has_no_timestamp(self):
        self.assertIsNone(quote_provider_timestamp_ms({"lp": 4179.15}))

    def test_fetch_quote_uses_latest_closed_5m_candle(self):
        with patch("tools.tvkit_service._create_client", return_value=FakeClient()), \
                patch("tools.tvkit_service._interval_enum", return_value="in_5_minute"):
            result = asyncio.run(fetch_quote("XAU/USD"))

        self.assertEqual(result["price"], 4179.15)
        self.assertEqual(result["timestamp"], "2026-10-09T20:00:00Z")
        self.assertEqual(result["symbol"], "OANDA:XAUUSD")
        self.assertEqual(result["engine"], "tvdatafeed-enhanced")

    def test_quote_market_fields_do_not_copy_unknown_provider_payload(self):
        quote = SimpleNamespace(symbol_info={
            "bid": "1.1000", "ask": "1.1002", "authorization": "secret",
            "session": "2200-2200", "unknown": "not-exported",
        })
        # tvdatafeed-enhanced has no live bid/ask payload, but the adapter must
        # keep rejecting unknown/provider-secret keys if one is ever supplied.
        fields = quote_market_fields(quote)
        self.assertEqual(fields["bid"], 1.1)
        self.assertEqual(fields["ask"], 1.1002)
        self.assertNotIn("authorization", fields["symbol_metadata"])
        self.assertNotIn("unknown", fields["symbol_metadata"])

    def test_response_bar_exposes_open_timestamp_contract(self):
        bar = {"timestamp": 1792472400, "open": 100, "high": 102, "low": 99, "close": 101, "volume": 12}
        result = response_bar(bar, "1h", 3_600_000)
        self.assertEqual(result["provider_timestamp"], 1792472400000)
        self.assertEqual(result["timestamp_semantics"], "OPEN")
        self.assertEqual(result["open_time"], "2026-10-20T05:00:00Z")
        self.assertEqual(result["close_time"], "2026-10-20T06:00:00Z")


class TvdatafeedMappingTests(unittest.TestCase):
    def test_maps_documented_pairs_to_oanda(self):
        self.assertEqual(provider_symbol("XAU/USD"), ("XAUUSD", "OANDA"))
        self.assertEqual(provider_symbol("EUR/USD"), ("EURUSD", "OANDA"))
        self.assertEqual(provider_symbol("USD/JPY"), ("USDJPY", "OANDA"))
        self.assertEqual(provider_symbol("FX_IDC:EURUSD"), ("EURUSD", "OANDA"))
        self.assertEqual(provider_symbol("OANDA:XAUUSD"), ("XAUUSD", "OANDA"))
        self.assertEqual(provider_symbol("OANDA:USDJPY"), ("USDJPY", "OANDA"))

    def test_format_df_to_csv_matches_packet_header_and_timestamp_format(self):
        dataframe = frame(["2026-10-09T20:00:00"], [4179.15])
        text = format_df_to_csv(dataframe, "5M", 50)
        self.assertTrue(text.startswith("======== TIMEFRAME: 5m ========"))
        self.assertIn("CANDLE_COUNT=1", text)
        self.assertIn("CANDLE_LIMIT=50", text)
        self.assertIn("CANDLE_POLICY=CLOSED_ONLY", text)
        self.assertIn("FORMAT: time,open,high,low,close,volume", text)
        self.assertIn("2026-10-09T20:00:00.000Z", text)
        self.assertIn("======== END 5m ========", text)

    def test_empty_dataframe_returns_zero_count_block(self):
        text = format_df_to_csv(None, "1D", 15)
        self.assertEqual(
            text,
            "======== TIMEFRAME: 1d ========\nCANDLE_COUNT=0\n======== END 1d ========\n",
        )


if __name__ == "__main__":
    unittest.main()
