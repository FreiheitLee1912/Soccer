#!/usr/bin/env python3
"""Build the China transfer test page from Transfermarkt (CSL/CLO/League Two).

Transfermarkt is used for a consistent transfer-fee and market-value baseline.
Chinese club names are kept in a reviewed local map; player spellings remain as
published when a reliable Chinese-name source is not available.
"""
import datetime
import json
import re
import subprocess
import urllib.request
import unicodedata
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from lxml import html

import build_data
import csv_data

UA = build_data.UA
SEASONS = ("2025", "2026")
WINDOW_START = datetime.date(2026, 6, 18)
WINDOW_END = datetime.date(2026, 7, 22)
COMPETITIONS = [
    ("中超", "CSL", "chinese-super-league"),
    ("中甲", "CLO", "china-league-one"),
    ("中乙", "CHL3", "china-league-two-a"),
    ("中乙", "CL3S", "china-league-two-b"),
]
DQD_SEASONS = (26322, 26350, 26351)  # 2026 中超 / 中甲 / 中乙

CLUB_ZH = {
    "Shanghai Port": "上海海港", "Shanghai Shenhua": "上海申花",
    "Chengdu Rongcheng": "成都蓉城", "Beijing Guoan": "北京国安",
    "Shandong Taishan": "山东泰山", "Tianjin Jinmen Tiger": "天津津门虎",
    "Zhejiang FC": "浙江队", "Yunnan Yukun": "云南玉昆",
    "Qingdao West Coast": "青岛西海岸", "Henan FC": "河南队",
    "Dalian Yingbo": "大连英博", "Shenzhen Peng City": "深圳新鹏城",
    "Wuhan Three Towns": "武汉三镇", "Qingdao Hainiu": "青岛海牛",
    "Liaoning Tieren": "辽宁铁人", "Chongqing Tonglianglong": "重庆铜梁龙",
    "Meizhou Hakka": "梅州客家", "Changchun Yatai": "长春亚泰",
    "Guangdong GZ-Power": "广东广州豹", "Yanbian Longding": "延边龙鼎",
    "Shijiazhuang Gongfu": "石家庄功夫", "Dingnan United": "定南赣联",
    "Nantong Zhiyun": "南通支云", "Dalian K'un City": "大连鲧城",
    "Shaanxi Union": "陕西联合", "Suzhou Dongwu": "苏州东吴",
    "Nanjing City": "南京城市", "Ningbo FC": "宁波队",
    "Foshan Nanshi": "佛山南狮", "Shenzhen Juniors": "深圳青年人",
    "Guangxi Hengchen": "广西恒宸", "Wuxi Wugo": "无锡吴钩",
    "Changchun Xidu": "长春喜都", "Beijing IT": "北京理工",
    "Dalian Kewei": "大连可为", "Dalian Yingbo B": "大连英博B队",
    "Shanxi Chongde Ronghai": "山西崇德荣海", "Lanzhou Longyuan Athletic": "兰州陇原竞技",
    "Tai'an Tiankuang": "泰安天贶", "Qingdao Red Lions": "青岛红狮",
    "Shandong Taishan B": "山东泰山B队", "Haimen Codion": "海门珂缔缘",
    "Shanghai Second": "上海海港富盛经开", "Shanghai Port B": "上海海港B队",
    "Hubei Istar": "湖北青年星", "Wuhan Three Towns B": "武汉三镇B队",
    "Chengdu Rongcheng B": "成都蓉城B队", "Hangzhou Linping Wu-Yue": "杭州临平吴越",
    "Jiangxi Lushan": "江西庐山", "Wenzhou FC": "温州队",
    "Guizhou Guiyang Athletic": "贵州筑城竞技", "Ganzhou Ruishi": "赣州瑞狮",
    "Xiamen Feilu": "厦门飞鹭", "Guangzhou Dandelion": "广州蒲公英",
    "Guangdong Mingtu": "广东铭途", "Shenzhen 2028": "深圳2028",
}


