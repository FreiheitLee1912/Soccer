# Local refresh scheduler — design

Date: 2026-08-11
Status: approved, not yet implemented

## Problem

Transfermarkt is the only source for the England board and the primary source
for China; Japan uses it to attach market values on top of jleague.jp. From
GitHub Actions it is unreachable, so those refreshes were silently skipped:
England stood still from 2026-08-05, China from 2026-08-01, and Japan served
market values carried over from an ever-older build. Nobody noticed for days,
because a skipped refresh looks exactly like a quiet week in the transfer
market.

### Evidence

Measured from a GitHub-hosted runner (egress `172.182.195.232`, Azure), three
attempts per target, comparing plain `curl` against `curl_cffi` with Chrome TLS
impersonation:

| Target | plain curl | curl_cffi (chrome) |
|---|---|---|
| jleague.jp (control) | 200 · 2.03 MB | 200 · 2.19 MB |
| transfermarkt.com GB1 | 202 · 0 B | 202 · 2,411 B |
| transfermarkt.com JAP1 | 202 · 0 B | 202 · 2,411 B |
| tmapi.transfermarkt.technology | 202 · 0 B | 202 · 2,411 B |
| api.sofascore.com | 403 · 48 B | 403 · 48 B |

The control target succeeds, so this is not a network fault. Transfermarkt
answers `202 Accepted` with an empty or 2.4 KB challenge body — a bot wall, not
data. The identical `curl_cffi` code run from a residential IP returns 982 KB of
real page from Transfermarkt and `200` with JSON from SofaScore.

Two conclusions follow. The block keys on IP, not on TLS fingerprint, so no
client-side change rescues CI. And SofaScore is not an escape hatch: from CI it
refuses harder than Transfermarkt does.

## Goals

- All three datasets refresh automatically, on roughly the current 6-hour cadence.
- A refresh that fails is visible without anyone thinking to check the site.
- No monthly cost, no third-party credentials.

## Non-goals

- Replacing Transfermarkt as a source.
- Restoring Transfermarkt access from GitHub Actions.
- Automating `sofascore-overrides.json`. TLS impersonation makes SofaScore
  scriptable from a residential IP, which makes this newly possible, but it is
  a separate piece of work.

## Architecture

Data generation moves to the Mac, which has an IP the sources accept. GitHub
Actions keeps doing what it already does well: deploying on push.

```
Mac — launchd, 4×/day                     GitHub
  ~/scripts/soccer-refresh.sh
    git reset --hard origin/main
    build_data.py    (England)
    build_japan.py   (Japan)   ──push──→  Actions: on push → deploy Pages
    build_china.py   (China)
    commit + push if changed
                                          Actions: cron every 6h
                                            → Japan still refreshes from
                                              jleague.jp; England/China skip
                                              cleanly (safety net when the
                                              Mac is off)
```

The CI cron is deliberately left in place. Japan's primary source works from CI,
so even with the Mac shut down for a week the Japan board stays current. The two
schedules are redundant, not competing.

## Components

### Working clone — `~/scripts/soccer/`

A normal clone of `FreiheitLee1912/Soccer`, sitting beside the existing
`~/scripts/` jobs. It holds no local state worth protecting: the refresh script
resets it to `origin/main` before every run, so a half-finished earlier run or a
stray edit can never be committed by accident.

Push uses the git credentials already configured on the machine. No new secret.

### Virtualenv — `~/scripts/soccer-venv/`

Deliberately outside the clone, so the repo's working tree stays clean and
`.gitignore` needs no new entry. Holds `requirements.txt` (`lxml`, `pykakasi`).

`curl_cffi` is not required. Plain `curl` reaches Transfermarkt from this
machine, and the retry added in `c01cf49` already absorbs the intermittent
maintenance page. Keep it in reserve: if Transfermarkt tightens to a fingerprint
check, swapping the transport in `build_data.fetch()` is the one-place fix.

### Refresh script — `~/scripts/soccer-refresh.sh`

