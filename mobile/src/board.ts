// 레벨별 기록표 데이터: 카탈로그 채보 + 내 기록 → 타일, 요약, 정렬, 등급 구역.
// 기록은 piugame 자켓 해시로 저장돼 있다. 해시 → 곡은 카탈로그 대응표, 없으면 앱이 직접 매칭한 결과를 쓴다.
// 자켓이 바뀌어 해시가 여러 개여도 곡 단위로 묶어 가장 좋은 기록 하나를 보여준다.

import type { Catalog } from "./catalog";
import type { Db, RecordRow } from "./db";
import { type GradeBand, gradeBand, isBetter, PLATES } from "./merge";
import type { ChartType } from "./piu/parser";

export type Lang = "ko" | "en";
export type SortMode = "score" | "name" | "grade";

export interface Tile {
  key: string; // 곡 키(카탈로그) 또는 "hash:<piugame 해시>"(카탈로그에 없는 곡)
  nameKo: string | null;
  nameEn: string | null;
  jacket: string | null;
  record: RecordRow | null; // null 또는 stage_break면 "기록 없음"
  improved: boolean; // 마지막 갱신에서 바뀐 기록
  inCatalog: boolean;
}

export interface Summary {
  clear: number;
  total: number;
  bands: Record<GradeBand, number>;
  plates: Record<(typeof PLATES)[number], number>;
}

export interface Group {
  label: string;
  color: string;
  tiles: Tile[];
  sub: string;
}

export const hasRecord = (t: Tile) => !!t.record && t.record.status !== "stage_break";

export function tileName(t: Tile, lang: Lang): string {
  return (lang === "en" ? t.nameEn ?? t.nameKo : t.nameKo ?? t.nameEn) ?? "알 수 없는 곡";
}

export async function buildTiles(db: Db, catalog: Catalog, type: ChartType, level: number): Promise<Tile[]> {
  const local = new Map((await db.localSongs(catalog.mix)).map((s) => [s.piugame_hash, s]));
  const songOf = (hash: string) => catalog.songByHash.get(hash) ?? local.get(hash)?.song_key ?? null;

  // 카탈로그에 한국어 곡명이 없는 곡도, 플레이해서 piugame 곡명을 알게 되면 한국어로 보여준다.
  const koFromPlays = new Map<string, string>();
  for (const s of local.values()) {
    const key = songOf(s.piugame_hash);
    if (key && s.name_ko) koFromPlays.set(key, s.name_ko);
  }
  const changed = await db.changedInLastRun(catalog.mix);

  const bySong = new Map<string, RecordRow>();
  const improved = new Set<string>();
  const orphans: Tile[] = [];
  for (const r of await db.records(catalog.mix, type, level)) {
    const key = songOf(r.piugame_hash);
    const wasChanged = changed.has(`${r.piugame_hash}|${r.chart_type}|${r.level}`);
    if (key && catalog.songs.has(key)) {
      if (isBetter(r, bySong.get(key))) bySong.set(key, r);
      if (wasChanged) improved.add(key);
    } else {
      const s = local.get(r.piugame_hash);
      orphans.push({ key: `hash:${r.piugame_hash}`, nameKo: s?.name_ko ?? null, nameEn: null,
                     jacket: s?.jacket_url ?? null, record: r, improved: wasChanged, inCatalog: false });
    }
  }

  const tiles: Tile[] = [];
  for (const c of catalog.chartsAt(type, level)) {
    const song = catalog.songs.get(c.song);
    if (!song) continue;
    tiles.push({
      key: song.key, nameKo: song.name_ko ?? koFromPlays.get(song.key) ?? null, nameEn: song.name_en,
      jacket: catalog.jacketUrl(song), record: bySong.get(song.key) ?? null, improved: improved.has(song.key), inCatalog: true,
    });
  }
  return [...tiles, ...orphans];
}

export function summarize(tiles: Tile[]): Summary {
  const bands: Record<GradeBand, number> = { SSS: 0, SS: 0, S: 0, "A-": 0 };
  const plates = Object.fromEntries(PLATES.map((p) => [p, 0])) as Summary["plates"];
  let clear = 0;
  for (const t of tiles) {
    if (t.record?.status !== "pass") continue;
    clear++;
    const band = gradeBand(t.record.grade);
    if (band) bands[band]++;
    const plate = t.record.plate as keyof Summary["plates"] | null;
    if (plate && plate in plates) plates[plate]++;
  }
  return { clear, total: tiles.length, bands, plates };
}

const scoreOf = (t: Tile) => (hasRecord(t) ? t.record!.score ?? -1 : -2);

export function sortTiles(tiles: Tile[], mode: SortMode, lang: Lang): Tile[] {
  const byName = (a: Tile, b: Tile) => tileName(a, lang).localeCompare(tileName(b, lang), lang === "ko" ? "ko" : "en");
  const sorted = [...tiles];
  if (mode === "name") sorted.sort(byName);
  else sorted.sort((a, b) => scoreOf(b) - scoreOf(a) || byName(a, b));
  return sorted;
}

const GROUPS: { label: string; color: string; test: (t: Tile) => boolean }[] = [
  { label: "SSS+", color: "#F5C542", test: (t) => t.record?.status === "pass" && t.record.grade === "SSS+" },
  { label: "SSS", color: "#F5C542", test: (t) => t.record?.status === "pass" && t.record.grade === "SSS" },
  { label: "SS+", color: "#E6D29A", test: (t) => t.record?.status === "pass" && t.record.grade === "SS+" },
  { label: "SS", color: "#E6D29A", test: (t) => t.record?.status === "pass" && t.record.grade === "SS" },
  { label: "S+ · S", color: "#9FD5FF", test: (t) => t.record?.status === "pass" && (t.record.grade === "S+" || t.record.grade === "S") },
  { label: "AAA 이하", color: "#8BE3A8", test: (t) => t.record?.status === "pass" },
  { label: "실패", color: "#FF8A8A", test: (t) => t.record?.status === "broken" },
  { label: "기록 없음", color: "#8A909C", test: () => true },
];

/** 등급순 보기: V-ARCHIVE처럼 등급 구역으로 묶는다. 빈 구역은 뺀다. */
export function groupByGrade(tiles: Tile[], lang: Lang): Group[] {
  const buckets = GROUPS.map((g) => ({ ...g, tiles: [] as Tile[] }));
  for (const t of sortTiles(tiles, "score", lang)) buckets.find((g) => g.test(t))!.tiles.push(t);
  return buckets.filter((g) => g.tiles.length).map((g) => {
    const scores = g.tiles.filter(hasRecord).map((t) => t.record!.score ?? 0);
    const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
    const sub = !scores.length ? "" : g.label === "실패" ? `최고 ${fmt(Math.max(...scores))}`
      : `평균 ${fmt(scores.reduce((a, b) => a + b, 0) / scores.length)}`;
    return { label: g.label, color: g.color, tiles: g.tiles, sub };
  });
}
