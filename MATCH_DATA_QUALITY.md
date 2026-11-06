# Japanese Players Abroad: publication checks

`england.html` is outside this feature. Publish directly to main; no separate desktop deliverable is required.

## Match evidence

- Resolve UEFA competitions by known IDs or their exact published names. Unknown official competitions are reported as coverage gaps, never silently discarded. Friendlies remain excluded.
- An actual published matchday lineup establishes participation without requiring a separate UEFA registration snapshot. Upcoming player fixtures still require positive registration evidence.
- A verified final score may be shown without a lineup. Player selection is explicitly unconfirmed; minutes, contributions, cards and ratings remain null.
- Deduplicate by match ID and player ID. Keep the actual participating club, venue-local date, competition, source URL and check time.
- Deduplicate explicit goal/card event IDs. Recover positive goals and assists only when the whole goal progression reconciles with the final score. Exclude shootouts; keep own goals separate. Second yellow means a yellow and a dismissal, not a direct red.
- An absent event never creates a zero. A positive event may resolve a lagging zero statistic. A larger conflicting statistic is withheld as null with both reported values and its source in `quality_issues`; never select the larger value automatically.
- Preserve positive event evidence in each record. Ratings remain provider-attributed and source-linked.

## Every refresh

`refresh-completed-matches.cjs` checks each watched club and accounts for each in-scope completed fixture in `weekly-records.json` coverage. Outcomes are recorded, complete squads with no watched eligible player, source unavailable, or unrecognized competition. No fixture may remain pending. Source failures retain the previous evidence and are exposed in coverage warnings. Unconfirmed selection does not mean zero appearances.

Before writing a snapshot, validate identities, sources, numeric bounds, duplicate rows, consistent scores, contribution totals and unresolved conflicts. Failure preserves the previous snapshot. HTML embeds the identical match snapshot.

GitHub Actions runs `node --test tests/*.test.cjs` and `node verify-report-data.cjs` before committing refreshed data and deploying. The publication gate must fail on invalid data; do not bypass it with `|| true`. Source/selection gaps remain visible as unknowns rather than blocking unrelated valid results.

After publication, check the actual Pages report and a corrected player record. Green deployment alone does not verify football accuracy. Provider data can still be revised; retain source links and review new conflicts instead of claiming universal error-free coverage.
