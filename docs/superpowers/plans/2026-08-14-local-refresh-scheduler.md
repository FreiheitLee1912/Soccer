# Local Refresh Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move transfer-data generation off GitHub Actions (whose IPs Transfermarkt blocks) onto a launchd job on the Mac, so all three boards refresh unattended and a failure is noticed.

**Architecture:** A dedicated clone at `~/scripts/soccer/` is reset to `origin/main`, runs the three existing builders, and pushes any changed data. GitHub Actions is untouched: it still deploys on push and still runs its cron, which keeps Japan current from jleague.jp whenever the Mac is off. Before Japan can be generated locally, a latent bug in `merge_mv()` must be fixed — it only stays hidden because CI cannot reach Transfermarkt.

**Tech Stack:** Python 3 (lxml, pykakasi), pytest, bash, launchd, git.

## Global Constraints

- Do NOT add `curl_cffi` to `requirements.txt`. Plain `curl` plus the retry in `build_data.fetch()` reaches Transfermarkt from this machine; TLS impersonation was measured to be useless from CI.
- Do NOT modify `.github/workflows/site.yml`. Its cron is the Japan safety net.
- The virtualenv lives at `~/scripts/soccer-venv/`, outside the clone, so the repo working tree stays clean and `.gitignore` needs no new entry.
- launchd label: `com.freihetlee.soccer-refresh`. Home directory is `/Users/freihetlee` (no "i" after "freih").
- Schedule: 02:40, 08:40, 14:40, 20:40 local time — offset from the CI cron (`17 */6 * * *` UTC).
- A blocked source is detected by matching `^WARNING:` on a builder's **stderr**, not by its exit code. All three builders deliberately exit 0 after keeping their last-good data.
- Canonical copies of the shell script and plist live in the repo under `ops/`; installing means copying them to `~/scripts/` and `~/Library/LaunchAgents/`.

---

### Task 1: Provision the local working clone and virtualenv

**Files:**
- Create: `~/scripts/soccer/` (clone of `FreiheitLee1912/Soccer`)
- Create: `~/scripts/soccer-venv/`
- Create: `requirements-dev.txt` in the repo

**Interfaces:**
- Produces: `~/scripts/soccer-venv/bin/python`, able to run all three builders and pytest from `~/scripts/soccer/`. Every later task's commands assume both paths exist.

- [ ] **Step 1: Clone the repository**

```bash
gh repo clone FreiheitLee1912/Soccer ~/scripts/soccer
```

- [ ] **Step 2: Add the dev requirements file**

Create `~/scripts/soccer/requirements-dev.txt`:

```
-r requirements.txt
pytest
```

- [ ] **Step 3: Create the virtualenv and install dependencies**

```bash
python3 -m venv ~/scripts/soccer-venv
~/scripts/soccer-venv/bin/pip install -r ~/scripts/soccer/requirements-dev.txt
~/scripts/soccer-venv/bin/python -c "import lxml, pykakasi, pytest; print('deps ok')"
```

Expected: `deps ok`.

- [ ] **Step 4: Verify the Transfermarkt-backed builders reach their sources**

```bash
cd ~/scripts/soccer && ~/scripts/soccer-venv/bin/python build_data.py
```

Expected: four `England …: N clubs, N rows` lines, then `wrote england-transfers.csv -> data-england.js: 92 clubs, …`.

If it prints `WARNING: England refresh skipped`, Transfermarkt is refusing this machine too — stop and re-diagnose. The whole design rests on this working.

```bash
cd ~/scripts/soccer && ~/scripts/soccer-venv/bin/python build_china.py
```

Expected: eight `中超/中甲/中乙 … season …` lines, then `wrote china-transfers.csv -> data-china.js: 54 clubs, 410 rows`.

- [ ] **Step 5: Verify push works from this clone**

```bash
cd ~/scripts/soccer && git push --dry-run origin main
```

Expected: `Everything up-to-date` with no credential prompt. A prompt here means the launchd job will hang later — fix the credential helper now.

- [ ] **Step 6: Discard the generated files and commit the requirements file**

The refresh script resets the clone before every run, so nothing generated during setup should be committed.

```bash
cd ~/scripts/soccer
git checkout -- '*-transfers.csv' 'data-*.js'
git add requirements-dev.txt
git commit -m "Add dev requirements for the builder test suite"
git push origin main
git status --short
```

Expected: `git status --short` prints nothing.

---

### Task 2: Stop transliterating katakana names back to Latin

