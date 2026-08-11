#!/usr/bin/env python3
"""Scrape Transfermarkt transfers (per club, in & out, with age / position /
market value / fee) for one or more leagues per country, and emit a data file
per country: data-<country>.js  (window.TRANSFER_DATA = {...}).

Transfermarkt is the single source of truth: each competition page's own club
list defines that division, so pages stay self-consistent. Fees & market values
are Transfermarkt estimates, in EUR.

Re-run to refresh:  python3 build_data.py
"""
import json, re, subprocess, datetime, sys, time
import csv_data


class SourceBlocked(RuntimeError):
    """Transfermarkt returned an empty/blocked page (common from CI IPs)."""

SEASON = "2026"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

# country -> (display name, [(division label, TM competition code, url slug)])
COUNTRIES = {
    "england": ("England", [("Premier League", "GB1", "premier-league"),
                             ("Championship", "GB2", "championship"),
                             ("League One", "GB3", "league-one"),
                             ("League Two", "GB4", "league-two")]),
    "japan":   ("Japan",  [("J1", "JAP1", "j1-league"),
                           ("J2", "JAP2", "j2-league"),
                           ("J3", "JAP3", "j3-league")]),
}

# Confirmed exceptions where the paired rows are bookkeeping around a player
# who ultimately remains with the displayed club. Keep these IN rows active.
ACTIVE_IN_ROW_OVERRIDES = {
    ("Arsenal FC", "425918"),  # Jakub Kiwior: explicitly verified as active
}


def is_maintenance(html_text):
    """Some Transfermarkt edge nodes answer with a ~22KB maintenance page at
    random — big enough to pass a size check, so it has to be spotted by title
    or it gets parsed as a real page and looks like a layout change."""
    m = re.search(r"<title>(.*?)</title>", html_text[:4000], re.S)
    return bool(m) and "maintenance" in m.group(1).lower()


def fetch(code, slug, attempts=5):
    url = ("https://www.transfermarkt.com/%s/transfers/wettbewerb/%s/saison_id/%s"
           % (slug, code, SEASON))
    last = ""
    for attempt in range(attempts):
        r = subprocess.run(
            ["curl", "-s", "--max-time", "45", "-A", UA,
             "-H", "Accept-Language: en-US,en;q=0.9", url],
            capture_output=True, text=True)
        html = r.stdout or ""
        if r.returncode == 0 and len(html) > 5000:      # a real page is ~800KB
            if not is_maintenance(html):
                return html
            last = "maintenance page"
        else:
            last = "rc=%d len=%d" % (r.returncode, len(html))
        if attempt < attempts - 1:
            time.sleep(6)
    raise SourceBlocked("empty/blocked response for %s (%s)" % (code, last))


def norm(x):
    return re.sub(r"\s+", " ", x or "").strip()


def money(s):
    s = norm(s)
    if not s or s == "-":
        return "?", None
    low = s.lower()
    if "free" in low:
        return "Free", 0.0
    if low.startswith("end of loan"):
        return "End of loan", None
    if "loan fee" in low:
        m = re.search(r"€([\d.]+)m", s)
        return ("Loan €%sm" % m.group(1), float(m.group(1))) if m else ("Loan", None)
    if low == "loan" or low.startswith("loan transfer"):
        return "Loan", None
    if low.startswith("draft"):
        return "?", None
    m = re.search(r"€([\d.]+)m", s)
    if m:
        return "€%sm" % m.group(1), float(m.group(1))
    m = re.search(r"€([\d.]+)k", s)
    if m:
        return s, round(float(m.group(1)) / 1000, 3)
    return s, None


def kind(fee_label):
    if fee_label == "End of loan":
        return "loan-return"
    if fee_label.startswith("Loan"):
        return "loan"
    if fee_label == "Free":
        return "free"
    if fee_label.startswith("€"):
        return "transfer"
    return "other"


ACADEMY_SUFFIX_RE = re.compile(
    r"\s+(?:u(?:18|19|20|21|23)|b|ii|reserves?|youth)$", re.I)
ACADEMY_ZH_SUFFIX_RE = re.compile(
    r"(?:u(?:18|19|20|21|23)|b|二|青年|预备|梯)队$", re.I)
CLUB_ALIASES = {
    "man utd": "manchester united", "man u": "manchester united",
    "man city": "manchester city", "sheff wed": "sheffield wednesday",
    "sheff utd": "sheffield united", "peterboro": "peterborough",
    "huddersf": "huddersfield", "west brom": "west bromwich",
    "qpr": "queens park rangers", "spurs": "tottenham hotspur",
}


def club_name_key(name):
    value = re.sub(r"[^a-z0-9]+", " ", (name or "").lower()).strip()
    for short, full in CLUB_ALIASES.items():
        value = re.sub(rf"\b{re.escape(short)}\b", full, value)
    return " ".join(x for x in value.split() if x not in ("fc", "afc"))


def is_academy_promotion(club, other_club):
    """True only for a move from this club's own youth/reserve side."""
    if ACADEMY_ZH_SUFFIX_RE.search(other_club or ""):
        parent = ACADEMY_ZH_SUFFIX_RE.sub("", other_club)
        first_team = re.sub(r"队$", "", club or "")
        return bool(parent and first_team and parent == first_team)
    if ACADEMY_SUFFIX_RE.search(other_club or ""):
        parent = ACADEMY_SUFFIX_RE.sub("", other_club)
    else:
        return False
    club_key, parent_key = club_name_key(club), club_name_key(parent)
    return (club_key == parent_key or club_key.startswith(parent_key + " ")
            or parent_key.startswith(club_key + " "))


