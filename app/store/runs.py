import json
import sqlite3

from app.db import now


def start_run(conn: sqlite3.Connection, kind: str, user_id: int | None = None) -> int:
    with conn:
        cur = conn.execute("INSERT INTO sync_runs (user_id, kind, started_at, status) VALUES (?, ?, ?, 'running')",
                           (user_id, kind, now()))
    return cur.lastrowid


def finish_run(conn: sqlite3.Connection, run_id: int, status: str, summary: dict) -> None:
    with conn:
        conn.execute("UPDATE sync_runs SET finished_at = ?, status = ?, summary = ? WHERE id = ?",
                     (now(), status, json.dumps(summary, ensure_ascii=False, default=str), run_id))


def last_run(conn: sqlite3.Connection, kind: str, user_id: int | None = None, status: str = "ok") -> sqlite3.Row | None:
    return conn.execute(
        """SELECT * FROM sync_runs WHERE kind = ? AND user_id IS ? AND status = ?
           ORDER BY finished_at DESC LIMIT 1""",
        (kind, user_id, status),
    ).fetchone()
