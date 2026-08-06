#!/usr/bin/env python3
"""Build data-japan.js from the OFFICIAL J.League transfer pages
(jleague.jp/{j1,j2,j3}/special/transfer/), which carry native Japanese player &
club names and the official transfer category (移籍種別). No fees/market values
exist there — those are enriched separately from Transfermarkt (see merge_mv()).

Re-run to refresh:  python3 build_japan.py
"""
import csv, json, re, subprocess, datetime, sys, os
from concurrent.futures import ThreadPoolExecutor, as_completed
import csv_data

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
LEAGUES = [("J1", "j1"), ("J2", "j2"), ("J3", "j3")]
SUMMER_START = "2026-06-01"   # keep only this summer's window

POS = {"GK": "gk", "DF": "def", "MF": "mid", "FW": "fwd"}
CLUB_NAME_OVERRIDES = {"gunma": "ザスパ群馬"}


def fetch(slug):
    url = "https://www.jleague.jp/%s/special/transfer/" % slug
    return subprocess.run(["curl", "-s", "--max-time", "50", "-A", UA, url],
                          capture_output=True, text=True, check=True).stdout


def fetch_club_logo(club_key):
    """Resolve a club's current official SVG crest from its J.LEAGUE page."""
    url = "https://www.jleague.jp/club/%s/player/" % club_key
    html = subprocess.run(
        ["curl", "-L", "-s", "--max-time", "25", "--retry", "2",
         "--retry-delay", "1", "-A", UA, url],
        capture_output=True, text=True).stdout
    match = re.search(r'(/image/clubs/[^"\\]+\.svg)', html)
    return "https://www.jleague.jp" + match.group(1) if match else None


def enrich_club_logos(clubs):
    """Attach one official crest URL to every club before CSV generation."""
    keys = sorted({c.get("key") for c in clubs if c.get("key")})
    logos = {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pool.submit(fetch_club_logo, key): key for key in keys}
        for future in as_completed(futures):
            key = futures[future]
            try:
                logo = future.result()
            except Exception:
                logo = None
            if logo:
                logos[key] = logo
    for club in clubs:
        club["logo"] = logos.get(club.get("key"))
    print("  J.LEAGUE club crests: %d/%d" % (len(logos), len(keys)))
    return logos


def slice_array(s, start):
    """Return the JSON array string beginning at s[start]=='[' (quote-aware)."""
    depth, i, instr, esc = 0, start, False, False
    while i < len(s):
        c = s[i]
        if instr:
            if esc: esc = False
            elif c == "\\": esc = True
            elif c == '"': instr = False
        else:
            if c == '"': instr = True
            elif c == "[": depth += 1
            elif c == "]":
                depth -= 1
                if depth == 0:
                    return s[start:i + 1]
        i += 1
    raise ValueError("unterminated array")


def transfer_type(raw):
    r = raw or ""
    if "復帰" in r:
        return "loan-return"
    if "満了" in r and ("期限" in r or "レンタル" in r):
        return "loan-return"          # loan expired, back to parent
    if "期限付" in r or "レンタル" in r:
        return "loan"
    if any(k in r for k in ("引退", "契約満了", "契約解除")):
        return "other"                # retirement / release
    if r == "":
        return "other"
    return "transfer"                 # 新加入 / 完全移籍


def maj_key(items):
    keys = [it.get("player", {}).get("legacyPlayerPhotoLookup", {})
              .get("teamNameKey") for it in items]
    keys = [k for k in keys if k]
    return max(set(keys), key=keys.count) if keys else None


