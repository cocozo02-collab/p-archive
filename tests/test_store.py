import unittest
from datetime import datetime, timedelta, timezone

from app.piugame.parser import ChartScore, RecentPlay
from app.store import catalog, records
from app.sync.catalog import _choose_filters
from tests.helpers import TempData

MIX = "Phoenix2"
KST = timezone(timedelta(hours=9))
H_OLD, H_NEW = "1" * 32, "2" * 32


def score(h, status, value, grade=None, plate=None, level=22, minute=0):
    return ChartScore(song_name="이렐리아", chart_type="Single", level=level, score=value, grade=grade, plate=plate,
                      is_broken=status != "pass", is_stage_break=status == "stage_break",
                      played_at=datetime(2026, 8, 27, 17, minute, tzinfo=KST),
                      jacket_url=f"https://piugame.com/data/song_img2/{h}.png")


def play(h, status, value, grade=None, plate=None, minute=0):
    base = score(h, status, value, grade, plate, minute=minute)
    return RecentPlay(**base.__dict__, perfect=900, great=50, good=10, bad=5, miss=30)


class MergeTest(unittest.TestCase):
    def test_is_better(self):
        self.assertTrue(records.is_better({"status": "broken", "score": 1}, {"status": "stage_break", "score": None}))
        self.assertTrue(records.is_better({"status": "pass", "score": 800000}, {"status": "broken", "score": 990000}))
        self.assertTrue(records.is_better({"status": "pass", "score": 950000}, {"status": "pass", "score": 940000}))
        self.assertFalse(records.is_better({"status": "pass", "score": 940000}, {"status": "pass", "score": 940000}))

    def test_stage_break_record_is_patched_from_broken_play(self):
        with TempData() as t:
            c = t.conn
            records.upsert_record(c, 1, MIX, score(H_OLD, "stage_break", None, minute=29), "ts")
            records.insert_play(c, 1, MIX, play(H_OLD, "broken", 750105, "B", minute=32), "ts")
            records.insert_play(c, 1, MIX, play(H_OLD, "stage_break", None, minute=29), "ts")
            patched = records.patch_from_plays(c, 1, MIX, "ts")
            self.assertEqual(len(patched), 1)
            r = c.execute("SELECT status, score, grade, source FROM records").fetchone()
            self.assertEqual(tuple(r), ("broken", 750105, "B", "recent_play"))

    def test_pass_record_is_not_overwritten(self):
        with TempData() as t:
            c = t.conn
            records.upsert_record(c, 1, MIX, score(H_OLD, "pass", 990000, "SSS", "SG"), "ts")
            records.insert_play(c, 1, MIX, play(H_OLD, "pass", 995000, "SSS+", "MG"), "ts")
            self.assertEqual(records.patch_from_plays(c, 1, MIX, "ts"), [])

    def test_duplicate_play_is_ignored(self):
        with TempData() as t:
            self.assertTrue(records.insert_play(t.conn, 1, MIX, play(H_OLD, "pass", 1, "F", "RG"), "ts"))
            self.assertFalse(records.insert_play(t.conn, 1, MIX, play(H_OLD, "pass", 1, "F", "RG"), "ts"))


class JacketChangeTest(unittest.TestCase):
    """자켓이 바뀌어 piugame 해시가 달라져도 song_id로 묶어 같은 채보의 기록으로 본다."""

    def test_records_grouped_by_song(self):
        with TempData() as t:
            c = t.conn
            song_id = catalog.upsert_song(c, MIX, {"name": "iRELLiA", "imageUrl": "https://cdn/x.png"}, "ts")
            catalog.upsert_chart(c, song_id, MIX, {"id": "chart-1", "type": "Single", "level": 22}, "ts")
            for h in (H_OLD, H_NEW):
                catalog.upsert_piugame_song(c, MIX, h, "이렐리아", None, "records", "ts")
                catalog.set_match(c, MIX, h, song_id, "sha", None)
            records.upsert_record(c, 1, MIX, score(H_OLD, "pass", 950000, "AAA", "MG"), "ts")
            records.upsert_record(c, 1, MIX, score(H_NEW, "pass", 970000, "S", "TG"), "ts")

            best = records.best_records_by_chart(c, 1, MIX)
            self.assertEqual(len(best), 1)
            self.assertEqual(next(iter(best.values()))["score"], 970000)
            conflicts = catalog.hash_conflicts(c, MIX)
            self.assertEqual([len(x["hashes"]) for x in conflicts], [2])


class KoreanNameTargetsTest(unittest.TestCase):
    def test_needs_and_filters(self):
        with TempData() as t:
            c = t.conn
            a = catalog.upsert_song(c, MIX, {"name": "A"}, "ts")
            b = catalog.upsert_song(c, MIX, {"name": "B"}, "ts")
            low = catalog.upsert_song(c, MIX, {"name": "Low"}, "ts")
            catalog.upsert_chart(c, a, MIX, {"id": "a1", "type": "Single", "level": 21}, "ts")
            catalog.upsert_chart(c, a, MIX, {"id": "a2", "type": "Double", "level": 28}, "ts")
            catalog.upsert_chart(c, b, MIX, {"id": "b1", "type": "Double", "level": 21}, "ts")
            catalog.upsert_chart(c, low, MIX, {"id": "l1", "type": "Single", "level": 12}, "ts")
            needs = catalog.songs_needing_ko(c, MIX)
            self.assertEqual(needs, {a: {"21", "27over"}, b: {"21"}})
            self.assertEqual(_choose_filters(needs), ["21"])

            catalog.mark_ko_checked(c, [b], "ts")
            catalog.upsert_piugame_song(c, MIX, H_OLD, "에이", None, "over_ranking", "ts")
            catalog.set_match(c, MIX, H_OLD, a, "sha", None)
            self.assertEqual(catalog.songs_needing_ko(c, MIX), {})


if __name__ == "__main__":
    unittest.main()
