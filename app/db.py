"""SQLite 연결과 마이그레이션.

app/migrations/NNN_*.sql을 번호 순서로 적용하고, 적용한 마지막 번호를 PRAGMA user_version에 기록한다.
"""

import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from app import config


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect(path: Path = config.DB_PATH) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    migrate(conn)
    return conn


def migrate(conn: sqlite3.Connection) -> None:
    current = conn.execute("PRAGMA user_version").fetchone()[0]
    for sql_file in sorted(config.MIGRATIONS_DIR.glob("*.sql")):
        version = int(sql_file.name.split("_", 1)[0])
        if version <= current:
            continue
        with conn:
            conn.executescript(sql_file.read_text(encoding="utf-8"))
            conn.execute(f"PRAGMA user_version = {version}")
    ensure_default_user(conn)


def ensure_default_user(conn: sqlite3.Connection) -> None:
    with conn:
        conn.execute(
            "INSERT OR IGNORE INTO users (id, display_name, created_at) VALUES (?, ?, ?)",
            (config.DEFAULT_USER_ID, "me", now()),
        )