def fetch(code, slug, season):
    url = (f"https://www.transfermarkt.com/{slug}/transfers/wettbewerb/"
           f"{code}/saison_id/{season}")
    return subprocess.run(
        ["curl", "-L", "-s", "--max-time", "50", "-A", UA,
         "-H", "Accept-Language: en-US,en;q=0.9", url],
        capture_output=True, text=True, check=True).stdout


def parse_page(page, league):
    tree = html.fromstring(page)
    heads = tree.xpath(
        '//h2[contains(@class,"content-box-headline")]'
        '[.//a[contains(@href,"verein") or contains(@href,"startseite")]]')
    clubs, rows = [], []
    for head in heads:
        english = build_data.norm(head.text_content())
        club = CLUB_ZH.get(english, english)
        key = re.sub(r'[^a-z0-9]+', '-', english.lower()).strip('-')
        logos = head.xpath('.//img[contains(@src,"/wappen/")]/@src')
        logo = logos[0] if logos else None
        if logo and logo.startswith('//'):
            logo = 'https:' + logo
        clubs.append({"name": club, "league": league, "key": key,
                      "english": english, "logo": logo})
        tables = head.getparent().xpath('.//table')[:2]
        for table in tables:
            th = build_data.norm(' '.join(table.xpath('.//thead//th[1]//text()')))
            direction = "out" if th.lower() == "out" else "in"
            for tr in table.xpath('.//tbody/tr[.//a[contains(@href,"/profil/spieler/")]]'):
                title = tr.xpath('.//a[contains(@href,"/profil/spieler/")]/@title')
                player_links = tr.xpath('.//a[contains(@href,"/profil/spieler/")]/@href')
                cells = [build_data.norm(td.text_content()) for td in tr.xpath('./td')]
                if not title or len(cells) < 9:
                    continue
                fee, fee_value = build_data.money(cells[8])
                mv, mv_value = build_data.money(cells[5])
                nationality = tr.xpath('./td[3]//img/@title')
                flags = tr.xpath('./td[3]//img/@src')
                flag = flags[0] if flags else None
                if flag and flag.startswith('//'):
                    flag = 'https:' + flag
                date_match = re.search(r'(\d{2})/(\d{2})/(\d{4})', cells[8])
                transfer_date = None
                if date_match:
                    day, month, year = map(int, date_match.groups())
                    transfer_date = datetime.date(year, month, day)
                player_match = re.search(r'/spieler/(\d+)', player_links[0])
                player_id = player_match.group(1) if player_match else None
                transfer_links = tr.xpath('./td[9]//a[contains(@href,"transfer_id")]/@href')
                transfer_match = re.search(r'/transfer_id/(\d+)', transfer_links[0]) if transfer_links else None
                transfer_id = transfer_match.group(1) if transfer_match else None
                other_title = tr.xpath('./td[8]//a/@title')
                other_english = other_title[0] if other_title else cells[7]
                fee_type = build_data.kind(fee)
                if (direction == "in" and
                        build_data.is_academy_promotion(english, other_english)):
                    fee, fee_value, fee_type = "Promotion", None, "promotion"
                pos = cells[4] or cells[3]
                pos = {"Goalkeeper": "GK", "Defender": "DF",
                       "Midfielder": "MF", "Striker": "FW"}.get(pos, pos)
                rows.append({
                    "player": title[0], "playerId": player_id,
                    "transferId": transfer_id,
                    "roman": None, "club": club,
                    "clubKey": key, "league": league, "direction": direction,
                    "otherClub": CLUB_ZH.get(other_english, other_english),
                    "age": cells[1] or None, "position": cells[3] or None,
                    "pos": pos or None,
                    "nationality": nationality[0] if nationality else None,
                    "nationalityFlag": flag, "marketValue": mv,
                    "marketValueNum": mv_value, "fee": fee,
                    "feeValue": fee_value, "type": fee_type,
                    "date": transfer_date.isoformat() if transfer_date else None,
                    "matched": True,
                })
    return clubs, rows


