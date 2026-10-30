// 폰 내부 SQLite. 스키마는 PC의 app/migrations/001_init.sql(3단계 설계)을 따르되,
// 카탈로그(songs, charts)는 내장 catalog.json을 그대로 쓰므로 여기에는 사용자 데이터만 둔다.
// piugame_songs는 카탈로그에 없던 piugame 해시를 앱이 직접 매칭한 결과다.

import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from "@capacitor-community/sqlite";
import { bestPlayToPatch, type ChangeTag, recordChange, type RecordValue } from "./merge";
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
  // v2: 기록 이력, PUMBILITY 추이, 최고 기록을 세운 플레이 표시. 기존 테이블·데이터는 그대로 둔다.
  `
  CREATE TABLE IF NOT EXISTS record_history (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, mix TEXT NOT NULL, piugame_hash TEXT NOT NULL,
    chart_type TEXT NOT NULL, level INTEGER NOT NULL,
    old_score INTEGER, old_grade TEXT, old_plate TEXT, old_status TEXT,
    new_score INTEGER, new_grade TEXT, new_plate TEXT, new_status TEXT NOT NULL,
    tags TEXT NOT NULL,           -- JSON: first_clear / grade_up / plate_up / score_up
    kind TEXT NOT NULL,           -- change: 갱신으로 바뀜 / baseline: v2 업데이트 시점에 이미 있던 기록
    changed_at TEXT NOT NULL, sync_run_id INTEGER);
  CREATE INDEX IF NOT EXISTS record_history_by_chart ON record_history (user_id, mix, piugame_hash, chart_type, level);
  CREATE INDEX IF NOT EXISTS record_history_by_run ON record_history (sync_run_id);
  CREATE TABLE IF NOT EXISTS pumbility_history (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, mix TEXT NOT NULL, value REAL NOT NULL,
    fetched_at TEXT NOT NULL, sync_run_id INTEGER);
  ALTER TABLE plays ADD COLUMN set_best INTEGER NOT NULL DEFAULT 0;
  INSERT INTO record_history (user_id, mix, piugame_hash, chart_type, level, new_score, new_grade, new_plate,
                              new_status, tags, kind, changed_at)
    SELECT user_id, mix, piugame_hash, chart_type, level, score, grade, plate, status, '[]', 'baseline',
           COALESCE(played_at, updated_at)
    FROM records WHERE status != 'stage_break';
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

export interface RecordChange {
  piugame_hash: string;
  chart_type: string;
  level: number;
  old: RecordValue | null;
  new: RecordValue;
  tags: ChangeTag[];
}

export interface SaveResult {
  newPlays: number;
  patched: number;
  changes: RecordChange[];
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

  /**
   * 받아 온 최고 기록과 최근 플레이를 저장한다.
   * - 최근 플레이는 중복 없이 계속 쌓는다(piugame은 최근 약 50개만 보여준다).
   * - 클리어가 아닌 최고 기록은 최근 플레이로 보완한다.
   * - 기존 최고 기록과 달라진 것은 이전 값·새 값을 record_history에 남기고(덮어쓰기 전에 기록),
   *   그 기록을 세운 플레이에 set_best를 표시한다.
   */
  async saveFetched(mix: string, best: ChartScore[], plays: RecentPlay[], runId: number): Promise<SaveResult> {
    const ts = now();
    const before = await this.count("plays");
    const first: Stmt[] = [];
    for (const s of [...best, ...plays]) if (s.jacketHash) first.push(this.songStmt(mix, s, ts));
    for (const p of plays) {
      if (!p.jacketHash || !p.playedAt) continue;
      first.push({
        statement: `INSERT OR IGNORE INTO plays (user_id, mix, piugame_hash, chart_type, level, score, grade, plate, status,
                      perfect, great, good, bad, miss, played_at, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        values: [USER_ID, mix, p.jacketHash, p.chartType, p.level, p.score, p.grade, p.plate, p.status,
                 p.perfect, p.great, p.good, p.bad, p.miss, p.playedAt, ts],
      });
    }
    await this.batch(first);

    const key = (h: string, t: string, l: number) => `${h}|${t}|${l}`;
    const existing = new Map((await this.rows<RecordRow>("SELECT * FROM records WHERE user_id = ? AND mix = ?", [USER_ID, mix]))
      .map((r) => [key(r.piugame_hash, r.chart_type, r.level), r]));
    const playsByChart = new Map<string, (RecordRow & { id: number })[]>();
    for (const p of await this.rows<RecordRow & { id: number }>("SELECT * FROM plays WHERE user_id = ? AND mix = ?", [USER_ID, mix])) {
      const k = key(p.piugame_hash, p.chart_type, p.level);
      playsByChart.set(k, [...(playsByChart.get(k) ?? []), p]);
    }

    const writes: Stmt[] = [];
    const changes: RecordChange[] = [];
    let patched = 0;
    for (const s of best) {
      if (!s.jacketHash) continue;
      const k = key(s.jacketHash, s.chartType, s.level);
      let rec: RecordRow = { piugame_hash: s.jacketHash, chart_type: s.chartType, level: s.level, score: s.score,
                             grade: s.grade, plate: s.plate, status: s.status, played_at: s.playedAt };
      let source = "best_list";
      const better = bestPlayToPatch(rec, playsByChart.get(k) ?? []);
      if (better) {
        rec = { ...rec, score: better.score, grade: better.grade, plate: better.plate, status: better.status, played_at: better.played_at };
        source = "recent_play";
        patched++;
      }

      const old = existing.get(k) ?? null;
      const tags = recordChange(old, rec);
      if (tags) {
        changes.push({ piugame_hash: rec.piugame_hash, chart_type: rec.chart_type, level: rec.level, old, new: rec, tags });
        writes.push({
          statement: `INSERT INTO record_history (user_id, mix, piugame_hash, chart_type, level, old_score, old_grade, old_plate,
                        old_status, new_score, new_grade, new_plate, new_status, tags, kind, changed_at, sync_run_id)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'change', ?, ?)`,
          values: [USER_ID, mix, rec.piugame_hash, rec.chart_type, rec.level, old?.score ?? null, old?.grade ?? null,
                   old?.plate ?? null, old?.status ?? null, rec.score, rec.grade, rec.plate, rec.status,
                   JSON.stringify(tags), ts, runId],
        });
        // 이번에 받은 최근 플레이 중 새 최고 기록과 같은 점수·상태의 플레이 = 그 기록을 세운 플레이
        const setter = plays.find((p) => p.jacketHash === rec.piugame_hash && p.chartType === rec.chart_type &&
                                         p.level === rec.level && p.score === rec.score && p.status === rec.status);
        if (setter?.playedAt) {
          writes.push({
            statement: `UPDATE plays SET set_best = 1 WHERE user_id = ? AND mix = ? AND piugame_hash = ? AND chart_type = ?
                          AND level = ? AND played_at = ?`,
            values: [USER_ID, mix, rec.piugame_hash, rec.chart_type, rec.level, setter.playedAt],
          });
        }
      }
      writes.push({
        statement: `INSERT INTO records (user_id, mix, piugame_hash, chart_type, level, score, grade, plate, status,
                      played_at, source, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT (user_id, mix, piugame_hash, chart_type, level) DO UPDATE SET
                      score = excluded.score, grade = excluded.grade, plate = excluded.plate, status = excluded.status,
                      played_at = excluded.played_at, source = excluded.source, updated_at = excluded.updated_at`,
        values: [USER_ID, mix, rec.piugame_hash, rec.chart_type, rec.level, rec.score, rec.grade, rec.plate, rec.status,
                 rec.played_at, source, ts],
      });
    }
    await this.batch(writes);
    return { newPlays: (await this.count("plays")) - before, patched, changes };
  }

  async addPumbility(mix: string, value: number, runId: number): Promise<number | null> {
    const prev = (await this.conn.query(
      "SELECT value FROM pumbility_history WHERE user_id = ? AND mix = ? ORDER BY fetched_at DESC LIMIT 1", [USER_ID, mix])).values?.[0];
    await this.conn.run("INSERT INTO pumbility_history (user_id, mix, value, fetched_at, sync_run_id) VALUES (?, ?, ?, ?, ?)",
      [USER_ID, mix, value, now(), runId]);
    return prev ? Number(prev.value) : null;
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

  /** 마지막으로 성공한 갱신에서 바뀐 기록들의 키("해시|타입|레벨"). */
  async changedInLastRun(mix: string): Promise<Set<string>> {
    const rows = await this.rows<{ piugame_hash: string; chart_type: string; level: number }>(
      `SELECT piugame_hash, chart_type, level FROM record_history
       WHERE user_id = ? AND mix = ? AND kind = 'change' AND sync_run_id = (
         SELECT id FROM sync_runs WHERE kind = 'records' AND status = 'ok' ORDER BY finished_at DESC LIMIT 1)`,
      [USER_ID, mix]);
    return new Set(rows.map((r) => `${r.piugame_hash}|${r.chart_type}|${r.level}`));
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
