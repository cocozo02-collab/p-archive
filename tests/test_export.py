import io
import json
import unittest

from PIL import Image

from app.export import export_catalog, song_key, square_thumb
from app.store import catalog
from tests.helpers import TempData

MIX = "Phoenix2"


def png(w=700, h=393) -> bytes:
    out = io.BytesIO()
    Image.new("RGBA", (w, h), (200, 30, 30, 255)).save(out, "PNG")
    return out.getvalue()


class ExportTest(unittest.TestCase):
    def test_square_thumb(self):
        img = Image.open(io.BytesIO(square_thumb(png(), 192, 80)))
        self.assertEqual((img.format, img.size), ("WEBP", (192, 192)))

    def test_export(self):
        with TempData() as t:
            c = t.conn
            sid = catalog.upsert_song(c, MIX, {"name": "Good Night", "artist": "X"}, "ts")
            catalog.upsert_chart(c, sid, MIX, {"id": "uuid-1", "type": "Single", "level": 20}, "ts")
            catalog.upsert_piugame_song(c, MIX, "h1", "굿 나이트", None, "records", "ts")
            catalog.upsert_piugame_song(c, MIX, "h2", "미매칭 곡", None, "records", "ts")
            jacket = t.root / "jackets" / "piugame" / "h1.png"
            jacket.parent.mkdir(parents=True)
            jacket.write_bytes(png())
            catalog.set_piugame_jacket(c, MIX, "h1", "jackets/piugame/h1.png", 1, "x")
            catalog.set_match(c, MIX, "h1", sid, "sha", None)

            r = export_catalog(c, out_dir=t.root / "export")
            data = json.loads((t.root / "export" / "catalog.json").read_text(encoding="utf-8"))
            key = song_key("Good Night")
            self.assertEqual(data["songs"][0]["name_ko"], "굿 나이트")
            self.assertEqual(data["songs"][0]["jacket"], f"jackets/{key}.webp")
            self.assertEqual(data["charts"][0], {"id": "uuid-1", "song": key, "type": "Single", "level": 20,
                                                 "note_count": None, "step_artist": None})
            self.assertEqual(sorted((p["hash"], p["song"]) for p in data["piugame_songs"]),
                             [("h1", key), ("h2", None)])
            self.assertEqual((r["thumbnails"], r["missing_jackets"]), (1, []))


if __name__ == "__main__":
    unittest.main()