`merge_mv()` currently contradicts its own comment at `build_japan.py:504-506` ("nothing for foreign katakana names — transliteration back to Latin is unreliable"). When Transfermarkt is reachable but a katakana name does not match, and there is no `FOREIGN_NAME_OVERRIDES` entry and no J.LEAGUE Latin spelling, it writes `romanize(name).title()` into the display name — turning `ジャクソン アーバイン` into `Jakuson Aabain`. CI never hits this because Transfermarkt is blocked there, so the bug lands the moment Japan is generated locally.

The branch is untestable in place because it sits inside a 60-line loop that needs the network. Extract it to a pure function first, then fix it.

**Files:**
- Modify: `build_japan.py:504-526` (extract), `build_japan.py` (add `resolve_name` above `merge_mv`)
- Create: `tests/test_resolve_name.py`

**Interfaces:**
- Consumes: the clone and virtualenv from Task 1.
- Produces: `resolve_name(name, hit, official_latin, profile_nationality, other_club) -> (player, roman, nationality)`. Each element is `None` when the caller should leave that field untouched. `hit` is a Transfermarkt record dict or `None`.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_resolve_name.py`:

```python
"""resolve_name() decides the display name, romaji subtitle and nationality
for one transfer row. The rule that keeps breaking: a katakana name must never
be transliterated back to Latin."""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from build_japan import resolve_name


def test_unmatched_katakana_without_a_latin_spelling_keeps_the_katakana():
    """The bug: pykakasi turned ジャクソン アーバイン into 'Jakuson Aabain'."""
    player, roman, _ = resolve_name(
        "ジャクソン アーバイン", None, None, None, "ザンクトパウリ (ドイツ)")
    assert player is None, "display name must stay as the parsed katakana"
    assert roman is None, "no subtitle is better than an invented spelling"


def test_unmatched_katakana_uses_a_hand_curated_override():
    player, roman, nationality = resolve_name(
        "イサーク キーセ テリン", None, None, None, "未定")
    assert (player, roman, nationality) == (
        "Isaac Kiese Thelin", "イサーク キーセ テリン", "Sweden")


def test_unmatched_katakana_uses_the_official_jleague_spelling():
    player, roman, _ = resolve_name(
        "パブロ サバック", None, "Pablo Sabbag", None, "未定")
    assert (player, roman) == ("Pablo Sabbag", "パブロ サバック")


def test_unmatched_katakana_takes_nationality_from_the_other_club():
    _, _, nationality = resolve_name(
        "ヤン ファンデンベルフ", None, None, None, "ヘンク (ベルギー)")
    assert nationality == "Belgium"


def test_matched_foreign_player_shows_latin_with_a_katakana_subtitle():
    hit = {"name": "Anderson Lopes", "nationality": "Brazil"}
    player, roman, _ = resolve_name(
        "アンデルソン ロペス", hit, None, None, "ライオン・シティ")
    assert (player, roman) == ("Anderson Lopes", "アンデルソン ロペス")


def test_matched_japanese_player_keeps_the_kanji_and_gains_a_subtitle():
    hit = {"name": "Kota Watanabe", "nationality": "Japan"}
    player, roman, _ = resolve_name(
        "渡辺 皓太", hit, None, None, "横浜F・マリノス")
    assert player is None, "kanji stays as the display name"
    assert roman == "Kota Watanabe"


