"""사용자별 기록(records, plays) 저장·조회와 병합 규칙."""

import sqlite3
from collections.abc import Mapping

from app.piugame.parser import ChartScore, RecentPlay

STATUS_RANK = {"pass": 2, "broken": 1, "stage_break": 0}


def is_better(a: Mapping, b: Mapping | None) -> bool:
    """a가 b보다 나은 기록인가. 클리어 > 실패 > 스테이지 브레이크, 같은 단계면 점수가 높은 쪽."""
    if b is None:
        return True
    ra, rb = STATUS_RANK[a["status"]], STATUS_RANK[b["status"]]
    if ra != rb:
        return ra > rb
    return (a["score"] or -1) > (b["score"] or -1)


def _iso(dt) -> str | None:
    return dt.isoformat() if dt else None


def upsert_record(conn: sqlite3.Connection, user_id: int, mix: str, s: ChartScore, ts: str) -> None:
    """최고 기록 목록의 한 항목. 사이트의 최고 기록이 기준이므로 그대로 덮어쓴다(보완은 patch_from_plays에서)."""
    conn.execute(
        """
        INSERT INTO records (user_id, mix, piugame_hash, chart_type, level, score, grade, plate, status,
                             played_at, source, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'best_list', ?)
        ON CONFLICT (user_id, mix, piugame_hash, chart_type, level) DO UPDATE SET
            score = excluded.score, grade = excluded.grade, plate = excluded.plate, status = excluded.status,
            played_at = excluded.played_at, source = excluded.source, updated_at = excluded.updated_at
        """,
        (user_id, mix, s.jacket_hash, s.chart_type, s.level, s.score, s.grade, s.plate, s.status,
         _iso(s.played_at), ts),
    )


def insert_play(conn: sqlite3.Connection, user_id: int, mix: str, p: RecentPlay, ts: str) -> bool:
    """새 플레이면 True. 같은 채보·같은 시각의 플레이는 한 번만 저장한다."""
    cur = conn.execute(
        """
        INSERT OR IGNORE INTO plays (user_id, mix, piugame_hash, chart_type, level, score, grade, plate, status,
                                     perfect, great, good, bad, miss, played_at, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (user_id, mix, p.jacket_hash, p.chart_type, p.level, p.score, p.grade, p.plate, p.status,
         p.perfect, p.great, p.good, p.bad, p.miss, _iso(p.played_at), ts),
    )
    return cur.rowcount == 1


def patch_from_plays(conn: sqlite3.Connection, user_id: int, mix: str, ts: str) -> list[dict]:
    """최고 기록보다 나은 플레이가 plays에 있으면 기록을 그 플레이로 바꾼다.

    예: 최고 기록 목록에는 스테이지 브레이크로만 나오지만, 최근 플레이에 끝까지 친 실패 기록이 있는 경우.
    최고 기록 목록에 아예 없는 채보는 건드리지 않는다(목록이 기준).
    이미 클리어인 기록은 보완하지 않는다. 사이트는 최고 점수와 최고 플레이트를 서로 다른 플레이에서
    골라 합쳐 보여주므로, 플레이 하나로 덮어쓰면 그 합친 값이 깨진다.
    """
    patched = []
    records = conn.execute("SELECT * FROM records WHERE user_id = ? AND mix = ? AND status != 'pass'",
                           (user_id, mix)).fetchall()
    for r in records:
        plays = conn.execute(
            """SELECT * FROM plays WHERE user_id = ? AND mix = ? AND piugame_hash = ? AND chart_type = ? AND level = ?
               AND status != 'stage_break'""",
            (user_id, mix, r["piugame_hash"], r["chart_type"], r["level"]),
        ).fetchall()
        best = None
        for p in plays:
            if is_better(p, best):
                best = p
        if best is not None and is_better(best, r):
            conn.execute(
                """UPDATE records SET score = ?, grade = ?, plate = ?, status = ?, played_at = ?,
                   source = 'recent_play', updated_at = ? WHERE id = ?""",
                (best["score"], best["grade"], best["plate"], best["status"], best["played_at"], ts, r["id"]),
            )
            patched.append({"piugame_hash": r["piugame_hash"], "chart": f"{r['chart_type']} {r['level']}",
                            "from": f"{r['status']} {r['score']}", "to": f"{best['status']} {best['score']}"})
    return patched


def best_records_by_chart(conn: sqlite3.Connection, user_id: int, mix: str) -> dict[int, sqlite3.Row]:
    """카탈로그 채보(chart_id)별 최고 기록. 자켓이 바뀌어 piugame 해시가 여러 개여도 song_id로 묶어 하나로 합친다."""
    rows = conn.execute(
        """
        SELECT r.*, c.id AS chart_id, p.song_id
        FROM records r
        JOIN piugame_songs p ON p.mix = r.mix AND p.piugame_hash = r.piugame_hash
        JOIN charts c ON c.song_id = p.song_id AND c.chart_type = r.chart_type AND c.level = r.level
        WHERE r.user_id = ? AND r.mix = ?
        """,
        (user_id, mix),
    ).fetchall()
    best: dict[int, sqlite3.Row] = {}
    for r in rows:
        if is_better(r, best.get(r["chart_id"])):
            best[r["chart_id"]] = r
    return best


def unlinked_records(conn: sqlite3.Connection, user_id: int, mix: str) -> list[sqlite3.Row]:
    """카탈로그 채보와 연결되지 않은 기록(곡 미매칭, 또는 카탈로그에 그 타입·레벨 채보가 없음)."""
    return conn.execute(
        """
        SELECT r.*, p.name_ko, p.song_id
        FROM records r
        LEFT JOIN piugame_songs p ON p.mix = r.mix AND p.piugame_hash = r.piugame_hash
        WHERE r.user_id = ? AND r.mix = ? AND NOT EXISTS (
            SELECT 1 FROM charts c WHERE c.song_id = p.song_id AND c.chart_type = r.chart_type AND c.level = r.level)
        """,
        (user_id, mix),
    ).fetchall()


def record_stats(conn: sqlite3.Connection, user_id: int, mix: str) -> dict:
    by_status = dict(conn.execute(
        "SELECT status, COUNT(*) FROM records WHERE user_id = ? AND mix = ? GROUP BY status", (user_id, mix)).fetchall())
    return {
        "records": sum(by_status.values()),
        "by_status": by_status,
        "plays": conn.execute("SELECT COUNT(*) FROM plays WHERE user_id = ? AND mix = ?", (user_id, mix)).fetchone()[0],
        "linked_charts": len(best_records_by_chart(conn, user_id, mix)),
    }
