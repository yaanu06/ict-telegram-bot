import unittest

from tools import kronos_worker


class KronosWorkerInputTests(unittest.TestCase):
    def test_rejects_incomplete_candles(self):
        with self.assertRaisesRegex(ValueError, "incomplete"):
            kronos_worker._validate_candles([
                {"timestamp": "2026-10-17T00:00:00Z", "open": 1, "high": 2, "low": 0.5, "close": 1, "is_closed": False},
                {"timestamp": "2026-10-17T01:00:00Z", "open": 1, "high": 2, "low": 0.5, "close": 1},
            ], 400)

    def test_accepts_ohlcv_in_chronological_order_without_loading_model(self):
        rows = kronos_worker._validate_candles([
            {"timestamp": "2026-10-17T00:00:00Z", "open": 1, "high": 2, "low": 0.5, "close": 1, "volume": 3},
            {"timestamp": "2026-10-17T01:00:00Z", "open": 1, "high": 2, "low": 0.5, "close": 1, "volume": 4},
        ], 400)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[-1]["volume"], 4.0)
        self.assertEqual(kronos_worker.MODEL_ID, "NeoQuasar/Kronos-small")


if __name__ == "__main__":
    unittest.main()
