"""piugame 곡 ↔ PIU Scores 곡 매칭.

순서: ① 로컬 수동 매핑(seeds/manual_song_map.json, 지정한 경우 우선) → ② 자켓 내용 해시.
자켓 내용 해시는 크기로 후보를 좁힌 뒤(CDN은 HEAD로 받은 크기) 후보만 받아 SHA-256으로 확정한다.
같은 해시 후보가 여럿이면 piugame에서 본 채보 구성(타입+레벨)이 맞는 곡으로 가린다.
PIU Scores 저장소에는 한국어→영어 곡명 데이터가 없어서 곡명 매핑 단계는 없다.
"""

import hashlib
import json
import logging
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

from app import config
from app.piugame.client import PiuGameClient
from app.piuscores.client import PiuScoresClient
from app.store import catalog

log = logging.getLogger(__name__)


@dataclass
class MatchResult:
    by_manual: int = 0
    by_sha: int = 0
    jackets_downloaded: int = 0
    cdn_downloaded: int = 0
    unmatched: list[dict] = field(default_factory=list)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _ext(url: str | None, default: str = ".png") -> str:
    suffix = Path(urlsplit(url or "").path).suffix.lower()
    return suffix if suffix in (".png", ".jpg", ".jpeg", ".webp", ".gif") else default


def load_manual_map(path: Path | None = None) -> dict[str, str]:
    """{piugame 자켓 해시: PIU Scores 영어 곡명}. '_'로 시작하는 키는 설명용이라 무시한다."""
    path = path or config.MANUAL_SONG_MAP
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return {k.lower(): v for k, v in data.items() if not k.startswith("_")}


def ensure_piugame_jacket(conn: sqlite3.Connection, mix: str, row: sqlite3.Row, client: PiuGameClient) -> bytes | None:
    """piugame 자켓을 캐시에서 읽거나 받는다(piugame 요청 간격 규칙을 따른다)."""
    path = config.JACKETS_PIUGAME_DIR / f"{row['piugame_hash']}{_ext(row['jacket_url'])}"
    if path.exists():
        data = path.read_bytes()
    elif row["jacket_url"]:
        data = client.get_binary(row["jacket_url"])
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    else:
        return None
    if row["jacket_sha256"] is None:
        catalog.set_piugame_jacket(conn, mix, row["piugame_hash"], str(path.relative_to(config.DATA_DIR)),
                                   len(data), sha256(data))
    return data


def ensure_cdn_hash(conn: sqlite3.Connection, song: sqlite3.Row, piuscores: PiuScoresClient) -> str | None:
    if song["cdn_sha256"]:
        return song["cdn_sha256"]
    url = song["piuscores_image_url"]
    path = config.JACKETS_CDN_DIR / f"{song['id']}_{sha256(url.encode())[:8]}{_ext(url)}"
    if path.exists():
        data = path.read_bytes()
    else:
        data = piuscores.cdn_download(url)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    digest = sha256(data)
    catalog.set_cdn_hash(conn, song["id"], digest, str(path.relative_to(config.DATA_DIR)))
    return digest


def match_pending(conn: sqlite3.Connection, mix: str, client: PiuGameClient, piuscores: PiuScoresClient,
                  progress_every: int = 25) -> MatchResult:
    result = MatchResult()
    manual = load_manual_map()
    pending = catalog.unmatched_piugame_songs(conn, mix)
    if pending and catalog.catalog_stats(conn, mix)["songs_without_cdn_size"]:
        log.warning("CDN 자켓 크기를 모르는 곡이 있음 — 곡 목록 동기화(sync_catalog)를 먼저 끝내야 매칭이 정확하다")
    log.info("매칭 대상 piugame 곡: %d개", len(pending))

    for i, row in enumerate(pending, 1):
        h = row["piugame_hash"]
        label = row["name_ko"] or h

        if h in manual:
            song = catalog.song_by_name(conn, mix, manual[h])
            if song:
                catalog.set_match(conn, mix, h, song["id"], "manual", None)
                result.by_manual += 1
            else:
                catalog.set_match(conn, mix, h, None, None, f"수동 매핑의 곡명이 카탈로그에 없음: {manual[h]}")
                result.unmatched.append({"hash": h, "name_ko": row["name_ko"], "reason": "수동 매핑 곡명 없음"})
            conn.commit()
            continue

        had_file = row["jacket_sha256"] is not None
        data = ensure_piugame_jacket(conn, mix, row, client)
        if data is None:
            catalog.set_match(conn, mix, h, None, None, "자켓 URL 없음")
            result.unmatched.append({"hash": h, "name_ko": row["name_ko"], "reason": "자켓 URL 없음"})
            conn.commit()
            continue
        if not had_file:
            result.jackets_downloaded += 1
        digest = sha256(data)

        candidates = catalog.songs_with_cdn_size(conn, mix, len(data))
        same = []
        for song in candidates:
            downloaded = song["cdn_sha256"] is None
            if ensure_cdn_hash(conn, song, piuscores) == digest:
                same.append(song)
            result.cdn_downloaded += downloaded

        if len(same) > 1:
            seen = catalog.piugame_chart_set(conn, mix, h)
            fitting = [s for s in same if seen <= catalog.chart_set(conn, s["id"])]
            same = fitting if fitting else same

        if len(same) == 1:
            catalog.set_match(conn, mix, h, same[0]["id"], "sha", None)
            result.by_sha += 1
        else:
            reason = ("크기가 같은 PIU Scores 자켓 없음" if not candidates
                      else "내용 해시가 같은 자켓 없음" if not same
                      else f"후보 여러 개: {', '.join(s['name_en'] for s in same)}")
            catalog.set_match(conn, mix, h, None, None, reason)
            result.unmatched.append({"hash": h, "name_ko": row["name_ko"], "reason": reason})
        conn.commit()

        if i % progress_every == 0 or i == len(pending):
            log.info("매칭 진행 %d/%d (해시 매칭 %d, 미매칭 %d, 자켓 받음 %d, CDN 받음 %d) — 방금: %s",
                     i, len(pending), result.by_sha, len(result.unmatched), result.jackets_downloaded,
                     result.cdn_downloaded, label)
    return result