def test_unmatched_kanji_falls_back_to_a_pykakasi_reading():
    """Kanji -> romaji is reliable; katakana -> Latin is not. Only this
    direction may use romanize()."""
    player, roman, nationality = resolve_name(
        "岩本 悠庵", None, None, None, "中京大学")
    assert player is None
    assert roman and roman[0].isupper()
    assert nationality == "Japan"
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd ~/scripts/soccer && ~/scripts/soccer-venv/bin/python -m pytest tests/test_resolve_name.py -v
```

Expected: all 7 fail with `ImportError: cannot import name 'resolve_name' from 'build_japan'`.

- [ ] **Step 3: Add `resolve_name` to `build_japan.py`**

Insert immediately above `def merge_mv(`:

```python
def resolve_name(name, hit, official_latin, profile_nationality, other_club):
    """Pick the display name, romaji subtitle and nationality for one row.

    Returns (player, roman, nationality); any element may be None, meaning the
    caller should leave that field as it is.

    Kanji romanises reliably, so an unmatched kanji name still earns a romaji
    subtitle. Katakana does not: pykakasi renders "ジャクソン アーバイン" as
    "Jakuson Aabain". With no override and no official spelling, the katakana
    IS the best display name we have.
    """
    if hit and is_katakana(name) and hit.get("nationality") != "Japan":
        return hit["name"], name, None
    if hit:
        return None, hit["name"], None
    if is_katakana(name):
        override_latin, override_nationality = FOREIGN_NAME_OVERRIDES.get(
            name, (None, None))
        latin = override_latin or official_latin
        nationality = (override_nationality or profile_nationality
                       or country_from_club(other_club))
        if latin:
            return latin, name, nationality
        return None, None, nationality
    return None, official_latin or romanize(name).title(), "Japan"
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd ~/scripts/soccer && ~/scripts/soccer-venv/bin/python -m pytest tests/test_resolve_name.py -v
```

Expected: 7 passed.

- [ ] **Step 5: Call it from `merge_mv`**

Replace `build_japan.py` lines 511-526 (the `if hit and is_katakana(name)` … `flags.get("Japan")` chain) with:

```python
        player, roman, nationality = resolve_name(
            name, hit, official_latin, profile_nationality, r["otherClub"])
        if player:
            r["player"] = player
        if roman:
            r["roman"] = roman
        if nationality:
            r["nationality"] = nationality
            r["nationalityFlag"] = flags.get(nationality)
```

Leave the `if hit is not None:` block that follows exactly as it is — it still overwrites `nationality` from the Transfermarkt record for matched rows.

- [ ] **Step 6: Verify the whole builder still runs and produces no invented names**

```bash
cd ~/scripts/soccer && ~/scripts/soccer-venv/bin/python build_japan.py
```

Expected: ends with `wrote japan-transfers.csv -> data-japan.js: 60 clubs, …` and `manual entries added: 1`.

Then confirm the four names that regressed on 2026-08-11 survived:

```bash
cd ~/scripts/soccer && for n in "ジャクソン アーバイン" "パブロ サバック" "ヤン ファンデンベルフ" "ハッサン ヒル"; do printf '%-24s ' "$n"; grep -qF "$n" data-japan.js && echo OK || echo MISSING; done; for b in Jakuson Paburo Fandenberufu "Hasan Hilu"; do printf '%-16s ' "$b"; grep -qF "$b" data-japan.js && echo "GARBAGE PRESENT" || echo absent; done
```

Expected: four `OK`, four `absent`.

- [ ] **Step 7: Commit**

```bash
cd ~/scripts/soccer
git add requirements-dev.txt tests/test_resolve_name.py build_japan.py japan-transfers.csv data-japan.js
git commit -m "Never transliterate katakana names back to Latin

merge_mv() contradicted its own comment: an unmatched katakana name with no
override and no official spelling was passed through pykakasi, so a locally
generated build renamed ジャクソン アーバイン to 'Jakuson Aabain'. CI never hit
it because Transfermarkt is blocked there.

Extract the branch to resolve_name() so it can be tested without the network,
and keep the katakana when there is no real Latin spelling to use."
```

---

### Task 3: Write the refresh script

**Files:**
- Create: `ops/soccer-refresh.sh` in the repo (canonical copy)
- Create: `~/scripts/soccer-refresh.sh` (installed copy)

**Interfaces:**
- Consumes: `~/scripts/soccer/` and `~/scripts/soccer-venv/bin/python` from Task 2.
- Produces: `~/scripts/soccer-refresh.log`, and a script that exits 0 on success, 1 when a full cycle failed twice.

- [ ] **Step 1: Write the script**

Create `ops/soccer-refresh.sh` in the repo:

```bash
#!/bin/bash
# Soccer transfer boards — local data refresh.
#
# Transfermarkt and SofaScore refuse GitHub Actions IPs, so data generation runs
# here and only the result is pushed; GitHub Actions deploys on push. See
# docs/superpowers/specs/2026-08-11-local-refresh-scheduler-design.md
#
# Installed to ~/scripts/soccer-refresh.sh and driven by launchd
# (com.freihetlee.soccer-refresh). Edit the copy in the repo, then reinstall.

set -uo pipefail

# launchd hands over a minimal PATH; git and python must be found explicitly.
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin"

REPO="$HOME/scripts/soccer"
PY="$HOME/scripts/soccer-venv/bin/python"
LOG="$HOME/scripts/soccer-refresh.log"
BUILDERS=(build_data.py build_japan.py build_china.py)

ts()     { date '+%Y-%m-%d %H:%M:%S'; }
log()    { echo "$(ts) $*" >> "$LOG"; }
notify() { osascript -e "display notification \"$1\" with title \"Soccer refresh\"" >/dev/null 2>&1; }

problems=0

run_cycle () {
  problems=0
  cd "$REPO" || { log "ERROR: no repo at $REPO"; return 1; }

  git fetch -q origin && git reset -q --hard origin/main || {
    log "ERROR: could not sync with origin/main"
    return 1
  }

  # Each builder keeps its own last-good data and exits 0 when its source is
  # blocked, so a skip is only visible on stderr. Never let one stop the others.
  local builder err
  for builder in "${BUILDERS[@]}"; do
    err=$(mktemp)
    if "$PY" "$builder" >/dev/null 2>"$err"; then
      if grep -q '^WARNING:' "$err"; then
        log "SKIP $builder — $(grep -m1 '^WARNING:' "$err" | cut -c1-140)"
        problems=$((problems + 1))
      else
        log "OK   $builder"
      fi
    else
      log "FAIL $builder — $(tail -n 1 "$err" | cut -c1-140)"
      problems=$((problems + 1))
    fi
    rm -f "$err"
  done

  git add -- '*-transfers.csv' 'data-*.js'
  if git diff --cached --quiet; then
    log "no data changes"
    return 0
  fi
  git commit -q -m "Refresh transfer data (local)" || {
    log "ERROR: commit failed"; return 1; }
  git push -q origin main || {
    log "push rejected (CI probably committed first)"; return 1; }
  log "pushed $(git rev-parse --short HEAD)"
}

if ! run_cycle; then
  log "retrying the cycle once"
  if ! run_cycle; then
    log "ERROR: refresh failed twice, giving up until the next run"
    notify "refresh failed twice — see soccer-refresh.log"
    exit 1
  fi
fi

if [ "$problems" -gt 0 ]; then
  notify "$problems source(s) skipped or failed — see soccer-refresh.log"
fi
exit 0
```

- [ ] **Step 2: Install it and make it executable**

```bash
cp ~/scripts/soccer/ops/soccer-refresh.sh ~/scripts/soccer-refresh.sh
chmod +x ~/scripts/soccer-refresh.sh
```

- [ ] **Step 3: Run it once by hand**

```bash
~/scripts/soccer-refresh.sh; echo "exit=$?"; cat ~/scripts/soccer-refresh.log
```

Expected: `exit=0`, and a log showing `OK   build_data.py`, `OK   build_japan.py`, `OK   build_china.py`, then either `pushed <sha>` or `no data changes`.

- [ ] **Step 4: Run it again immediately to prove it is idempotent**

```bash
~/scripts/soccer-refresh.sh; echo "exit=$?"; tail -5 ~/scripts/soccer-refresh.log
```

Expected: `exit=0` and `no data changes` — China's window is closed and England/Japan will not have moved in seconds, so there must be no second commit.

- [ ] **Step 5: Prove a blocked source is detected**

Confirm the stderr-matching branch works, using a scratch copy so the real clone is untouched:

```bash
cd ~/scripts/soccer && cp build_data.py /tmp/build_data.bak && \
  sed -i '' 's/^SEASON = "2026"/SEASON = "1899"/' build_data.py && \
  ~/scripts/soccer-venv/bin/python build_data.py; echo "exit=$?"; \
  cp /tmp/build_data.bak build_data.py
```

Expected: `WARNING: England refresh skipped — …` on stderr and `exit=0`. That is the exact combination the script keys on.

- [ ] **Step 6: Commit the canonical copy**

```bash
cd ~/scripts/soccer
git add ops/soccer-refresh.sh
git commit -m "Add the local refresh script

Resets the clone to origin/main, runs the three builders, and pushes whatever
data changed. A blocked source is detected by matching ^WARNING: on stderr,
since every builder deliberately exits 0 after keeping its last-good data."
git push origin main
```

---

### Task 4: Install and verify the launchd agent

**Files:**
- Create: `ops/com.freihetlee.soccer-refresh.plist` in the repo (canonical copy)
- Create: `~/Library/LaunchAgents/com.freihetlee.soccer-refresh.plist` (installed copy)

**Interfaces:**
- Consumes: `~/scripts/soccer-refresh.sh` from Task 3.

- [ ] **Step 1: Write the plist**

Create `ops/com.freihetlee.soccer-refresh.plist`, following the layout of the existing `com.freihetlee.wechat-media-cleanup` agent:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.freihetlee.soccer-refresh</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>/Users/freihetlee/scripts/soccer-refresh.sh</string>
    </array>
    <key>StartCalendarInterval</key>
    <array>
        <dict><key>Hour</key><integer>2</integer><key>Minute</key><integer>40</integer></dict>
        <dict><key>Hour</key><integer>8</integer><key>Minute</key><integer>40</integer></dict>
        <dict><key>Hour</key><integer>14</integer><key>Minute</key><integer>40</integer></dict>
        <dict><key>Hour</key><integer>20</integer><key>Minute</key><integer>40</integer></dict>
    </array>
    <key>StandardErrorPath</key>
    <string>/Users/freihetlee/scripts/soccer-refresh.err</string>
</dict>
</plist>
```

- [ ] **Step 2: Install and load it**

```bash
cp ~/scripts/soccer/ops/com.freihetlee.soccer-refresh.plist ~/Library/LaunchAgents/
plutil -lint ~/Library/LaunchAgents/com.freihetlee.soccer-refresh.plist
launchctl bootout gui/$(id -u)/com.freihetlee.soccer-refresh 2>/dev/null
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.freihetlee.soccer-refresh.plist
launchctl print gui/$(id -u)/com.freihetlee.soccer-refresh | head -20
```

Expected: `plutil` prints `OK`, and `launchctl print` shows the job with `state = waiting`.

- [ ] **Step 3: Force a run under launchd**

This is the step that catches the usual failure — the launchd environment is thinner than an interactive shell.

```bash
launchctl kickstart -k gui/$(id -u)/com.freihetlee.soccer-refresh
sleep 90
tail -12 ~/scripts/soccer-refresh.log; echo "--- stderr ---"; cat ~/scripts/soccer-refresh.err
```

Expected: fresh `OK` lines in the log with the current timestamp, and an empty `soccer-refresh.err`.

If the log shows nothing, the script never started — check the plist path. If it shows a git error or hangs, the credential helper is not available to launchd; switch the remote to SSH with `cd ~/scripts/soccer && git remote set-url origin git@github.com:FreiheitLee1912/Soccer.git` and repeat this step.

- [ ] **Step 4: Confirm the site actually moved**

```bash
curl -s "https://freiheitlee1912.github.io/Soccer/data-england.js" | head -c 400 | grep -o '"generatedAt":"[^"]*"'
```

Expected: a `generatedAt` within the last few minutes (allow a minute or two for the Pages deploy).

- [ ] **Step 5: Commit the canonical copy**

```bash
cd ~/scripts/soccer
git add ops/com.freihetlee.soccer-refresh.plist
git commit -m "Add the launchd agent for the local refresh

Runs at 02:40/08:40/14:40/20:40 local, offset from the CI cron so the two
rarely race for the same push. launchd will not start a second instance while
one is running, so the script needs no lock."
git push origin main
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| Working clone `~/scripts/soccer/` | 1 |
| Virtualenv `~/scripts/soccer-venv/`, outside the clone | 1 |
| `curl_cffi` deliberately not adopted | Global Constraints |
| Refresh script: reset → build → commit → push, one retry | 3 |
| Skip detection via stderr, not exit code | 3 (step 1), verified 3 (step 5) |
| launchd agent, four fixed times, offset from CI | 4 |
| Failure visibility: log + notification | 3 (step 1), verified 4 (step 3) |
| No lock needed (launchd single-instance) | 4 (step 5 commit message) |
| Testing: manual run, idempotent re-run, forced failure, kickstart | 3 (steps 3-5), 4 (step 3) |
| Rollout order | Tasks 1 → 2 → 3 → 4, in order |
| CI workflow untouched | Global Constraints |

The katakana fix is not in the spec — it was identified after the spec was approved, as a prerequisite for generating Japan locally. It is Task 2.

**Verified before publishing:** the seven assertions in Task 2's test file were run against Task 2's `resolve_name` implementation; all seven pass. Two incidental findings worth knowing while implementing: `country_from_club("ザンクトパウリ (ドイツ)")` resolves to `Germany`, so an unmatched katakana row still gets a flag even with no Latin spelling; and `romanize("岩本 悠庵")` returns `Iwamoto Yuuiori`, a misreading — which is why the manual entry for that player pins `roman` by hand rather than relying on pykakasi.