def parse_page(html, league):
    u = html.replace('\\"', '"')
    # key -> FULL official club name, from the footer club list (aria-label)
    fullmap = {}
    for key, name in re.findall(
            r'href="/club/([a-z0-9-]+)/"[^>]*>.*?aria-label="([^"]+)"', u):
        fullmap.setdefault(key, name)
    fullmap.update(CLUB_NAME_OVERRIDES)

    # direction comes from the in/out badge that precedes each table (document
    # order, 1:1 with the transfersList arrays). The badge label is reliable;
    # the per-block teamNameKey is reliable only for IN blocks (outgoing players
    # who already moved carry their NEW club's key), so we take the club order
    # from the IN blocks and map OUT blocks onto that order by position.
    variants = [m.group(1) for m in re.finditer(r'"variant":"(in|out)"', u)]
    tls = [m.end() for m in re.finditer(r'"transfersList":', u)]
    if len(variants) != len(tls):
        sys.exit("%s: %d badges vs %d tables" % (league, len(variants), len(tls)))

    in_items, out_items = [], []
    for direction, p in zip(variants, tls):
        try:
            items = json.loads(slice_array(u, u.index("[", p - 1)))
        except (json.JSONDecodeError, ValueError):
            items = []
        (in_items if direction == "in" else out_items).append(items)

    club_order = [maj_key(items) for items in in_items]      # canonical order
    if len(in_items) != len(out_items) or None in club_order:
        sys.exit("%s: IN %d / OUT %d, unresolved club"
                 % (league, len(in_items), len(out_items)))

    clubs, rows = [], []

    def emit(items, key, direction):
        club = fullmap.get(key, key)
        for it in items:
            p = it.get("player", {})
            other = it.get("transferToClub", {}) or {}
            other_name = (other.get("name") or "").strip() or "—"
            other_href = other.get("href") or ""
            other_match = re.search(r"/club/([a-z0-9-]+)", other_href)
            if other_match:
                # J.LEAGUE tables use short labels (G大阪, 鹿島, 鳥栖...).
                # Resolve their club href back to the official full name.
                other_name = fullmap.get(other_match.group(1), other_name)
            pos = p.get("position") or ""
            raw = it.get("transferType", "") or ""
            lookup = p.get("legacyPlayerPhotoLookup", {}) or {}
            player_id = lookup.get("playerId") or p.get("playerId")
            if not player_id:
                href = p.get("href") or ""
                match = re.search(r"/player/(\d+)", href)
                player_id = match.group(1) if match else None
            rows.append({
                "player": p.get("name", "").strip(),
                "club": club, "clubKey": key, "league": league,
                "direction": direction,
                "otherClub": other_name,
                "pos": pos, "position": pos, "transferType": raw,
                "date": (it.get("date") or "").replace("$D", "")[:10],
                "type": transfer_type(raw), "age": None, "roman": None,
                "playerId": str(player_id) if player_id else None,
                "marketValueNum": None, "marketValue": None,
                "fee": None, "feeValue": None, "ftype": None, "matched": False,
            })

    for key, items in zip(club_order, in_items):
        clubs.append({"name": fullmap.get(key, key), "league": league, "key": key})
        emit(items, key, "in")
    for key, items in zip(club_order, out_items):     # OUT mapped by position
        emit(items, key, "out")
    return clubs, rows


# ---- market-value enrichment from Transfermarkt --------------------------
# The official data has no romaji, so every player name is romanised with
# pykakasi (handles kanji readings + kana) and fuzzy-matched to Transfermarkt's
# romaji names + market values. Names are normalised (long vowels collapsed,
# tokens sorted) so "佐藤 龍之介" (family-given) matches TM's "Ryunosuke Sato".
import difflib
try:
    import pykakasi
    _KKS = pykakasi.kakasi()
except ImportError:
    _KKS = None


def romanize(name):
    if _KKS is None:
        return name
    return ' '.join(''.join(x['hepburn'] for x in _KKS.convert(name)).split())


def japanese_key(name):
    """Normalise native names without losing Japanese characters."""
    value = (name or "").translate(str.maketrans({
        "髙": "高", "﨑": "崎", "邊": "辺", "邉": "辺", "濵": "浜",
        "瀨": "瀬", "德": "徳", "澤": "沢", "齋": "斎", "齊": "斉",
    }))
    return re.sub(r"[\s　・·]", "", value)


