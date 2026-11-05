# Cup competition filters implementation plan

**Goal:** Add separate European Cups and Domestic Cups card groups to the existing competition navigation, as approved in chat.

**Design:** Preserve all league categories. Discover cups from source-linked match records, fixture snapshots, and UEFA registration evidence; always show the three supported European cups. Count distinct current watchlist players backed by those sources, without treating a club fixture as confirmed selection. UEFA fixtures must continue to pass the existing registration/date checks. Selecting a cup filters the weekly results, player summary, and scheduled fixtures to that competition. Season totals remain domestic league totals, as already labelled.

**Architecture:** Keep the page standalone. Add cup discovery and player membership helpers beside the current competition helpers in japanese-players.html. Keep league membership separate from competition selection so player-map league navigation retains its current behavior. Reuse the existing navigation card styles and delegated button setup.

**Tech stack:** Existing browser JavaScript and Node test runner with the page VM harness.

## Tasks

- [x] Add failing tests in tests/cup-filters.test.cjs for cup categories, evidence-backed unique counts, competition-specific records and schedules, registration rejection, and unchanged league behavior.
- [x] Run the focused test and confirm the expected missing behavior fails.
- [x] Implement cup helpers, navigation rendering, and selection routing in japanese-players.html; reset the match-type selector when choosing a card to avoid conflicting filters.
- [x] Run the focused tests and the complete existing Node test suite; inspect the browser layout and selected-cup behavior.
- [ ] Review the diff, commit, push to main, and verify the Pages deployment.

## Validation limits

Cup membership is based on available published evidence and does not establish matchday selection. A competition with no verified current players stays visible with an explicit empty label rather than inventing membership. The previous-matchday panel remains independent of all player/competition filters by its existing documented behavior.

## Verification

67 Node tests passed. Browser checks confirmed the new card groups, separate IDs for same-named cups, 23 DFB Pokal player rows and nine W44 match articles, retained domestic season statistics, and ten Europa League W45 fixture rows. Independent review found no remaining material issues after fixes.
