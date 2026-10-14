# Completed league match refresh

Problem: scheduled Actions refreshes fixtures and season totals, but no step collected completed player matches. The fixture builder intentionally excludes final matches, so completed EFL fixtures disappeared while weekly CSV archives stayed unchanged.

Add a completed-match collector before other refresh steps. Find final domestic league fixtures for watchlist clubs in the preceding eight days, validate final status and match identity, and read published lineups/player statistics. Use canonical parent league IDs for competitions with stage IDs. Recognize starting players, played substitutes, unused substitutes and absent players only when a complete match squad is published. Keep missing statistics unknown. Store source-linked records in `weekly-records.json`, preserving earlier verified records and per-source gaps.

Merge the live completed feed with publication CSVs by match/player/league, with current source records taking precedence. Both CSV and JSON refreshes must retain the other feed regardless of fetch order. Use the approved Sunday-centred local-date week rule. Display the actual match-data check timestamp; include completed records in match cards, weekly ratings, stats and selected-week CSV download.

Maintain season-total semantics and refresh those totals independently. Retain last-good completed records when sources fail. Validate with final EFL source records, stage-ID tests, no scheduled-match appearances, missing-stat tests and merge/deduplication regression tests; then verify deployed W42 and Actions.