def fetch_jleague_profile(player_id):
    """Return the official Latin name and birthplace from a J.LEAGUE profile."""
    url = "https://www.jleague.jp/player/%s/" % player_id
    html = subprocess.run(
        ["curl", "-L", "-s", "--max-time", "25", "--retry", "2",
         "--retry-delay", "1", "-A", UA, url],
        capture_output=True, text=True).stdout
    # Next.js serialises these values in the initial HTML.  Decode only the
    # JSON escaping needed by Japanese/Latin names.
    name_match = re.search(r'\\?"playerNameEn\\?":\\?"([^"\\]+)', html)
    birth_match = re.search(r'\\?"placeOfBirth\\?":\\?"([^"\\]+)', html)
    if not name_match:
        return None
    return {
        "nameEn": name_match.group(1).strip(),
        "placeOfBirth": birth_match.group(1).strip() if birth_match else None,
    }


def jleague_profiles(rows):
    """Fetch official Latin spellings once per J.LEAGUE player ID."""
    ids = sorted({r.get("playerId") for r in rows if r.get("playerId")})
    profiles = {}
    # Reuse spellings already verified into the CSV. Scheduled GitHub runs
    # then fetch profiles only for newly appearing player IDs instead of
    # requesting hundreds of unchanged pages every six hours.
    if os.path.exists("japan-transfers.csv"):
        with open("japan-transfers.csv", encoding="utf-8-sig", newline="") as handle:
            for cached in csv.DictReader(handle):
                pid = cached.get("playerId")
                if not pid or pid not in ids:
                    continue
                roman, player = cached.get("roman", ""), cached.get("player", "")
                latin = roman if roman and not re.search(r"[ぁ-ヶ一-龯]", roman) else player
                if latin and not re.search(r"[ぁ-ヶ一-龯]", latin):
                    profiles[pid] = {
                        "nameEn": latin,
                        "nationality": cached.get("nationality") or None,
                    }
    # The official site occasionally drops bursts of profile requests. Retry
    # only the misses at lower concurrency so a temporary response does not
    # turn into a missing Latin name or flag in the final CSV.
    for workers in (6, 3):
        missing = [pid for pid in ids if pid not in profiles]
        if not missing:
            break
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(fetch_jleague_profile, pid): pid
                       for pid in missing}
            for future in as_completed(futures):
                pid = futures[future]
                try:
                    value = future.result()
                except Exception:
                    value = None
                if value:
                    profiles[pid] = value
    print("  J.LEAGUE profiles: %d/%d Latin names" % (len(profiles), len(ids)))
    return profiles


def is_katakana(name):
    core = [ch for ch in name if ch not in ' 　・ー']
    return bool(core) and all('ァ' <= ch <= 'ヶ' for ch in core)


def norm_key(s):
    s = (s or '').lower()
    for a, b in (('ō', 'o'), ('ū', 'u'), ('â', 'a'), (' î', 'i'), ('ô', 'o')):
        s = s.replace(a, b)
    s = re.sub(r'ou', 'o', s)
    s = re.sub(r'uu', 'u', s)
    s = re.sub(r'(.)\1+', r'\1', s)          # collapse any doubled letter
    toks = re.findall(r'[a-z]+', s)
    return ''.join(sorted(toks))             # order-independent (name/family)


def tm_index():
    """All TM Japan transfer rows, including players without a market value."""
    import build_data
    idx = []
    for _, code, slug in build_data.COUNTRIES["japan"][1]:
        _, recs = build_data.parse_competition(build_data.fetch(code, slug), "")
        for r in recs:
            idx.append((norm_key(r["player"]),
                        {"mv": r.get("marketValueNum"), "age": r.get("age"),
                         "name": r["player"], "fee": r.get("fee"),
                         "feeValue": r.get("feeValue"), "ftype": r.get("type"),
                         "nationality": r.get("nationality"),
                         "nationalityFlag": r.get("nationalityFlag"),
                         "playerId": r.get("playerId")}))
    return idx


