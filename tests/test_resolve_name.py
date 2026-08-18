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
    assert resolve_name("イサーク キーセ テリン", None, None, None, "未定") == (
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