def enrich_transfer_dates(rows):
    """Resolve exact dates through TM's transfer-history API.

    Competition tables omit dates on many paid/free transfers. Their fee links
    still expose a transfer_id, which can be matched to the player's history.
    """
    player_ids = sorted({r["playerId"] for r in rows
                         if r.get("playerId") and r.get("transferId")})

    def fetch_history(player_id):
        url = ("https://tmapi.transfermarkt.technology/transfer/history/player/"
               + player_id)
        req = urllib.request.Request(url, headers={
            "User-Agent": UA, "Origin": "https://www.transfermarkt.com",
            "Referer": "https://www.transfermarkt.com/",
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
        })
        last_error = None
        for attempt in range(5):
            try:
                with urllib.request.urlopen(req, timeout=25) as response:
                    payload = json.load(response)
                break
            except Exception as error:
                last_error = error
                time.sleep(.8 * (attempt + 1))
        else:
            raise last_error
        dates = {}
        history = payload.get("data", {}).get("history", {})
        for group in history.values():
            if not isinstance(group, list):
                continue
            for move in group:
                transfer_id = str(move.get("id") or "")
                raw_date = (move.get("details", {}).get("date") or "")[:10]
                if transfer_id and raw_date:
                    dates[transfer_id] = raw_date
        return dates

    resolved, failed = {}, 0
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(fetch_history, pid): pid for pid in player_ids}
        for future in as_completed(futures):
            try:
                resolved.update(future.result())
            except Exception:
                failed += 1
    for row in rows:
        if row.get("transferId") in resolved:
            row["date"] = resolved[row["transferId"]]
    print(f"  transfer-history dates: {len(resolved)} resolved, "
          f"{failed} player requests failed")


def _dqd_json(url):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Referer": "https://www.dongqiudi.com/",
        "Accept": "application/json, text/plain, */*",
    })
    with urllib.request.urlopen(req, timeout=25) as response:
        return json.load(response)


def _name_key(name):
    plain = unicodedata.normalize("NFKD", name or "")
    plain = "".join(c for c in plain if not unicodedata.combining(c)).lower()
    return "".join(sorted(re.findall(r"[a-z0-9]+", plain)))


def enrich_dqd_names(rows):
    """Use DQD native Chinese squad names for high-confidence matches."""
    team_ids = set()
    for season_id in DQD_SEASONS:
        url = ("https://www.dongqiudi.com/sport-data/soccer/biz/data/standing"
               f"?season_id={season_id}&app=dqd&version=850&platform=ios"
               "&language=zh-cn")
        payload = _dqd_json(url)

        def walk(value):
            if isinstance(value, dict):
                if value.get("team_id"):
                    team_ids.add(str(value["team_id"]))
                for child in value.values():
                    walk(child)
            elif isinstance(value, list):
                for child in value:
                    walk(child)
        walk(payload)

    def members(team_id):
        url = ("https://www.dongqiudi.com/sport-data/soccer/biz/dqd/v1/"
               f"team/member_v2/{team_id}?app=dqd")
        payload = _dqd_json(url)
        out = []
        for group in payload.get("data", {}).get("list", []):
            if group.get("type") in ("coach", "manager"):
                continue
            for person in group.get("data", []):
                english = person.get("person_en_name") or ""
                chinese = re.sub(r"\s*\([^)]*\)\s*$", "",
                                 person.get("person_name") or "").strip()
                age_match = re.search(r"\d+", person.get("age") or "")
                if english and chinese:
                    out.append({"key": _name_key(english), "en": english,
                                "zh": chinese,
                                "nationality": person.get("nationality_name") or "",
                                "age": age_match.group() if age_match else None,
                                "dqdId": str(person.get("person_id") or "")})
        return out

    people, failed = [], 0
    with ThreadPoolExecutor(max_workers=16) as pool:
        futures = {pool.submit(members, tid): tid for tid in team_ids}
        for future in as_completed(futures):
            try:
                people.extend(future.result())
            except Exception:
                failed += 1
    index = {}
    for person in people:
        index.setdefault(person["key"], []).append(person)

    matched_players = {}
    for row in rows:
        key = _name_key(row["player"])
        candidates = index.get(key, [])
        if row.get("age"):
            same_age = [p for p in candidates if p["age"] == str(row["age"])]
            if same_age:
                candidates = same_age
        # Keep foreign players in their original Latin spelling. Native names
        # are applied to Mainland Chinese and Hong Kong/Macau/Taiwan players.
        candidates = [p for p in candidates
                      if p["nationality"].startswith("中国")]
        chinese_names = {p["zh"] for p in candidates}
        if len(chinese_names) == 1:
            hit = candidates[0]
            matched_players[row["playerId"]] = hit
    changed = 0
    for row in rows:
        hit = matched_players.get(row["playerId"])
        if not hit:
            continue
        original = row["player"]
        row["player"] = hit["zh"]
        row["roman"] = original
        row["dqdId"] = hit["dqdId"]
        row["dqdNationality"] = hit["nationality"]
        row["nameSource"] = "懂球帝"
        changed += 1
    print(f"  DQD names: {len(team_ids)} teams, {len(people)} squad entries, "
          f"{changed} rows localized ({failed} requests failed)")


