"""공유 카탈로그(songs, charts)와 piugame 쪽 곡(piugame_songs, piugame_charts) 저장·조회."""

import sqlite3

# Over Lv.20 Ranking에 나오는 채보: Single/Double 20 이상, CoOp 전부.
OVER_RANKING_MIN_LEVEL = 20


def upsert_song(conn: sqlite3.Connection, mix: str, song: dict, ts: str) -> int:
    bpm = song.get("bpm") or {}
    conn.execute(
        """
        INSERT INTO songs (mix, name_en, artist, bpm_min, bpm_max, song_type, channel, duration_seconds,
                           piuscores_image_url, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (mix, name_en) DO UPDATE SET
            artist = excluded.artist, bpm_min = excluded.bpm_min, bpm_max = excluded.bpm_max,
            song_type = excluded.song_type, channel = excluded.channel,
            duration_seconds = excluded.duration_seconds,
            -- 이미지 URL이 바뀌면 받아 둔 CDN 해시는 무효 (크기는 cdn_size_url로 따로 판단)
            cdn_sha256 = CASE WHEN songs.piuscores_image_url IS excluded.piuscores_image_url
                              THEN songs.cdn_sha256 END,
            cdn_jacket_path = CASE WHEN songs.piuscores_image_url IS excluded.piuscores_image_url
                                   THEN songs.cdn_jacket_path END,
            piuscores_image_url = excluded.piuscores_image_url,
            synced_at = excluded.synced_at
        """,
        (mix, song["name"], song.get("artist"), bpm.get("min"), bpm.get("max"), song.get("type"),
         song.get("channel"), song.get("durationSeconds"), song.get("imageUrl"), ts),
    )
    return conn.execute("SELECT id FROM songs WHERE mix = ? AND name_en = ?", (mix, song["name"])).fetchone()[0]


def upsert_chart(conn: sqlite3.Connection, song_id: int, mix: str, chart: dict, ts: str) -> None:
    conn.execute(
        """
        INSERT INTO charts (song_id, mix, piuscores_chart_id, chart_type, level, note_count, step_artist, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (piuscores_chart_id) DO UPDATE SET
            song_id = excluded.song_id, chart_type = excluded.chart_type, level = excluded.level,
            note_count = excluded.note_count, step_artist = excluded.step_artist, synced_at = excluded.synced_at
        """,
        (song_id, mix, chart["id"], chart["type"], chart["level"], chart.get("noteCount"),
         chart.get("stepArtist"), ts),
    )


def songs_needing_cdn_size(conn: sqlite3.Connection, mix: str) -> list[sqlite3.Row]:
    return conn.execute(
        """SELECT id, name_en, piuscores_image_url FROM songs
           WHERE mix = ? AND piuscores_image_url IS NOT NULL AND cdn_size_url IS NOT piuscores_image_url""",
        (mix,),
    ).fetchall()


def set_cdn_size(conn: sqlite3.Connection, song_id: int, url: str, size: int | None) -> None:
    conn.execute("UPDATE songs SET cdn_size = ?, cdn_size_url = ? WHERE id = ?", (size, url, song_id))


def set_cdn_hash(conn: sqlite3.Connection, song_id: int, sha256: str, path: str) -> None:
    conn.execute("UPDATE songs SET cdn_sha256 = ?, cdn_jacket_path = ? WHERE id = ?", (sha256, path, song_id))


def songs_with_cdn_size(conn: sqlite3.Connection, mix: str, size: int) -> list[sqlite3.Row]:
    return conn.execute("SELECT * FROM songs WHERE mix = ? AND cdn_size = ?", (mix, size)).fetchall()


