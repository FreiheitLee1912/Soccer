# Sunday-centred report implementation plan

**Goal:** Show each watched player's scheduled games in chronological order using the approved Sunday-centred weeks.

**Architecture:** Keep the existing static report and roster. Regroup records from local kickoff dates in its browser script; add a source-backed fixture JSON and refresh script. Generate a matching weekly CSV download in the browser.

**Tech Stack:** Browser JavaScript, Node.js built-ins, GitHub Actions and Pages.

- [x] Add and run failing tests with `node --test tests/report-week.test.cjs` for Monday, midweek, timezone and year boundaries.
- [x] Add `reportWeek`, `weekendRange` and record normalization; update selector, range, coverage, definitions and generated CSV. Re-run boundary tests.
- [x] Add `refresh-fixtures.cjs` to collect roster team fixtures and venue timezones; save `fixtures.json` only after successful validation. Add chronological schedule and uncovered-player list.
- [x] Add source and filtering tests, run refresh against real sources, verify rendered desktop/mobile report and CSV.
- [x] Wire scheduled refresh, inspect diff, commit and push to main as requested, then verify GitHub Pages deployment.