COUNTRY_JA = {
    "ブラジル": "Brazil", "韓国": "Korea, South", "大韓民国": "Korea, South",
    "中国": "China", "台湾": "Taiwan", "オーストラリア": "Australia",
    "スペイン": "Spain", "ポルトガル": "Portugal", "フランス": "France",
    "ドイツ": "Germany", "ポーランド": "Poland", "クロアチア": "Croatia",
    "セルビア": "Serbia", "ナイジェリア": "Nigeria", "ガーナ": "Ghana",
    "ミャンマー": "Myanmar", "シンガポール": "Singapore",
    "フィリピン": "Philippines", "タイ": "Thailand", "マレーシア": "Malaysia",
    "インドネシア": "Indonesia", "ベトナム": "Vietnam", "カタール": "Qatar",
    "イラン": "Iran", "イラク": "Iraq", "コロンビア": "Colombia",
    "ボリビア": "Bolivia", "アルゼンチン": "Argentina", "ウルグアイ": "Uruguay",
    "パラグアイ": "Paraguay", "チリ": "Chile", "メキシコ": "Mexico",
    "アメリカ": "United States", "カナダ": "Canada", "イングランド": "England",
    "スコットランド": "Scotland", "ウェールズ": "Wales", "オランダ": "Netherlands",
    "ベルギー": "Belgium", "スイス": "Switzerland", "オーストリア": "Austria",
    "スウェーデン": "Sweden", "ノルウェー": "Norway", "デンマーク": "Denmark",
    "フィンランド": "Finland", "アイスランド": "Iceland", "リトアニア": "Lithuania",
    "ブルガリア": "Bulgaria", "ルーマニア": "Romania", "ハンガリー": "Hungary",
    "チェコ": "Czech Republic", "スロバキア": "Slovakia", "スロベニア": "Slovenia",
    "ボスニア・ヘルツェゴビナ": "Bosnia-Herzegovina", "アルメニア": "Armenia",
    "ジョージア": "Georgia", "南アフリカ": "South Africa",
    "トーゴ": "Togo", "パナマ": "Panama",
}
FOREIGN_NAME_OVERRIDES = {
    "ヤゴ ザモラ": ("Yago Zamora", "Brazil"),
    "リグレイ": ("Rigley", "Brazil"),
    "イサーク キーセ テリン": ("Isaac Kiese Thelin", "Sweden"),
    "アフメド アフメドフ": ("Ahmed Ahmedov", "Bulgaria"),
    "アルフレド ステファンス": ("Alfredo Stephens", "Panama"),
    "アヴェレーテ イーブス": ("Avelete Yves", "Togo"),
    "トーマス ヒュワード ベル": ("Tom Heward-Belle", "Australia"),
    "ヒョン ウビン": ("Woo-been Hyun", "Korea, South"),
    "ダヴィド モーベルグ": ("David Moberg Karlsson", "Sweden"),
    "グスタボ シルバ": ("Gustavo Silva", "Brazil"),
    "ジョー": ("Jô", "Brazil"),
    "チェ ドヒョン": ("Do-hyun Choi", "Korea, South"),
    "チャ ウォンジュン": ("Won-jun Cha", "Korea, South"),
}


def country_from_club(other_club):
    found = re.findall(r"[（(]([^）)]+)[）)]", other_club or "")
    return COUNTRY_JA.get(found[-1]) if found else None


CARRY_FIELDS = ("marketValueNum", "marketValue", "feeValue", "fee", "ftype",
                "age", "matched", "nationality", "nationalityFlag")


def carry_over_values(rows):
    """When TM is unreachable, re-apply market values/fees/age from the last
    committed data-japan.js, matched by player name."""
    try:
        raw = open("data-japan.js", encoding="utf-8").read()
        old = json.loads(raw[raw.index("{"):raw.rindex("}") + 1])["transfers"]
    except Exception:
        return 0
    prev = {x["player"]: x for x in old if x.get("marketValueNum") is not None}
    n = 0
    for r in rows:
        p = prev.get(r["player"])
        if not p:
            continue
        for f in CARRY_FIELDS:
            if p.get(f) is not None:
                r[f] = p[f]
        n += 1
    return n


