#!/usr/bin/env python3
"""CSV-first storage for the transfer pages.

Scrapers write a human-editable CSV, then data-*.js is generated exclusively
by reading that CSV back. Run this file directly to rebuild all JS files from
the three master CSVs without accessing the network.
"""
import csv
import json
from pathlib import Path


FIELDS = [
    "country", "lang", "generatedAt", "source", "currency", "divisions",
    "league", "club", "clubEnglish", "clubKey", "clubLogo",
    "direction", "date", "player", "roman", "playerId", "transferId",
    "dqdId", "dqdNationality", "nameSource", "age", "pos", "position",
    "nationality", "nationalityFlag",
    "otherClub", "transferType", "type", "ftype", "marketValue",
    "marketValueNum", "fee", "feeValue", "matched",
]

FLOAT_FIELDS = {"marketValueNum", "feeValue"}
BOOL_FIELDS = {"matched"}
TRANSFER_FIELDS = [
    "league", "club", "clubKey", "direction", "date", "player", "roman",
    "playerId", "transferId", "dqdId", "dqdNationality", "nameSource",
    "age", "pos", "position", "nationality", "nationalityFlag",
    "otherClub", "transferType", "type",
    "ftype", "marketValue", "marketValueNum", "fee", "feeValue", "matched",
]


def _cell(value):
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return value


def write_csv(data, csv_path):
    """Write one readable row per displayed transfer."""
    club_meta = {(c.get("league"), c.get("name")): c
                 for c in data.get("clubs", [])}
    path = Path(csv_path)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS, extrasaction="ignore")
        writer.writeheader()
        for transfer in data.get("transfers", []):
            club = club_meta.get((transfer.get("league"), transfer.get("club")), {})
            row = {
                "country": data.get("country"), "lang": data.get("lang", "en"),
                "generatedAt": data.get("generatedAt"), "source": data.get("source"),
                "currency": data.get("currency", "€"),
                "divisions": "|".join(data.get("divisions", [])),
                "clubEnglish": club.get("english"),
                "clubKey": transfer.get("clubKey") or club.get("key"),
                "clubLogo": club.get("logo"),
            }
            row.update(transfer)
            writer.writerow({field: _cell(row.get(field)) for field in FIELDS})
    return path


def _value(field, raw):
    if raw == "":
        return None
    if field in FLOAT_FIELDS:
        return float(raw)
    if field in BOOL_FIELDS:
        return raw.strip().lower() in {"1", "true", "yes", "y"}
    return raw


def read_csv(csv_path):
    """Read the master CSV and reconstruct the browser data object."""
    path = Path(csv_path)
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    if not rows:
        raise ValueError(f"{path} has no transfer rows")
    first = rows[0]
    divisions = [x for x in first.get("divisions", "").split("|") if x]
    clubs, seen_clubs, transfers = [], set(), []
    for row in rows:
        league, club_name = row.get("league", ""), row.get("club", "")
        club_id = (league, club_name)
        if club_id not in seen_clubs:
            club = {"name": club_name, "league": league}
            for csv_name, key in (("clubEnglish", "english"),
                                  ("clubKey", "key"), ("clubLogo", "logo")):
                if row.get(csv_name):
                    club[key] = row[csv_name]
            clubs.append(club); seen_clubs.add(club_id)
        transfer = {}
        for field in TRANSFER_FIELDS:
            value = _value(field, row.get(field, ""))
            if value is not None:
                transfer[field] = value
            elif field in {"date", "roman", "age", "fee", "feeValue",
                           "marketValue", "marketValueNum", "ftype",
                           "transferType"}:
                transfer[field] = None
        transfers.append(transfer)
    return {
        "generatedAt": first.get("generatedAt", ""),
        "source": first.get("source", ""), "currency": first.get("currency", "€"),
        "country": first.get("country", ""), "lang": first.get("lang", "en"),
        "divisions": divisions, "clubs": clubs, "transfers": transfers,
    }


def write_js_from_csv(csv_path, js_path):
    data = read_csv(csv_path)
    with Path(js_path).open("w", encoding="utf-8") as handle:
        handle.write("window.TRANSFER_DATA = ")
        json.dump(data, handle, ensure_ascii=False)
        handle.write(";\n")
    return data


def write_csv_and_js(data, csv_path, js_path):
    write_csv(data, csv_path)
    # Important: JS is reconstructed from CSV, never directly from scraper data.
    return write_js_from_csv(csv_path, js_path)


if __name__ == "__main__":
    pairs = [
        ("england-transfers.csv", "data-england.js"),
        ("japan-transfers.csv", "data-japan.js"),
        ("china-transfers.csv", "data-china.js"),
    ]
    for csv_name, js_name in pairs:
        data = write_js_from_csv(csv_name, js_name)
        print(f"{csv_name} -> {js_name}: {len(data['transfers'])} rows")
