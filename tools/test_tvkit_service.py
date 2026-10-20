import unittest
import asyncio
from types import SimpleNamespace
from unittest.mock import patch

from tools.tvkit_service import fetch_quote, quote_market_fields, quote_provider_timestamp_ms, response_bar


class TvkitQuoteTimestampTests(unittest.TestCase):
    def test_uses_provider_last_price_time_from_tvkit_quote_payload(self):
        quote = SimpleNamespace(
            symbol_info={"lp": 4179.15, "lp_time": 1791662400}
        )
        self.assertEqual(quote_provider_timestamp_ms(quote), 1791662400000)

    def test_accepts_iso_timestamp_compatibility_field(self):
        quote = {"timestamp": "2026-10-09T20:00:00Z"}
        self.assertEqual(
            quote_provider_timestamp_ms(quote),
            1791576000000,
        )

    def test_does_not_invent_local_receipt_time_when_provider_has_no_timestamp(self):
        quote = SimpleNamespace(symbol_info={"lp": 4179.15})
        self.assertIsNone(quote_provider_timestamp_ms(quote))

    def test_fetch_quote_serializes_provider_time_and_not_local_receipt_time(self):
        class FakeClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return False

            async def get_quote_data(self, _symbol, interval="1", bars_count=1):
                self_case.assertEqual(interval, "1")
                self_case.assertEqual(bars_count, 1)
                yield SimpleNamespace(
                    current_price=4179.15,
                    symbol_info={
                        "lp": 4179.15, "lp_time": 1791662400,
                        "bid": 4179.10, "ask": 4179.20,
                        "timezone": "Etc/UTC", "session": "2200-2200",
                    },
                )

        self_case = self
        with patch("tvkit.api.chart.ohlcv.OHLCV", FakeClient):
            result = asyncio.run(fetch_quote("XAU/USD"))

        self.assertEqual(result["timestamp"], "2026-10-10T20:00:00Z")
        self.assertEqual(result["bid"], 4179.10)
        self.assertEqual(result["ask"], 4179.20)
        self.assertAlmostEqual(result["spread"], 0.10)
        self.assertEqual(result["symbol_metadata"]["timezone"], "Etc/UTC")
        self.assertEqual(result["symbol_metadata"]["session"], "2200-2200")

    def test_quote_market_fields_do_not_copy_unknown_provider_payload(self):
        fields = quote_market_fields(SimpleNamespace(symbol_info={
            "bid": "1.1000", "ask": "1.1002", "authorization": "secret",
            "session": "2200-2200", "unknown": "not-exported",
        }))
        self.assertEqual(fields["bid"], 1.1)
        self.assertEqual(fields["ask"], 1.1002)
        self.assertNotIn("authorization", fields["symbol_metadata"])
        self.assertNotIn("unknown", fields["symbol_metadata"])

    def test_response_bar_exposes_open_timestamp_contract(self):
        bar = SimpleNamespace(timestamp=1792472400, open=100, high=102, low=99, close=101, volume=12)
        result = response_bar(bar, "1h", 3_600_000)
        self.assertEqual(result["provider_timestamp"], 1792472400000)
        self.assertEqual(result["timestamp_semantics"], "OPEN")
        self.assertEqual(result["open_time"], "2026-10-20T05:00:00Z")
        self.assertEqual(result["close_time"], "2026-10-20T06:00:00Z")


if __name__ == "__main__":
    unittest.main()