def merge_mv(rows, threshold=0.90):
    import build_data
    try:
        idx = tm_index()
    except build_data.SourceBlocked as e:
        # Transfermarkt blocked (common from CI IPs): keep refreshing the official
        # J.League data, but carry market values/ages forward from the previous
        # data-japan.js so a blocked run doesn't strip them off the live site.
        sys.stderr.write("WARNING: TM enrichment blocked — %s; "
                         "carrying values over from existing data-japan.js\n" % e)
        return carry_over_values(rows)
    profiles = jleague_profiles(rows)
    flags = {rec.get("nationality"): rec.get("nationalityFlag")
             for _, rec in idx
             if rec.get("nationality") and rec.get("nationalityFlag")}
    matched = 0
    cache = {}
    for r in rows:
        name = r["player"]
        if name not in cache:
            profile = profiles.get(r.get("playerId")) or {}
            official_latin = profile.get("nameEn")
            override_latin = FOREIGN_NAME_OVERRIDES.get(name, (None, None))[0]
            key = norm_key(official_latin or override_latin or romanize(name))
            # foreign names (katakana) transliterate loosely to TM's Latin
            # spelling, so allow a looser match for them; keep kanji strict.
            th = 0.77 if is_katakana(name) else threshold
            hit = None
            if len(key) >= 5:
                best, best_ratio = None, 0.0
                for tname, rec in idx:
                    ratio = difflib.SequenceMatcher(None, key, tname).ratio()
                    if ratio > best_ratio:
                        best, best_ratio = rec, ratio
                if best is not None and best_ratio >= th:
                    # A player can appear several times on TM in the same
                    # window (for example loan return followed by a permanent
                    # move).  Do not attach the first occurrence's fee to all
                    # official rows: prefer the occurrence whose movement type
                    # agrees with the J.LEAGUE row.
                    same_player = [rec for tname, rec in idx
                                   if rec["name"] == best["name"]]
                    wanted = r["type"]
                    if wanted == "transfer":
                        compatible = [x for x in same_player
                                      if x["ftype"] in ("transfer", "free", "other")]
                    else:
                        compatible = [x for x in same_player
                                      if x["ftype"] == wanted]
                    hit = (compatible or same_player or [best])[0]
            cache[name] = hit
        hit = cache[name]
        # romaji subtitle: TM's real spelling when matched; for unmatched, a
        # pykakasi reading for kanji names (usually right) but nothing for
        # foreign katakana names (transliteration back to Latin is unreliable).
        profile = profiles.get(r.get("playerId")) or {}
        official_latin = profile.get("nameEn")
        birthplace = profile.get("placeOfBirth")
        profile_nationality = profile.get("nationality") or COUNTRY_JA.get(birthplace)
        if hit and is_katakana(name) and hit.get("nationality") != "Japan":
            r["player"], r["roman"] = hit["name"], name
        elif hit:
            r["roman"] = hit["name"]
        elif is_katakana(name):
            latin, nationality = FOREIGN_NAME_OVERRIDES.get(
                name, (official_latin or romanize(name).title(),
                       profile_nationality or country_from_club(r["otherClub"])))
            r["player"], r["roman"] = latin, name
            if nationality:
                r["nationality"] = nationality
                r["nationalityFlag"] = flags.get(nationality)
        else:
            r["roman"] = official_latin or romanize(name).title()
            r["nationality"] = "Japan"
            r["nationalityFlag"] = flags.get("Japan")
        if hit is not None:
            if hit["mv"] is not None:
                r["marketValueNum"] = hit["mv"]
                r["marketValue"] = "€%sm" % hit["mv"]
            r["age"] = hit["age"]
            r["fee"] = hit["fee"]           # transfer fee from Transfermarkt
            r["feeValue"] = hit["feeValue"]
            r["ftype"] = hit["ftype"]
            r["nationality"] = hit.get("nationality")
            r["nationalityFlag"] = hit.get("nationalityFlag")
            r["matched"] = True
            matched += 1
    return matched


