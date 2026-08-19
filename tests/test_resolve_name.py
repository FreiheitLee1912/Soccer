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


def test_generated_readings_use_given_name_first():
    """Unmatched kanji rendered surname-first while every matched row in the
    same column rendered given-first: 'Ono Seiyume' beside 'Kosuke Kinoshita'."""
    _, roman, _ = resolve_name("小野 成夢", None, None, None, "京都産業大学")
    assert roman == "Seiyume Ono"


def test_a_variant_kanji_surname_is_not_dropped():
    """pykakasi has no reading for 髙, so romanising the raw name returned just
    'Tetsuya' and lost 髙橋 entirely."""
    _, roman, _ = resolve_name("髙橋 哲也", None, None, None, "未定")
    assert roman == "Tetsuya Takahashi"


def test_only_the_first_part_is_treated_as_the_surname():
    _, roman, _ = resolve_name("真也加 チュイ 大夢", None, None, None, "未定")
    assert roman == "Chui Taimu Shinyaka"


def test_an_official_spelling_is_never_reordered():
    _, roman, _ = resolve_name("須貝 英大", None, "Hidehiro Sugai", None, "未定")
    assert roman == "Hidehiro Sugai"


from build_japan import normalise_official_latin


def test_official_profile_names_are_reordered_to_given_surname():
    """J.LEAGUE profiles read "TAKAHASHI Tetsuya"; the board reads the other way."""
    assert normalise_official_latin("TAKAHASHI Tetsuya") == "Tetsuya Takahashi"
    assert normalise_official_latin("WATANABE Kota") == "Kota Watanabe"


def test_a_fully_capitalised_foreign_name_is_left_alone():
    """With every token in caps the first one need not be the surname, so
    reordering would invent a name rather than fix one."""
    assert normalise_official_latin("ANDERSON LOPES") == "ANDERSON LOPES"


def test_an_already_correct_name_is_untouched():
    assert normalise_official_latin("Kosuke Kinoshita") == "Kosuke Kinoshita"


def test_a_single_token_name_is_untouched():
    assert normalise_official_latin("Dieguinho") == "Dieguinho"
