"""collapse_repeat_moves() keeps one row per club/direction/player.

Transfermarkt lists each movement separately, so the same player legitimately
appears twice in one club's IN column. The board wants the row that explains
how he arrived, not the bookkeeping one."""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from build_data import collapse_repeat_moves


def row(**kw):
    base = {"league": "Premier League", "club": "Brighton & Hove Albion",
            "direction": "in", "player": "James Beadle", "playerId": "670860",
            "age": "22", "type": "transfer", "otherClub": "Somewhere"}
    base.update(kw)
    return base


def test_a_real_arrival_beats_a_loan_return():
    promotion = row(type="promotion", otherClub="Brighton U21", age="21")
    loan_back = row(type="loan-return", otherClub="Birmingham", age="22")
    kept = collapse_repeat_moves([promotion, loan_back])
    assert kept == [promotion]


def test_order_does_not_decide_the_winner():
    """The Japan club-name bug came from trusting document order. Don't."""
    promotion = row(type="promotion", otherClub="Brighton U21", age="21")
    loan_back = row(type="loan-return", otherClub="Birmingham", age="22")
    assert collapse_repeat_moves([loan_back, promotion]) == [promotion]


def test_between_two_loan_returns_the_older_age_wins():
    younger = row(type="loan-return", otherClub="Motherwell FC", age="23")
    older = row(type="loan-return", otherClub="Lechia Gdansk", age="24")
    assert collapse_repeat_moves([older, younger]) == [older]


def test_an_outgoing_loan_beats_a_loan_return():
    loan_out = row(direction="out", type="loan", otherClub="Fiorentina")
    loan_back = row(direction="out", type="loan-return", otherClub="AC Milan")
    assert collapse_repeat_moves([loan_back, loan_out]) == [loan_out]


def test_in_and_out_are_kept_separately():
    arrival = row(direction="in", type="transfer")
    departure = row(direction="out", type="loan")
    assert len(collapse_repeat_moves([arrival, departure])) == 2


def test_the_same_name_at_two_clubs_is_not_a_duplicate():
    here = row(club="Brighton & Hove Albion")
    there = row(club="Birmingham City", league="Championship")
    assert len(collapse_repeat_moves([here, there])) == 2


def test_distinct_players_sharing_a_club_are_untouched():
    a = row(player="James Beadle", playerId="670860")
    b = row(player="Evan Ferguson", playerId="123456")
    assert len(collapse_repeat_moves([a, b])) == 2


def test_rows_with_no_player_id_fall_back_to_the_name():
    a = row(playerId=None, type="promotion", age="21")
    b = row(playerId=None, type="loan-return", age="22")
    assert collapse_repeat_moves([a, b]) == [a]
