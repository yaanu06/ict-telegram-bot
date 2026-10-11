import unittest
import asyncio
from types import SimpleNamespace
from unittest.mock import patch

from tools.tvkit_service import fetch_quote, quote_provider_timestamp_ms


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
                    symbol_info={"lp": 4179.15, "lp_time": 1791662400},
                )

        self_case = self
        with patch("tvkit.api.chart.ohlcv.OHLCV", FakeClient):
            result = asyncio.run(fetch_quote("XAU/USD"))

        self.assertEqual(result["timestamp"], "2026-10-10T20:00:00Z")


if __name__ == "__main__":
    unittest.main()
