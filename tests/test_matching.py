import json
import unittest

from app import config
from app.store import catalog
from app.sync.matching import match_pending
from tests.helpers import TempData

MIX = "Phoenix2"


class FakePiugame:
    def __init__(self, files: dict[str, bytes]):
        self.files, self.calls = files, 0

    def get_binary(self, url: str) -> bytes:
        self.calls += 1
        return self.files[url]


class FakePiuScores:
    def __init__(self, files: dict[str, bytes]):
        self.files, self.calls = files, 0

    def cdn_download(self, url: str) -> bytes:
        self.calls += 1
        return self.files[url]


def add_song(c, name, url, data, charts=()):
    sid = catalog.upsert_song(c, MIX, {"name": name, "imageUrl": url}, "ts")
    catalog.set_cdn_size(c, sid, url, len(data))
    for i, (t, lv) in enumerate(charts):
        catalog.upsert_chart(c, sid, MIX, {"id": f"{name}-{i}", "type": t, "level": lv}, "ts")
    return sid


def add_piugame(c, h, name_ko, url, charts=()):
    catalog.upsert_piugame_song(c, MIX, h, name_ko, url, "over_ranking", "ts")
    for t, lv in charts:
        catalog.add_piugame_chart(c, MIX, h, t, lv)


class MatchingTest(unittest.TestCase):
    def test_size_then_sha(self):
        with TempData() as t:
            c = t.conn
            same = b"JACKET-AAAA"
            other_same_size = b"JACKET-BBBB"
            a = add_song(c, "Good Night", "https://cdn/a.png", same)
            add_song(c, "Other", "https://cdn/b.png", other_same_size)
            add_song(c, "Big", "https://cdn/c.png", b"much bigger image")
            add_piugame(c, "h1", "굿 나이트", "https://piugame.com/data/song_img2/h1.png")
            piu = FakePiugame({"https://piugame.com/data/song_img2/h1.png": same})
            cdn = FakePiuScores({"https://cdn/a.png": same, "https://cdn/b.png": other_same_size})

            r = match_pending(c, MIX, piu, cdn)
            self.assertEqual((r.by_sha, r.unmatched), (1, []))
            self.assertEqual(c.execute("SELECT song_id FROM piugame_songs").fetchone()[0], a)
            self.assertEqual(cdn.calls, 2)  # 크기가 같은 두 곡만 받는다 ("Big"은 받지 않음)

            # 다시 돌려도 캐시를 쓰므로 요청이 늘지 않는다.
            catalog.set_match(c, MIX, "h1", None, None, None)
            match_pending(c, MIX, piu, cdn)
            self.assertEqual((piu.calls, cdn.calls), (1, 2))

    def test_duplicate_jackets_resolved_by_chart_set(self):
        with TempData() as t:
            c = t.conn
            data = b"SAME-ART"
            add_song(c, "Song", "https://cdn/s.png", data, [("Single", 21)])
            short = add_song(c, "Song - SHORT CUT -", "https://cdn/sc.png", data, [("Single", 18), ("Double", 20)])
            add_piugame(c, "h1", "곡 - SHORT CUT -", "https://p/h1.png", [("Double", 20)])
            r = match_pending(c, MIX, FakePiugame({"https://p/h1.png": data}),
                              FakePiuScores({"https://cdn/s.png": data, "https://cdn/sc.png": data}))
            self.assertEqual(r.by_sha, 1)
            self.assertEqual(c.execute("SELECT song_id FROM piugame_songs").fetchone()[0], short)

    def test_manual_map_and_unmatched(self):
        with TempData() as t:
            c = t.conn
            target = add_song(c, "Manual Song", "https://cdn/m.png", b"x")
            add_piugame(c, "h1", "수동", "https://p/h1.png")
            add_piugame(c, "h2", "없는 곡", "https://p/h2.png")
            config.MANUAL_SONG_MAP.write_text(json.dumps({"_comment": "", "h1": "Manual Song"}), encoding="utf-8")
            r = match_pending(c, MIX, FakePiugame({"https://p/h2.png": b"no match here"}), FakePiuScores({}))
            self.assertEqual((r.by_manual, len(r.unmatched)), (1, 1))
            self.assertEqual(r.unmatched[0]["reason"], "크기가 같은 PIU Scores 자켓 없음")
            row = c.execute("SELECT song_id, match_method FROM piugame_songs WHERE piugame_hash = 'h1'").fetchone()
            self.assertEqual(tuple(row), (target, "manual"))


if __name__ == "__main__":
    unittest.main()
