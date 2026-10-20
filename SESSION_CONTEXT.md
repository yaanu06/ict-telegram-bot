# Current Engineering Handoff — Market Mechanics Pending Engine

Updated: 2026-10-20

Read this file before making further changes. It records the current verified
repository state, the latest production-packet diagnosis, and the remaining
work. Do not treat older chat summaries or historical packet results as current.

## Repository and safety

- Repository: `C:\Users\hassa\ict-telegram-bot`
- Remote: `yaanu06/ict-telegram-bot`
- Branch: `main`
- Current pushed HEAD before this handoff update:
  `1fd9898a077ec4a12ab352ebe156fe0612bd75df`
- Production strategy: `V2 MARKET_MECHANICS`
- Legacy trade authority must remain disabled.
- Kronos remains informational only.
- There is no DeepSeek API and no automatic broker execution. The user copies
  the RAW packet into DeepSeek manually.
- `packet/` is untracked user diagnostic data. It is read-only: never modify,
  delete, rename, stage, commit, or push it. Never use `git add -A`.

## Last implemented and pushed repair

Commit `1fd9898` (`fix(market-mechanics): enforce causal risk and path authority`)
implemented:

- causal same-timeframe OB invalidation for LIQUIDITY_OB_FVG execution zones;
- explicit path evaluation for deterministic LIVE authority;
- UNKNOWN/INCOMPLETE path cannot pass the canonical LIVE normalizer;
- constrained path can pass only as `CONSTRAINED/PASS_WITH_PENALTY`;
- model-funnel record deduplication;
- AI compact-path defaults fail closed instead of defaulting to clear;
- RAW LIVE serialization preserves lowercase `clear_path_to_tp1="NO"` rather
  than reversing it through JavaScript truthiness.

Validation at that commit:

- Jest: 23 suites passed; 952 passed, 3 skipped, 955 total.
- Python: 7 tests passed with `python -m unittest discover -s tools -p "test_*.py"`.
- `node --check script.js`: passed.
- `git diff --check`: passed.
- Production health endpoint returned HTTP 200.
- `HEAD == origin/main` was verified.

## Latest packet inspected after that commit

Read-only packet: `packet/xauusd new.txt`

- Packet commit: `1fd9898a077ec4a12ab352ebe156fe0612bd75df`
- Generated: `2026-10-20T06:16:17.205Z`
- Symbol: XAU/USD
- Current price: `4120.66`
- Data quality: FRESH on 1D/4H/1H/15M/5M and quote; missing count zero.
- Market Plan: SELL / BEARISH / CONTINUATION.
- Primary draw: 1H sell-side liquidity at `4115.57`.

### Critical contradictions in the packet

The canonical funnel reports:

- RAW=33
- lifecycle eligible=4
- correct side=4
- reachable=0
- stop ready=0
- target ready=0
- path ready=NONE

But the packet simultaneously reports two LIVE CRT candidates:

1. zone `4133.28-4140.415`, entry `4136.85`, stop `4151.21`;
2. zone `4134.4175-4139.465`, entry `4136.94`, stop `4151.30`.

Both LIVE rows say:

- `PATH_STATUS=INCOMPLETE`
- `PATH_EVALUATED=NO`
- `PATH_QUALITY_RESULT=INCOMPLETE`
- `CANDIDATE_AUTHORITY=LIVE`
- `BLOCKERS=NONE`

This violates the intended authority invariant and proves that a downstream
packet path bypasses the canonical normalizer.

### Verified code-level bypass

In `buildRawTextMarketAnalysisPacket`, when
`source.market_mechanics.authority_summary` exists, the code constructs
`authority` by copying:

```js
live_candidates: source.live_market_mechanics_candidates
    || source.valid_candidates
    || []
```

Those stored rows are not passed through `marketMechanicsLiveCandidates()` or
`normalizeMarketMechanicsAuthority()` again. This is why commit `1fd9898`
correctly tightened the canonical normalizer but the RAW packet still printed
stored path-incomplete candidates as LIVE.

The packet serializer is now honest about the path state; the remaining defect
is that the stored-authority branch still calls those candidates LIVE.

### CRT identity collision and geometry mixing

Several distinct CRT execution zones share the same setup ID:

