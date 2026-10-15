# UEFA registration implementation plan

**Goal:** Preview and report Champions League / Europa League team results for UEFA-registered Japanese players regardless of matchday selection.
**Architecture:** A small registration module parses UEFA squad pages and decides eligibility. A refresher saves source-linked registration in the existing embedded seed. Existing fixture and completed-match collectors consume those decisions; match cards group European records separately.
**Tech Stack:** Node.js, node:test, static HTML, GitHub Actions.

- [x] Add failing registration and completed-match tests in tests/uefa-registration.test.cjs and tests/completed-matches.test.cjs. Run node --test and confirm failures.
- [x] Add uefa-registration.cjs and refresh-uefa-registration.cjs. Validate current-season squad pages; exclude unknown registration. Store evidence and validity dates in seed.competition_eligibility.
- [x] Update completed-matches.cjs and refresh-completed-matches.cjs to discover European matches and preserve registered nonparticipants with unknown player stats. Resolve venue timezone from home club.
- [x] Update japanese-players.html eligibility, registration labels, European match grouping and definitions. Add preview/render tests to tests/report-week.test.cjs.
- [x] Update workflow to refresh registration before match collectors; refresh evidence and match snapshots. Run node --test tests/*.test.cjs, inspect git diff --check and rendered report behavior.
- [x] Commit branch, create a pull request and attach it to this chat for review.

## Player map extension

- [x] Build league -> geographic club -> player drilldown with an accessible parallel list, affiliation-aware identities and source-backed season/registration data.
- [x] Collect 77 stadium coordinates from FotMob and bundle Natural Earth public-domain geometry.
- [x] Verify desktop/mobile browser flow, player search, unknown-coordinate fallback and no horizontal page overflow.
