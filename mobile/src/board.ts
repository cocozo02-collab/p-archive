// 기록표 데이터: 카탈로그 채보 + 내 기록 → 타일, 요약, 정렬, 등급 구역.
// 기록은 piugame 자켓 해시로 저장돼 있다. 해시 → 곡은 카탈로그 대응표, 없으면 앱이 직접 매칭한 결과를 쓴다.
// 자켓이 바뀌어 해시가 여러 개여도 곡 단위로 묶어 가장 좋은 기록 하나를 보여준다.

import type { Catalog } from "./catalog";
import type { Db, LocalSong, RecordRow } from "./db";
import { jacketSrc } from "./jackets";
import { type GradeBand, gradeBand, isBetter, PLATES } from "./merge";
import type { ChartType } from "./piu/parser";

export type Lang = "ko" | "en";
export type SortMode = "score" | "name" | "grade";

/** 화면에 곡을 그릴 때 필요한 정보. 카탈로그 곡이면 key=곡 키, 아니면 "hash:<piugame 해시>". */
export interface SongView {
  key: string;
  songKey: string | null;
  hashes: string[];
  nameKo: string | null;
  nameEn: string | null;
  jk: string | null; // 자켓 캐시 키
  jsrc: string | null; // 자켓 원본 주소(piugame.com)
}

export interface Tile extends SongView {
  jacket: string | null; // 캐시된 자켓(WebView 주소)
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

export const hasRecord = (t: { record: RecordRow | null }) => !!t.record && t.record.status !== "stage_break";

export function tileName(t: { nameKo: string | null; nameEn: string | null }, lang: Lang): string {
  return (lang === "en" ? t.nameEn ?? t.nameKo : t.nameKo ?? t.nameEn) ?? "알 수 없는 곡";
}

/** 해시 → 곡 정보. 한 번 만들어 기록표·곡 상세·최근 플레이·통계에서 같이 쓴다. */
export class SongIndex {
  private constructor(
    readonly catalog: Catalog,
    private local: Map<string, LocalSong>,
    private koFromPlays: Map<string, string>,
    private jacketFromPlays: Map<string, string>,
    readonly changed: Set<string>,
  ) {}

  static async load(db: Db, catalog: Catalog): Promise<SongIndex> {
    const local = new Map((await db.localSongs(catalog.mix)).map((s) => [s.piugame_hash, s]));
    const songOf = (h: string) => catalog.songByHash.get(h) ?? local.get(h)?.song_key ?? null;
    // 카탈로그에 한국어 곡명·자켓 주소가 없는 곡도, 플레이해서 piugame에서 알게 되면 그것을 쓴다.
    const ko = new Map<string, string>();
    const jacket = new Map<string, string>();
    for (const s of local.values()) {
      const key = songOf(s.piugame_hash);
      if (!key) continue;
      if (s.name_ko) ko.set(key, s.name_ko);
      if (s.jacket_url) jacket.set(key, s.jacket_url);
    }
    return new SongIndex(catalog, local, ko, jacket, await db.changedInLastRun(catalog.mix));
  }

  songOf(hash: string): string | null {
    const key = this.catalog.songByHash.get(hash) ?? this.local.get(hash)?.song_key ?? null;
    return key && this.catalog.songs.has(key) ? key : null;
  }

  bySong(songKey: string): SongView {
    const song = this.catalog.songs.get(songKey)!;
    const hashes = new Set(this.catalog.hashesBySong.get(songKey) ?? []);
    for (const s of this.local.values()) if (s.song_key === songKey) hashes.add(s.piugame_hash);
    return {
      key: songKey, songKey, hashes: [...hashes],
      nameKo: song.name_ko ?? this.koFromPlays.get(songKey) ?? null, nameEn: song.name_en,
      jk: songKey, jsrc: song.jacket_url ?? this.jacketFromPlays.get(songKey) ?? null,
    };
  }

  byHash(hash: string): SongView {
    const key = this.songOf(hash);
    if (key) return this.bySong(key);
    const s = this.local.get(hash);
    return { key: `hash:${hash}`, songKey: null, hashes: [hash], nameKo: s?.name_ko ?? null, nameEn: null,
             jk: hash, jsrc: s?.jacket_url ?? null };
  }

  /** 레벨 하나의 타일. records는 그 타입의 기록(레벨 무관)이어도 된다. */
  tiles(records: RecordRow[], type: ChartType, level: number): Tile[] {
    const best = new Map<string, RecordRow>();
    const improved = new Set<string>();
    const orphans = new Map<string, Tile>();
    for (const r of records) {
      if (r.chart_type !== type || r.level !== level) continue;
      const view = this.byHash(r.piugame_hash);
      const wasChanged = this.changed.has(`${r.piugame_hash}|${r.chart_type}|${r.level}`);
      if (view.songKey) {
        if (isBetter(r, best.get(view.key))) best.set(view.key, r);
        if (wasChanged) improved.add(view.key);
      } else {
        orphans.set(view.key, { ...view, jacket: jacketSrc(view.jk), record: r, improved: wasChanged, inCatalog: false });
      }
    }
    const tiles: Tile[] = [];
    for (const c of this.catalog.chartsAt(type, level)) {
      if (!this.catalog.songs.has(c.song)) continue;
      const view = this.bySong(c.song);
      tiles.push({ ...view, jacket: jacketSrc(view.jk), record: best.get(c.song) ?? null, improved: improved.has(c.song), inCatalog: true });
    }
    return [...tiles, ...orphans.values()];
  }
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
