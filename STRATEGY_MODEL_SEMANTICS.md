# Strategy model semantics

This document describes the implemented deterministic semantics exposed to the
manual external-AI packet. It is a project specification, not a claim that
these labels have one universal meaning across trading literature.

## Responsibility split

The code derives closed-candle facts, identities, geometry, lifecycle,
invalidation, objectives, and arithmetic. The external AI interprets the
complete snapshot and chooses BUY, SELL, or NO_TRADE. The validator proves the
returned IDs and geometry; it does not choose a replacement opportunity.

## ICT structure and liquidity

This is the neutral evidence family for structure, displacement, liquidity,
FVG, OB, supply, demand, and role-reversal records. It is not a directional
recommendation and does not create a trade by itself.

## Model-specific execution semantics

The executable model token is preserved on each location and checked against
the first setup component returned by external AI. OB, FVG, MSNR, supply,
demand, and FLIP currently permit the supplied full zone, either supplied zone
edge, or supplied midpoint when one exists. CRT and TBS use the model-defined
execution zone produced by their reclaim detectors; their invalidation basis is
the sweep extreme. These are implemented project conventions, not universal
definitions of the terms.

## OB

The current detector uses a closed opposing source candle followed by a
directional candle that takes the source extreme: bearish source followed by a
bullish consequence for BUY, or bullish source followed by a bearish
consequence for SELL. The source and consequence provide formation chronology;
there is no implicit FVG requirement. Lifecycle and structural invalidation
come from the supplied zone/structure record and are serialized with their
source evidence.

The detector does not require an FVG. Its confirmation mode is
`OPPOSING_CANDLE_EXTREME_TAKEN`; an OB should not be described as an FVG or as
a stronger structural model unless separate supplied evidence supports that
combination.

## FVG

The current detector uses three closed candles. A bullish gap exists when the
first candle high is below the third candle low; a bearish gap is the inverse.
The gap bounds, orientation, source time, partial/full fill state, and any
role-reversal state are deterministic facts. A filled or invalidated gap is
not an executable fresh location.

## MSNR

The current MSNR detector starts from a closed bullish-to-bearish or
bearish-to-bullish body transition. The zone is the transition body extremes
expanded by the deterministic maximum of the configured tick pad, ATR-based
pad, and price pad. A qualifying departure and structural reaction are
required for executable qualification. Resistance and support roles map to
SELL and BUY respectively; a confirmed break plus retest creates the
canonical role-reversal state. Wick touches after departure count as tests;
excess mitigation or a confirmed break failure makes the record unusable.

For the current implementation, lifecycle break detection is a closed close
beyond the active zone edge with the configured displacement buffer. The
execution invalidation is the active role's far zone edge (`ZONE_FAR_EDGE`),
with `HARD_PRICE` confirmation for the supplied stop. These are now exposed as
separate lifecycle and execution fields even when their threshold is the same.

## Supply, demand, and FLIP

Supply and demand are deterministic structure-engine zones with factual
orientation. FLIP is a distinct canonical role-reversal/reclaim record with
its own identity; an original opposite-direction location is not silently
converted into a FLIP.

## CRT and TBS

CRT and TBS remain model-defined sweep/reclaim evidence produced by their
existing detectors. Their model-defined zones and sweep-extreme invalidation
provenance are preserved; this audit does not import external definitions or
change their thresholds.

CRT uses a closed reference range, a later sweep, and a reclaim close. TBS
uses an age-qualified confirmed swing liquidity reference, a sweep beyond that
reference, and a reclaim close. Both retain origin, sweep, reclaim,
confirmation, and first-knowable timestamps; a sweep alone is not a confirmed
event.

## Structural events and time

The manual MARKET_STATE_V3 structure compiler reports a break only when a
closed candle closes beyond a confirmed swing. It records the broken swing,
prior/resulting structural state, confirmation mode, confirmation time, and
first-knowable time. A wick through a swing is not sufficient. Legacy
automatic-selector APIs remain compatibility-scoped and are not the manual V3
structural evidence source.

## Temporal integrity

Detector inputs are normalized closed candles. Confirmation time and, where
available, first-knowable time are serialized separately from origin or pivot
time. A forming candle is excluded from the semantic snapshot, and future
candles must not be used to assign an earlier event time.

## Invalidation and objectives

An invalidation record identifies its source location/model/event, basis, and
confirmation mode. A structural invalidation is not automatically the same
concept as a lifecycle state transition, although the MSNR implementation
currently uses the far edge for both threshold and execution stop by design.
Objectives retain canonical IDs while exposing objective class, intrinsic
liquidity side, source-side-at-detection, current price relation, and
lifecycle. These fields describe facts; they do not preselect a target
direction. Invalidation records also retain source location/model/event,
basis, source price, lifecycle invalidation, and execution invalidation;
missing positive location compatibility is not treated as verified.