def apply_sofascore_overrides(rows):
    """Fill data Transfermarkt lacks from a hand-curated SofaScore table
    (sofascore-overrides.json). SofaScore blocks scripted access, so this table
    is maintained manually via the browser. Each entry is either an int (EUR)
    or {eur, age, name} — eur may be 0 to mean 'confirmed, no market value'."""
    try:
        ov = json.load(open("sofascore-overrides.json", encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return 0
    n = 0
    for r in rows:
        e = ov.get(r["player"])
        if e is None:
            continue
        eur = e.get("eur") if isinstance(e, dict) else e
        if eur is not None and r.get("marketValueNum") is None:
            r["marketValueNum"] = round(eur / 1e6, 3)
            r["matched"] = True
            r["valueSource"] = "SofaScore"
        if isinstance(e, dict):
            if e.get("age"):
                r["age"] = e["age"]
            if e.get("jp"):          # main display name (Japanese notation)
                r["player"] = e["jp"]
            if e.get("name"):
                r["roman"] = e["name"]
        n += 1
    return n


def dedup_moves(rows):
    """Collapse the same player leaving/joining one club more than once (e.g. a
    契約満了 with destination 未定 that later resolves to a real club). Keep the
    row with a concrete other-club, then the most recent date."""
    def score(r):
        other = (r.get("otherClub") or "").strip()
        real = 0 if other in ("未定", "—", "") else 1
        return (real, r.get("date") or "")
    best = {}
    for r in rows:
        key = (r.get("clubKey"), r["player"], r["direction"])
        if key not in best or score(r) > score(best[key]):
            best[key] = r
    keep = {id(v) for v in best.values()}
    return [r for r in rows if id(r) in keep]


def build():
    all_clubs, all_rows, divisions = [], [], []
    for league, slug in LEAGUES:
        clubs, rows = parse_page(fetch(slug), league)
        if len(clubs) < 15:
            sys.exit("official %s layout changed: only %d clubs" % (league, len(clubs)))
        all_clubs += clubs
        all_rows += rows
        divisions.append(league)
        print("  %s: %d clubs, %d rows" % (league, len(clubs), len(rows)))
    # keep only the current summer window (drop 2025-26 winter & older)
    before = len(all_rows)
    all_rows = [r for r in all_rows if (r["date"] or "") >= SUMMER_START]
    print("  summer window (>= %s): kept %d of %d rows"
          % (SUMMER_START, len(all_rows), before))
    before = len(all_rows)
    all_rows = dedup_moves(all_rows)
    print("  dedup: kept %d of %d rows" % (len(all_rows), before))
    enrich_club_logos(all_clubs)
    print("  matching Transfermarkt market values…")
    m = merge_mv(all_rows)
    print("  matched %d players to a TM transfer row" % m)
    ov = apply_sofascore_overrides(all_rows)
    print("  SofaScore overrides applied to %d rows" % ov)
    return {
        "generatedAt": datetime.datetime.now(datetime.timezone.utc)
                        .strftime("%Y-%m-%d %H:%M UTC"),
        "source": "J.LEAGUE 公式 (jleague.jp) · 移籍情報 2026/27",
        "verifiedSource": "Transfermarkt Japan J1/J2/J3 2026",
        "verifiedAt": datetime.datetime.now(datetime.timezone.utc)
                      .strftime("%Y-%m-%d"),
        "currency": "€", "country": "Japan", "lang": "ja",
        "divisions": divisions, "clubs": all_clubs, "transfers": all_rows,
    }


def write(out):
    result = csv_data.write_csv_and_js(
        out, "japan-transfers.csv", "data-japan.js")
    mv = sum(1 for r in result["transfers"] if r.get("marketValueNum") is not None)
    print("wrote japan-transfers.csv -> data-japan.js: %d clubs, %d rows "
          "(%d with TM market value)"
          % (len(result["clubs"]), len(result["transfers"]), mv))


if __name__ == "__main__":
    write(build())