def build():
    clubs, rows = [], []
    for season in SEASONS:
        for league, code, slug in COMPETITIONS:
            c, r = parse_page(fetch(code, slug, season), league)
            clubs.extend(c); rows.extend(r)
            print(f"  {league} {code} season {season}: "
                  f"{len(c)} clubs, {len(r)} rows")
    enrich_transfer_dates(rows)
    before = len(rows)
    rows = [r for r in rows if r["date"] and
            WINDOW_START <= datetime.date.fromisoformat(r["date"]) <= WINDOW_END]
    # Exact duplicate protection. The same player can legitimately have two
    # movements in a window, so date and counterpart club are part of the key.
    deduped = {}
    for r in rows:
        key = (r["league"], r["club"], r["direction"],
               r.get("transferId") or r["playerId"], r["date"],
               r["otherClub"], r["type"])
        deduped[key] = r
    rows = list(deduped.values())
    # The two TM season pages may contain several movements for the same player
    # at one club. The board is a current IN/OUT view, so each direction shows
    # only that player's latest movement; IN and OUT remain independent.
    latest = {}
    for r in rows:
        key = (r["league"], r["club"], r["direction"],
               r.get("playerId") or r["player"])
        if key not in latest or r["date"] > latest[key]["date"]:
            latest[key] = r
    rows = list(latest.values())
    print(f"  summer window ({WINDOW_START} to {WINDOW_END}): "
          f"kept {len(rows)} of {before} rows")
    enrich_dqd_names(rows)
    # Remove duplicated clubs if group pages ever overlap.
    unique = {(c["league"], c["name"]): c for c in clubs}
    now = datetime.datetime.now(datetime.timezone.utc)
    return {
        "generatedAt": now.strftime("%Y-%m-%d %H:%M UTC"),
        "verifiedAt": now.strftime("%Y-%m-%d"),
        "source": "Transfermarkt 中国中超/中甲/中乙 2026 夏季转会",
        "currency": "€", "country": "China", "lang": "zh",
        "divisions": ["中超", "中甲", "中乙"],
        "clubs": list(unique.values()), "transfers": rows,
    }


if __name__ == "__main__":
    out = build()
    result = csv_data.write_csv_and_js(
        out, "china-transfers.csv", "data-china.js")
    print(f"wrote china-transfers.csv -> data-china.js: "
          f"{len(result['clubs'])} clubs, {len(result['transfers'])} rows")
