# Market-Pack Safety Repair Plan

1. Trace the live manual RAW_CANDLE_AI pack, Telegram document delivery, and
   server proxy paths. Remove duplicate/legacy prompt contracts so every pack
   contains one manual-review contract: `RAW_CANDLE_AI_V4.0`.
2. Establish one symbol-settings source for built-in and provider symbols.
   It will supply asset class, validated tick/precision, volume semantics,
   market hours, sessions, gap handling, and conservative unknown states.
3. Rebuild the factual header and informational swing map from closed candles
   and supplied quote metadata only. Unknown metadata remains `UNKNOWN`.
4. Make scan/export errors visible, preserve one-provider snapshots, and keep
   Telegram delivery document-only with a factual caption and no secrets.
5. Add manual-result logging, closed-candle-only pending-limit monitoring, and
   bounded local measurement without any automatic trade selection or broker
   interaction. Reuse only authenticated existing server patterns for alerts.
6. Align non-live backtest/paper paths with symbol settings, then add fixtures,
   prompt linting, and regression tests before each focused commit.

Safety boundaries: `packet/` remains read-only; no broker/order route; no AI
response inference; no fabricated market metadata; forming candles are excluded.
