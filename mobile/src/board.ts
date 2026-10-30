// 레벨별 기록표 데이터: 카탈로그 채보 + 내 기록 → 타일.
// 기록은 piugame 자켓 해시로 저장돼 있다. 해시 → 곡은 카탈로그 대응표, 없으면 앱이 직접 매칭한 결과를 쓴다.
// 자켓이 바뀌어 해시가 여러 개여도 곡 단위로 묶어 가장 좋은 기록 하나를 보여준다.

import type { Catalog, Song } from "./catalog";
import type { Db, RecordRow } from "./db";
import { type GradeBand, gradeBand, isBetter } from "./merge";
import type { ChartType } from "./piu/parser";

export interface Tile {
  name: string;
  jacket: string | null;
  record: RecordRow | null; // null 또는 stage_break면 "기록 없음"
  inCatalog: boolean;
}

export interface Board {
  tiles: Tile[];
  clear: number;
  total: number;
  bands: Record<GradeBand, number>;
}

export async function buildBoard(db: Db, catalog: Catalog, type: ChartType, level: number): Promise<Board> {
  const local = new Map((await db.localSongs(catalog.mix)).map((s) => [s.piugame_hash, s]));
  const songOf = (hash: string) => catalog.songByHash.get(hash) ?? local.get(hash)?.song_key ?? null;

  // 카탈로그에 한국어 곡명이 없는 곡도, 플레이해서 piugame 곡명을 알게 되면 한국어로 보여준다.
  const koFromPlays = new Map<string, string>();
  for (const s of local.values()) {
    const key = songOf(s.piugame_hash);
    if (key && s.name_ko) koFromPlays.set(key, s.name_ko);
  }
  const nameOf = (song: Song) => song.name_ko ?? koFromPlays.get(song.key) ?? song.name_en;

  const bySong = new Map<string, RecordRow>();
  const orphans: Tile[] = [];
  for (const r of await db.records(catalog.mix, type, level)) {
    const key = songOf(r.piugame_hash);
    if (key && catalog.songs.has(key)) {
      if (isBetter(r, bySong.get(key))) bySong.set(key, r);
    } else {
      const s = local.get(r.piugame_hash);
      orphans.push({ name: s?.name_ko ?? "알 수 없는 곡", jacket: s?.jacket_url ?? null, record: r, inCatalog: false });
    }
  }

  const tiles: Tile[] = catalog.chartsAt(type, level).flatMap((c) => {
    const song = catalog.songs.get(c.song);
    return song
      ? [{ name: nameOf(song), jacket: catalog.jacketUrl(song), record: bySong.get(song.key) ?? null, inCatalog: true }]
      : [];
  });
  tiles.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  tiles.push(...orphans);

  const bands: Record<GradeBand, number> = { SSS: 0, SS: 0, S: 0, "AAA-": 0 };
  let clear = 0;
  for (const t of tiles) {
    if (t.record?.status !== "pass") continue;
    clear++;
    const band = gradeBand(t.record.grade);
    if (band) bands[band]++;
  }
  return { tiles, clear, total: tiles.length, bands };
}