def parse_competition(html_text, league):
    from lxml import html
    if not html_text or len(html_text) < 5000:
        raise SourceBlocked("empty page for %s" % league)
    try:
        tree = html.fromstring(html_text)
    except Exception as e:
        raise SourceBlocked("unparseable page for %s: %s" % (league, e))
    heads = tree.xpath('//h2[contains(@class,"content-box-headline")]'
                       '[.//a[contains(@href,"verein") or '
                       'contains(@href,"startseite")]]')
    clubs = [norm(h.text_content()) for h in heads]
    if not clubs:
        raise SourceBlocked("no clubs for %s (blocked or layout change)" % league)

    def rows(t, club, direction):
        out = []
        for tr in t.xpath('.//tbody/tr[.//a[contains(@href,"/profil/spieler/")]]'):
            title = tr.xpath('.//a[contains(@href,"/profil/spieler/")]/@title')
            profile = tr.xpath('.//a[contains(@href,"/profil/spieler/")]/@href')
            cells = [norm(td.text_content()) for td in tr.xpath('./td')]
            if not title or len(cells) < 9:
                continue
            fee_label, fee_val = money(cells[8])
            fee_type = kind(fee_label)
            if direction == "in" and is_academy_promotion(club, cells[7]):
                fee_label, fee_val, fee_type = "Promotion", None, "promotion"
            mv_label, mv_val = money(cells[5])
            nationality = tr.xpath('./td[3]//img/@title')
            flags = tr.xpath('./td[3]//img/@src')
            flag = flags[0] if flags else None
            if flag and flag.startswith('//'):
                flag = 'https:' + flag
            player_id = None
            if profile:
                match = re.search(r'/spieler/(\d+)', profile[0])
                player_id = match.group(1) if match else None
            out.append({
                "player": title[0], "club": club, "league": league,
                "playerId": player_id,
                "direction": direction, "otherClub": cells[7],
                "age": cells[1] or None, "position": cells[3] or None,
                "pos": cells[4] or None,
                "nationality": nationality[0] if nationality else None,
                "nationalityFlag": flag,
                "marketValue": mv_label, "marketValueNum": mv_val,
                "fee": fee_label, "feeValue": fee_val, "type": fee_type,
            })
        return out

    club_meta, recs = [], []
    for head, club in zip(heads, clubs):
        logos = head.xpath('.//img[contains(@src,"/wappen/")]/@src')
        logo = logos[0] if logos else None
        if logo and logo.startswith('//'):
            logo = 'https:' + logo
        club_meta.append({"name": club, "league": league, "logo": logo})
        tables = head.getparent().xpath('.//table')[:2]
        for table in tables:
            first = norm(' '.join(table.xpath('.//thead//th[1]//text()'))).lower()
            recs += rows(table, club, "out" if first == "out" else "in")
    return club_meta, recs


def apply_in_row_status(recs):
    """Mute an IN row when the player later leaves the displayed club.

    A non-return OUT row means the player departs permanently or on loan. An
    incoming loan paired only with an OUT loan-return also ends outside the
    displayed club. Conversely, a permanent/free IN paired only with an OUT
    loan-return is the common loan-buyout bookkeeping pattern and stays active.
    """
    outs = {}
    for row in recs:
        if row.get("direction") != "out":
            continue
        key = (row.get("club"), row.get("playerId") or row.get("player"))
        outs.setdefault(key, []).append(row)

    for row in recs:
        row["rowMuted"] = False
        if row.get("direction") != "in":
            continue
        key = (row.get("club"), row.get("playerId") or row.get("player"))
        paired_outs = outs.get(key, [])
        left_club = any(x.get("type") != "loan-return" for x in paired_outs)
        loan_ended = (row.get("type") == "loan" and
                      any(x.get("type") == "loan-return" for x in paired_outs))
        row["rowMuted"] = ((left_club or loan_ended) and
                           key not in ACTIVE_IN_ROW_OVERRIDES)


def build_country(key):
    display, comps = COUNTRIES[key]
    clubs, recs, divisions = [], [], []
    for label, code, slug in comps:
        cm, rc = parse_competition(fetch(code, slug), label)
        clubs += cm
        recs += rc
        divisions.append(label)
        print("  %s %s: %d clubs, %d rows" % (display, label, len(cm), len(rc)))
    apply_in_row_status(recs)
    out = {
        "generatedAt": datetime.datetime.now(datetime.timezone.utc)
                        .strftime("%Y-%m-%d %H:%M UTC"),
        "source": "Transfermarkt · %s %s (fees & values are estimates, EUR)"
                  % (display, "/".join(divisions)),
        "currency": "€", "country": display, "divisions": divisions,
        "clubs": clubs, "transfers": recs,
    }
    result = csv_data.write_csv_and_js(
        out, "%s-transfers.csv" % key, "data-%s.js" % key)
    print("wrote %s-transfers.csv -> data-%s.js: %d clubs, %d rows"
          % (key, key, len(result["clubs"]), len(result["transfers"])))


def main():
    # Only England is written to a data file here. Japan's data file comes from
    # build_japan.py (official J.League source); build_data's Japan config is
    # used solely by build_japan.tm_index() for market-value enrichment, so we
    # must NOT write data-japan.js here or it would clobber the official one.
    try:
        build_country("england")
    except SourceBlocked as e:
        # Transfermarkt commonly blocks CI/datacenter IPs. Don't fail the build:
        # keep the last-good data-england.js so the site still deploys.
        sys.stderr.write("WARNING: England refresh skipped — %s. "
                         "Keeping existing data-england.js.\n" % e)


if __name__ == "__main__":
    main()