`MARKET_PLAN:CRT_AGGRESSIVE:1H:SELL:1792472400000`

The ID includes timeframe, direction and event time, but not zone boundaries or
the CRT reference. Distinct zones therefore collide during candidate/manual
shortlist matching and deduplication.

The clearest corruption in the packet is:

- displayed manual zone: `4123.53-4131.485`;
- suggested entry: `4136.85`;
- entry `4136.85` actually belongs to the different CRT zone
  `4133.28-4140.415`.

The same manual row says `ACTIVE_UNTOUCHED`, `ENTRY_TOUCHED=NO`, and
`ENTRY_CONSUMED=NO`, but its warnings include `ENTRY_ALREADY_CONSUMED` and
`LIFECYCLE_REJECTED`. These warnings were merged from a different record with
the colliding setup identity.

This contradiction caused manual DeepSeek to reject the newer CRT by treating
pre-actionable/other-zone price traversal as consumption.

### Opportunity interpretation

The 4H FVG at `4149.55-4158.81` and the 1H MSNR at `4145.47-4147.03` are active
and above current price, but their proposed HTF stops near `4191` produce poor
reward/risk under the configured 2.5R minimum. They should not be forced LIVE.

The two newer CRT SELL zones may be genuine pending opportunities because their
lifecycle audits say they became actionable at `1792476000000` and remained
untouched afterward. However, they cannot be authorized yet because path was not
evaluated. A fresh opposing 4H BUY FVG/demand at `4106.70-4136.20` begins almost
immediately below the proposed entries and lies before targets around `4092`.
The canonical path audit must determine whether this is constrained or blocked.

Therefore the manual DeepSeek `NO_TRADE` response was prudent, but its claim that
the newest CRT was definitely consumed is not supported by the packet's own
post-formation lifecycle audit. The packet is too contradictory to make a safe
trade decision.

## Remaining repair — do this next

1. Remove the stored-authority bypass in `buildRawTextMarketAnalysisPacket`.
   Always recompute packet LIVE rows with `marketMechanicsAuthoritySummary()`
   from canonical candidate records. A stored summary may provide diagnostics,
   but may not supply unnormalized LIVE rows.
2. Make missing/incomplete path evidence fail LIVE in every projection: canonical
   catalog, stored context, RAW packet, compact semantic package, public UI and
   manual packet.
3. Generate unique CRT setup/campaign/candidate IDs using at least event time,
   direction, timeframe, zone low, zone high and source CRT reference.
4. Match manual opportunities by unique candidate/zone ID, never only by the
   non-unique source setup ID.
5. Enforce `entry` inside the exact execution zone associated with the candidate.
   Do not serialize mixed geometry.
6. Keep lifecycle and warning provenance candidate-specific. An
   `ENTRY_ALREADY_CONSUMED` record from one CRT zone must never contaminate a
   sibling zone.
7. Recompute path quality for the exact two CRT candidates using the 4H opposing
   zone `4106.70-4136.20`; expose nearest barrier and distance in R.
8. Build all funnel counts and LIVE count from one deduplicated cumulative
   candidate population. Enforce:
   `LIVE <= PATH_READY <= TARGET_READY <= STOP_READY <= REACHABLE`.
9. In `buildMarketMechanicsModelFunnel`, count LIVE only when that exact record
   also passed the cumulative target and path stages; do not count membership in
   a stale `liveIds` set by itself.
10. Add an end-to-end regression using the latest XAU packet facts and the
    stored-authority branch. The test must fail if a row is serialized LIVE with
    `PATH_EVALUATED=NO`, if entry lies outside its zone, or if sibling lifecycle
    warnings are merged.

## Acceptance conditions for the next commit

- Packet cannot contain a LIVE row with incomplete/unknown path.
- The two CRT zones have distinct stable IDs.
- Each CRT entry is inside its own serialized zone.
- Active untouched lifecycle remains distinct from consumed sibling zones.
- Funnel counts are cumulative and cannot contradict LIVE count.
- Manual shortlist may expose active formations with warnings, but cannot mix
  geometry or lifecycle evidence.
- No threshold relaxation, no forced trade, and no post-touch confirmation.
- Full Jest, Python, syntax, packet replay, production-path and diff checks pass.
- Stage only explicit tracked files; `packet/` remains untouched/untracked.
