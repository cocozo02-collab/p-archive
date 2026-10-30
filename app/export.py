"""앱용 카탈로그 내보내기.

출력(export/catalog/):
  catalog.json        곡·채보·piugame 해시 대응표·자켓 URL. 앱은 기록의 자켓 해시로 곡을 찾는다.
  jackets/<key>.webp  (with_thumbnails=True일 때만) 정사각형 썸네일. 저작권 때문에 저장소와 릴리스에는
                      넣지 않는다. 앱은 자켓 URL로 piugame.com에서 필요할 때 받아 폰에 캐시한다.

곡 키(key)는 PIU Scores 영어 곡명에서 만든 짧은 해시라서, 다시 내보내도 같은 곡은 같은 키를 쓴다.
채보는 PIU Scores 채보 UUID를 그대로 쓴다.
"""

import gzip
import hashlib
import io
import json
import logging
import shutil
import sqlite3
from pathlib import Path

from PIL import Image

from app import config
from app.db import now
from app.piuscores.client import PiuScoresClient
from app.sync.matching import ensure_cdn_hash

log = logging.getLogger(__name__)

EXPORT_DIR = config.ROOT / "export" / "catalog"
FORMAT_VERSION = 1


def song_key(name_en: str) -> str:
    return hashlib.sha1(name_en.encode("utf-8")).hexdigest()[:12]


def square_thumb(data: bytes, size: int, quality: int) -> bytes:
    img = Image.open(io.BytesIO(data))
    img = img.convert("RGBA" if img.mode in ("RGBA", "LA", "P") else "RGB")
    w, h = img.size
    side = min(w, h)
    left, top = (w - side) // 2, (h - side) // 2
    img = img.crop((left, top, left + side, top + side)).resize((size, size), Image.LANCZOS)
    if img.mode == "RGBA":  # 자켓은 불투명하다. 알파를 빼면 파일이 작아진다
        img = img.convert("RGB")
    out = io.BytesIO()
    img.save(out, "WEBP", quality=quality, method=6)
    return out.getvalue()


def _jacket_source(conn: sqlite3.Connection, song: sqlite3.Row, piuscores: PiuScoresClient | None) -> Path | None:
    """piugame 자켓(가장 최근 해시) → 없으면 CDN 자켓(필요하면 받는다)."""
    row = conn.execute(
        """SELECT jacket_path FROM piugame_songs WHERE song_id = ? AND jacket_path IS NOT NULL
           ORDER BY updated_at DESC LIMIT 1""", (song["id"],)).fetchone()
    if row and (config.DATA_DIR / row["jacket_path"]).exists():
        return config.DATA_DIR / row["jacket_path"]
    if not song["cdn_jacket_path"] and song["piuscores_image_url"] and piuscores:
        ensure_cdn_hash(conn, song, piuscores)
        conn.commit()
        song = conn.execute("SELECT * FROM songs WHERE id = ?", (song["id"],)).fetchone()
    if song["cdn_jacket_path"] and (config.DATA_DIR / song["cdn_jacket_path"]).exists():
        return config.DATA_DIR / song["cdn_jacket_path"]
    return None


def export_catalog(conn: sqlite3.Connection, mix: str = config.MIX, out_dir: Path = EXPORT_DIR,
                   thumb_size: int = 192, quality: int = 80, with_thumbnails: bool = False) -> dict:
    token = config.piu_scores_token()
    piuscores = PiuScoresClient(token) if token and with_thumbnails else None

    if out_dir.exists():
        shutil.rmtree(out_dir)
    jackets_dir = out_dir / "jackets"
    out_dir.mkdir(parents=True)
    if with_thumbnails:
        jackets_dir.mkdir()

    songs_out, missing_jackets = [], []
    songs = conn.execute("SELECT * FROM songs WHERE mix = ? ORDER BY name_en", (mix,)).fetchall()
    for i, s in enumerate(songs, 1):
        key = song_key(s["name_en"])
        hashes = conn.execute(
            "SELECT piugame_hash, name_ko, jacket_sha256, jacket_url FROM piugame_songs WHERE song_id = ? ORDER BY updated_at DESC",
            (s["id"],)).fetchall()
        name_ko = next((h["name_ko"] for h in hashes if h["name_ko"]), None)
        # 앱은 처음 보는 piugame 자켓을 받아 이 해시들과 비교해 곡을 찾는다(PC 매칭과 같은 규칙).
        shas = sorted({x for x in [s["cdn_sha256"], *(h["jacket_sha256"] for h in hashes)] if x})

        # 앱이 받을 piugame.com 자켓 주소(가장 최근 해시). 모르는 곡은 앱이 색 타일로 보여주다가 플레이하면 받는다.
        jacket_url = next((h["jacket_url"] for h in hashes if h["jacket_url"]), None)
        jacket = None
        if with_thumbnails:
            src = _jacket_source(conn, s, piuscores)
            if src:
                (jackets_dir / f"{key}.webp").write_bytes(square_thumb(src.read_bytes(), thumb_size, quality))
                jacket = f"jackets/{key}.webp"
        if not jacket_url:
            missing_jackets.append(s["name_en"])

        songs_out.append({
            "key": key, "name_en": s["name_en"], "name_ko": name_ko, "artist": s["artist"],
            "bpm_min": s["bpm_min"], "bpm_max": s["bpm_max"], "song_type": s["song_type"],
            "channel": s["channel"], "jacket": jacket, "jacket_url": jacket_url, "jacket_sha256": shas,
        })
        if i % 50 == 0 or i == len(songs):
            log.info("내보내기 %d/%d", i, len(songs))

    key_by_id = {s["id"]: song_key(s["name_en"]) for s in songs}
    charts_out = [
        {"id": c["piuscores_chart_id"], "song": key_by_id[c["song_id"]], "type": c["chart_type"],
         "level": c["level"], "note_count": c["note_count"], "step_artist": c["step_artist"]}
        for c in conn.execute("SELECT * FROM charts WHERE mix = ? ORDER BY song_id, chart_type, level", (mix,))
    ]
    # 앱은 기록 페이지의 자켓 해시로 곡을 찾는다. 매칭 안 된 해시도 넣어 두면 한국어 곡명은 보여줄 수 있다.
    piugame_out = [
        {"hash": p["piugame_hash"], "song": key_by_id.get(p["song_id"]), "name_ko": p["name_ko"]}
        for p in conn.execute("SELECT * FROM piugame_songs WHERE mix = ? ORDER BY piugame_hash", (mix,))
    ]

    catalog_json = {
        "format": FORMAT_VERSION, "mix": mix, "generated_at": now(),
        "thumb": {"size": thumb_size, "format": "webp", "quality": quality} if with_thumbnails else None,
        "songs": songs_out, "charts": charts_out, "piugame_songs": piugame_out,
    }
    path = out_dir / "catalog.json"
    path.write_text(json.dumps(catalog_json, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    thumbs = list(jackets_dir.glob("*.webp")) if with_thumbnails else []
    return {
        "out_dir": str(out_dir), "songs": len(songs_out), "charts": len(charts_out),
        "piugame_songs": len(piugame_out), "songs_with_name_ko": sum(1 for s in songs_out if s["name_ko"]),
        "catalog_json_bytes": path.stat().st_size,
        "catalog_json_gzip_bytes": len(gzip.compress(path.read_bytes(), 9)),
        "thumbnails": len(thumbs), "thumbnails_bytes": sum(t.stat().st_size for t in thumbs),
        "missing_jackets": missing_jackets,
    }