One run, in order:

1. `git fetch origin && git reset --hard origin/main` — always build on top of
   whatever CI last committed.
2. Run the three builders in sequence, capturing each exit code and its stderr
   rather than letting a failure abort the script. All three already absorb a
   blocked source internally — they print `WARNING: … refresh skipped` (or
   `carrying values over`, for Japan) and exit 0 with their last-good data
   intact — so a non-zero exit means a genuine crash, and a skipped source is
   detected by matching `^WARNING:` in stderr. Both are worth a notification;
   neither may stop the remaining builders.
3. `git add *-transfers.csv data-*.js`; if nothing changed, stop without a commit.
4. Commit as `Refresh transfer data (local)` and push.
5. If the push is rejected because CI committed in the meantime, restart from
   step 1. At most one retry — a second rejection is worth a notification, not a
   loop.

Concurrency needs no lock: launchd will not start a job whose previous instance
is still running.

### launchd agent — `com.freihetlee.soccer-refresh`

`StartCalendarInterval` at 02:40, 08:40, 14:40, 20:40 local time. Fixed hours
rather than an interval, offset from the CI cron (`17 */6 * * *` UTC) so the two
rarely reach for the same push. A run missed while the Mac slept fires once on
wake, which a 6-hour cadence absorbs without any catch-up logic.

Naming and layout follow `com.freihetlee.wechat-media-cleanup`: label under
`com.freihetlee.`, `ProgramArguments` invoking `/bin/bash`, logs under
`~/scripts/`.

### Failure visibility

The whole reason this work exists is that a broken refresh looked like silence.
So:

- Every run appends one line per builder to `~/scripts/soccer-refresh.log`:
  timestamp, builder, result, row count.
- `StandardErrorPath` points at `~/scripts/soccer-refresh.err`.
- When a builder is skipped or the push fails twice, the script fires a macOS
  notification via `osascript -e 'display notification'`. One line of shell,
  and it converts a silent failure into something noticeable.

The log is append-only and small (a few lines per run); no rotation needed for
now.

## Error handling

| Condition | Behaviour |
|---|---|
| One source blocked | That builder prints `WARNING: …` and exits 0 with its last-good data; the others still run and commit. Detected by matching stderr, not by exit code. Notification. |
| A builder crashes (non-zero exit) | Logged with its stderr; remaining builders still run. Notification. |
| Transfermarkt maintenance page | Absorbed by the retry in `build_data.fetch()` (5 attempts). Only a persistent maintenance response reaches `SourceBlocked`. |
| No data changed | No commit, no push, no notification. Normal on a quiet day and for China, whose window closed 2026-07-22. |
| Push rejected (CI raced) | Reset and rebuild once, then push again. Second failure notifies. |
| Mac asleep at the scheduled hour | launchd runs the job on wake. |
| Mac off for days | CI cron keeps Japan current; England and China wait. |

## Testing

No unit tests — this is scheduling glue around builders that already have their
own guards. Verification is by observation:

1. Run `~/scripts/soccer-refresh.sh` by hand, confirm it commits, pushes, and the
   deployed `data-*.js` shows a new `generatedAt`.
2. Run it again immediately with nothing changed; confirm it exits without a commit.
3. Force a failure (point `build_data.SEASON` at a nonsense value in a scratch
   copy) and confirm the log line and the notification appear.
4. `launchctl kickstart` the agent to confirm it runs under launchd — the
   environment there is thinner than an interactive shell, which is where these
   jobs usually break.

## Rollout

1. Clone to `~/scripts/soccer/`, create `~/scripts/soccer-venv/`, install requirements.
2. Write `~/scripts/soccer-refresh.sh`, run it by hand until steps 1–3 above pass.
3. Write and load `~/Library/LaunchAgents/com.freihetlee.soccer-refresh.plist`.
4. `launchctl kickstart` once to prove it works unattended.
5. Leave the GitHub Actions workflow untouched.
