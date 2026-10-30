// 폰 내부 SQLite. 스키마는 PC의 app/migrations/001_init.sql(3단계 설계)을 따르되,
// 카탈로그(songs, charts)는 내장 catalog.json을 그대로 쓰므로 여기에는 사용자 데이터만 둔다.
// piugame_songs는 카탈로그에 없던 piugame 해시를 앱이 직접 매칭한 결과다.

import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from "@capacitor-community/sqlite";
import type { ChartScore, RecentPlay } from "./piu/parser";

const DB_NAME = "parchive";
export const USER_ID = 1; // 앱은 폰 주인 한 명만 쓴다. 스키마는 user_id를 유지한다.

const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, display_name TEXT NOT NULL, game_tag TEXT, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS piugame_songs (
    mix TEXT NOT NULL, piugame_hash TEXT NOT NULL, name_ko TEXT, jacket_url TEXT, jacket_sha256 TEXT,
    song_key TEXT, match_method TEXT, match_note TEXT, first_seen_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY (mix, piugame_hash));
  CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, mix TEXT NOT NULL, piugame_hash TEXT NOT NULL,
    chart_type TEXT NOT NULL, level INTEGER NOT NULL, score INTEGER, grade TEXT, plate TEXT, status TEXT NOT NULL,
    played_at TEXT, source TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE (user_id, mix, piugame_hash, chart_type, level));
  CREATE TABLE IF NOT EXISTS plays (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, mix TEXT NOT NULL, piugame_hash TEXT NOT NULL,
    chart_type TEXT NOT NULL, level INTEGER NOT NULL, score INTEGER, grade TEXT, plate TEXT, status TEXT NOT NULL,
    perfect INTEGER NOT NULL, great INTEGER NOT NULL, good INTEGER NOT NULL, bad INTEGER NOT NULL,
    miss INTEGER NOT NULL, played_at TEXT NOT NULL, fetched_at TEXT NOT NULL,
    UNIQUE (user_id, mix, piugame_hash, chart_type, level, played_at));
  CREATE TABLE IF NOT EXISTS sync_runs (
    id INTEGER PRIMARY KEY, user_id INTEGER, kind TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
    status TEXT NOT NULL, summary TEXT);
  `,
];

export interface RecordRow {
  piugame_hash: string;
  chart_type: string;
  level: number;
  score: number | null;
  grade: string | null;
  plate: string | null;
  status: "pass" | "broken" | "stage_break";
  played_at: string | null;
}

export interface LocalSong {
  piugame_hash: string;
  name_ko: string | null;
  jacket_url: string | null;
  song_key: string | null;
}

type Stmt = { statement: string; values: unknown[] };

const now = () => new Date().toISOString();

export class Db {
  private constructor(private conn: SQLiteDBConnection) {}

  static async open(): Promise<Db> {
    const sqlite = new SQLiteConnection(CapacitorSQLite);
    await sqlite.checkConnectionsConsistency().catch(() => undefined);
    const existing = (await sqlite.isConnection(DB_NAME, false)).result;
    const conn = existing
      ? await sqlite.retrieveConnection(DB_NAME, false)
      : await sqlite.createConnection(DB_NAME, false, "no-encryption", 1, false);
    await conn.open();
    const db = new Db(conn);
    await db.migrate();
    return db;
  }

  private async migrate(): Promise<void> {
    await this.conn.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
    const row = (await this.conn.query("SELECT value FROM meta WHERE key = 'schema_version'")).values?.[0];
    let version = row ? parseInt(row.value, 10) : 0;
    for (; version < MIGRATIONS.length; version++) {
      await this.conn.execute(MIGRATIONS[version]);
      await this.conn.run("INSERT OR REPLACE INTO meta VALUES ('schema_version', ?)", [String(version + 1)]);
    }
    await this.conn.run("INSERT OR IGNORE INTO users (id, display_name, created_at) VALUES (?, 'me', ?)", [USER_ID, now()]);
  }

  private async batch(stmts: Stmt[]): Promise<void> {
    if (stmts.length) await this.conn.executeSet(stmts as never, true);
  }

  async gameTag(): Promise<string | null> {
    const r = await this.conn.query("SELECT game_tag FROM users WHERE id = ?", [USER_ID]);
    return r.values?.[0]?.game_tag ?? null;
  }

  async setGameTag(tag: string): Promise<void> {
    await this.conn.run("UPDATE users SET game_tag = ? WHERE id = ?", [tag, USER_ID]);
  }

  /** 최고 기록 목록과 최근 플레이를 저장하고, 클리어가 아닌 기록은 최근 플레이로 보완한다. */
  async saveFetched(mix: string, best: ChartScore[], plays: RecentPlay[],
                    patch: (rec: RecordRow, plays: RecordRow[]) => RecordRow | null): Promise<{ newPlays: number; patched: number }> {
    const ts = now();
    const before = await this.count("plays");
    const stmts: Stmt[] = [];
    for (const s of best) {
      if (!s.jacketHash) continue;
      stmts.push(this.songStmt(mix, s, ts), {
        statement: `INSERT INTO records (user_id, mix, piugame_hash, chart_type, level, score, grade, plate, status,
                      played_at, source, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'best_list', ?)
                    ON CONFLICT (user_id, mix, piugame_hash, chart_type, level) DO UPDATE SET
                      score = excluded.score, grade = excluded.grade, plate = excluded.plate, status = excluded.status,
                      played_at = excluded.played_at, source = excluded.source, updated_at = excluded.updated_at`,
        values: [USER_ID, mix, s.jacketHash, s.chartType, s.level, s.score, s.grade, s.plate, s.status, s.playedAt, ts],
      });
    }
    for (const p of plays) {
      if (!p.jacketHash || !p.playedAt) continue;
      stmts.push(this.songStmt(mix, p, ts), {
        statement: `INSERT OR IGNORE INTO plays (user_id, mix, piugame_hash, chart_type, level, score, grade, plate, status,
                      perfect, great, good, bad, miss, played_at, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        values: [USER_ID, mix, p.jacketHash, p.chartType, p.level, p.score, p.grade, p.plate, p.status,
                 p.perfect, p.great, p.good, p.bad, p.miss, p.playedAt, ts],
      });
    }
    await this.batch(stmts);

    const records = await this.rows<RecordRow & { id: number }>(
      "SELECT * FROM records WHERE user_id = ? AND mix = ? AND status != 'pass'", [USER_ID, mix]);
    const allPlays = await this.rows<RecordRow>("SELECT * FROM plays WHERE user_id = ? AND mix = ?", [USER_ID, mix]);
    const updates: Stmt[] = [];
    for (const r of records) {
      const same = allPlays.filter((p) => p.piugame_hash === r.piugame_hash && p.chart_type === r.chart_type && p.level === r.level);
      const best = patch(r, same);
      if (best) {
        updates.push({
          statement: `UPDATE records SET score = ?, grade = ?, plate = ?, status = ?, played_at = ?,
                        source = 'recent_play', updated_at = ? WHERE id = ?`,
          values: [best.score, best.grade, best.plate, best.status, best.played_at, ts, r.id],
        });
      }
    }
    await this.batch(updates);
    return { newPlays: (await this.count("plays")) - before, patched: updates.length };
  }

  private songStmt(mix: string, s: ChartScore, ts: string): Stmt {
    return {
      statement: `INSERT INTO piugame_songs (mix, piugame_hash, name_ko, jacket_url, first_seen_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?)
                  ON CONFLICT (mix, piugame_hash) DO UPDATE SET
                    name_ko = COALESCE(excluded.name_ko, piugame_songs.name_ko),
                    jacket_url = COALESCE(excluded.jacket_url, piugame_songs.jacket_url), updated_at = excluded.updated_at`,
      values: [mix, s.jacketHash, s.songName, s.jacketUrl, ts, ts],
    };
  }

  async localSongs(mix: string): Promise<LocalSong[]> {
    return this.rows("SELECT piugame_hash, name_ko, jacket_url, song_key FROM piugame_songs WHERE mix = ?", [mix]);
  }

  async setLocalMatch(mix: string, hash: string, sha: string | null, songKey: string | null, note: string | null): Promise<void> {
    await this.conn.run(
      `UPDATE piugame_songs SET jacket_sha256 = ?, song_key = ?, match_method = ?, match_note = ?, updated_at = ?
       WHERE mix = ? AND piugame_hash = ?`,
      [sha, songKey, songKey ? "sha" : null, note, now(), mix, hash]);
  }

  async needsMatching(mix: string, known: (hash: string) => boolean): Promise<LocalSong[]> {
    const rows = await this.rows<LocalSong & { match_note: string | null }>(
      "SELECT * FROM piugame_songs WHERE mix = ? AND song_key IS NULL AND match_note IS NULL", [mix]);
    return rows.filter((r) => !known(r.piugame_hash));
  }

  async records(mix: string, chartType: string, level: number): Promise<RecordRow[]> {
    return this.rows("SELECT * FROM records WHERE user_id = ? AND mix = ? AND chart_type = ? AND level = ?",
      [USER_ID, mix, chartType, level]);
  }

  async startRun(kind: string): Promise<number> {
    const r = await this.conn.run("INSERT INTO sync_runs (user_id, kind, started_at, status) VALUES (?, ?, ?, 'running')",
      [USER_ID, kind, now()]);
    return r.changes?.lastId ?? 0;
  }

  async finishRun(id: number, status: "ok" | "failed", summary: unknown): Promise<void> {
    await this.conn.run("UPDATE sync_runs SET finished_at = ?, status = ?, summary = ? WHERE id = ?",
      [now(), status, JSON.stringify(summary), id]);
  }

  async lastSyncAt(): Promise<string | null> {
    const r = await this.conn.query(
      "SELECT finished_at FROM sync_runs WHERE kind = 'records' AND status = 'ok' ORDER BY finished_at DESC LIMIT 1");
    return r.values?.[0]?.finished_at ?? null;
  }

  private async count(table: string): Promise<number> {
    return (await this.conn.query(`SELECT COUNT(*) AS n FROM ${table}`)).values?.[0]?.n ?? 0;
  }

  private async rows<T>(sql: string, values: unknown[] = []): Promise<T[]> {
    return ((await this.conn.query(sql, values as never)).values ?? []) as T[];
  }
}