def song_by_name(conn: sqlite3.Connection, mix: str, name_en: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM songs WHERE mix = ? AND name_en = ?", (mix, name_en)).fetchone()


def chart_set(conn: sqlite3.Connection, song_id: int) -> set[tuple[str, int]]:
    rows = conn.execute("SELECT chart_type, level FROM charts WHERE song_id = ?", (song_id,))
    return {(r["chart_type"], r["level"]) for r in rows}


def upsert_piugame_song(conn: sqlite3.Connection, mix: str, piugame_hash: str, name_ko: str | None,
                        jacket_url: str | None, source: str, ts: str) -> bool:
    """새로 생긴 해시면 True."""
    existed = conn.execute("SELECT 1 FROM piugame_songs WHERE mix = ? AND piugame_hash = ?",
                           (mix, piugame_hash)).fetchone()
    conn.execute(
        """
        INSERT INTO piugame_songs (mix, piugame_hash, name_ko, jacket_url, source, first_seen_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (mix, piugame_hash) DO UPDATE SET
            name_ko = COALESCE(excluded.name_ko, piugame_songs.name_ko),
            jacket_url = COALESCE(excluded.jacket_url, piugame_songs.jacket_url),
            updated_at = excluded.updated_at
        """,
        (mix, piugame_hash, name_ko, jacket_url, source, ts, ts),
    )
    return existed is None


def add_piugame_chart(conn: sqlite3.Connection, mix: str, piugame_hash: str, chart_type: str, level: int) -> None:
    conn.execute("INSERT OR IGNORE INTO piugame_charts VALUES (?, ?, ?, ?)", (mix, piugame_hash, chart_type, level))


def piugame_chart_set(conn: sqlite3.Connection, mix: str, piugame_hash: str) -> set[tuple[str, int]]:
    rows = conn.execute("SELECT chart_type, level FROM piugame_charts WHERE mix = ? AND piugame_hash = ?",
                        (mix, piugame_hash))
    return {(r["chart_type"], r["level"]) for r in rows}


def unmatched_piugame_songs(conn: sqlite3.Connection, mix: str) -> list[sqlite3.Row]:
    return conn.execute("SELECT * FROM piugame_songs WHERE mix = ? AND song_id IS NULL ORDER BY first_seen_at",
                        (mix,)).fetchall()


def set_piugame_jacket(conn: sqlite3.Connection, mix: str, piugame_hash: str, path: str, size: int,
                       sha256: str) -> None:
    conn.execute(
        "UPDATE piugame_songs SET jacket_path = ?, jacket_size = ?, jacket_sha256 = ? WHERE mix = ? AND piugame_hash = ?",
        (path, size, sha256, mix, piugame_hash))


def set_match(conn: sqlite3.Connection, mix: str, piugame_hash: str, song_id: int | None, method: str | None,
              note: str | None) -> None:
    conn.execute(
        "UPDATE piugame_songs SET song_id = ?, match_method = ?, match_note = ? WHERE mix = ? AND piugame_hash = ?",
        (song_id, method, note, mix, piugame_hash))


def over_ranking_filter(chart_type: str, level: int) -> str:
    """Over Lv.20 Ranking의 lv 필터 값."""
    if chart_type == "CoOp":
        return "coop"
    return "27over" if level >= 27 else str(level)


def songs_needing_ko(conn: sqlite3.Connection, mix: str) -> dict[int, set[str]]:
    """Over Lv.20 Ranking에 나올 채보가 있는데 한국어 곡명이 없고, 아직 찾아본 적 없는 곡 → 그 곡이 나올 lv 필터들."""
    rows = conn.execute(
        """
        SELECT s.id AS song_id, c.chart_type, c.level
        FROM songs s JOIN charts c ON c.song_id = s.id
        WHERE s.mix = ?
          AND (c.chart_type = 'CoOp' OR c.level >= ?)
          AND NOT EXISTS (SELECT 1 FROM piugame_songs p WHERE p.song_id = s.id AND p.name_ko IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM songs_ko_checked k WHERE k.song_id = s.id)
        """,
        (mix, OVER_RANKING_MIN_LEVEL),
    )
    result: dict[int, set[str]] = {}
    for r in rows:
        result.setdefault(r["song_id"], set()).add(over_ranking_filter(r["chart_type"], r["level"]))
    return result


def mark_ko_checked(conn: sqlite3.Connection, song_ids: list[int], ts: str) -> None:
    conn.executemany("INSERT OR REPLACE INTO songs_ko_checked VALUES (?, ?)", [(i, ts) for i in song_ids])


def hash_conflicts(conn: sqlite3.Connection, mix: str) -> list[dict]:
    """같은 song_id에 piugame 해시가 여러 개 — 자켓이 바뀌었거나 잘못 매칭된 경우."""
    rows = conn.execute(
        """
        SELECT s.id AS song_id, s.name_en, p.piugame_hash, p.name_ko, p.match_method
        FROM piugame_songs p JOIN songs s ON s.id = p.song_id
        WHERE p.mix = ? AND p.song_id IN (
            SELECT song_id FROM piugame_songs WHERE mix = ? AND song_id IS NOT NULL
            GROUP BY song_id HAVING COUNT(*) > 1)
        ORDER BY s.id
        """,
        (mix, mix),
    ).fetchall()
    grouped: dict[int, dict] = {}
    for r in rows:
        g = grouped.setdefault(r["song_id"], {"song_id": r["song_id"], "name_en": r["name_en"], "hashes": []})
        g["hashes"].append({"hash": r["piugame_hash"], "name_ko": r["name_ko"], "method": r["match_method"]})
    return list(grouped.values())


def catalog_stats(conn: sqlite3.Connection, mix: str) -> dict:
    one = lambda sql: conn.execute(sql, (mix,)).fetchone()[0]  # noqa: E731
    return {
        "songs": one("SELECT COUNT(*) FROM songs WHERE mix = ?"),
        "charts": one("SELECT COUNT(*) FROM charts WHERE mix = ?"),
        "piugame_songs": one("SELECT COUNT(*) FROM piugame_songs WHERE mix = ?"),
        "piugame_songs_matched": one("SELECT COUNT(*) FROM piugame_songs WHERE mix = ? AND song_id IS NOT NULL"),
        "songs_with_name_ko": one(
            "SELECT COUNT(DISTINCT song_id) FROM piugame_songs WHERE mix = ? AND song_id IS NOT NULL AND name_ko IS NOT NULL"),
        "songs_without_cdn_size": one(
            "SELECT COUNT(*) FROM songs WHERE mix = ? AND piuscores_image_url IS NOT NULL AND cdn_size IS NULL"),
    }
