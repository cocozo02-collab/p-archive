// 곡 목록(카탈로그). PC의 scripts/export_catalog.py가 만든 catalog.json.
// 앱에 내장한 것과 GitHub 릴리스에서 받은 것 중 더 새것을 쓴다. 읽기 전용이라 메모리에 올려서 쓴다.
// 자켓: APK에 내장한 썸네일(jacket, public/catalog/jackets/)이 있으면 그것을 쓰고,
// 없으면(이후 곡 목록 업데이트로 추가된 곡 등) jacket_url로 piugame.com에서 필요할 때 받는다(jackets.ts).

import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import type { ChartType } from "./piu/parser";

export interface Song {
  key: string;
  name_en: string;
  name_ko: string | null;
  artist: string | null;
  jacket: string | null; // APK에 내장한 썸네일 경로(catalog/ 기준). 없으면 null
  jacket_url: string | null;
  jacket_sha256: string[];
}

export interface Chart {
  id: string;
  song: string; // Song.key
  type: ChartType;
  level: number;
}

export interface CatalogFile {
  format: number;
  mix: string;
  generated_at: string;
  songs: Song[];
  charts: Chart[];
  piugame_songs: { hash: string; song: string | null; name_ko: string | null }[];
}

export const DOWNLOADED_CATALOG = "catalog/catalog.json"; // Directory.Data 기준

/** 받은 곡 목록에서는 APK에 실제로 들어 있는 썸네일만 내장 자켓으로 인정한다. */
export function withBundledJackets(downloaded: CatalogFile, bundled: CatalogFile): CatalogFile {
  const inApk = new Map(bundled.songs.filter((s) => s.jacket).map((s) => [s.key, s.jacket]));
  return { ...downloaded, songs: downloaded.songs.map((s) => ({ ...s, jacket: inApk.get(s.key) ?? null })) };
}

export class Catalog {
  readonly mix: string;
  readonly generatedAt: string;
  readonly songs = new Map<string, Song>();
  readonly charts: Chart[];
  /** piugame 자켓 해시 → 곡 키 */
  readonly songByHash = new Map<string, string>();
  /** 곡 키 → piugame 자켓 해시들 */
  readonly hashesBySong = new Map<string, string[]>();
  /** 자켓 내용 SHA-256 → 곡 키 */
  readonly songBySha = new Map<string, string>();

  constructor(file: CatalogFile) {
    this.mix = file.mix;
    this.generatedAt = file.generated_at;
    for (const s of file.songs) {
      this.songs.set(s.key, s);
      for (const sha of s.jacket_sha256) this.songBySha.set(sha, s.key);
    }
    this.charts = file.charts;
    for (const p of file.piugame_songs) {
      if (!p.song) continue;
      this.songByHash.set(p.hash, p.song);
      this.hashesBySong.set(p.song, [...(this.hashesBySong.get(p.song) ?? []), p.hash]);
    }
  }

  static async load(): Promise<Catalog> {
    const res = await fetch("./catalog/catalog.json");
    if (!res.ok) throw new Error("카탈로그를 읽지 못했습니다");
    const bundled: CatalogFile = await res.json();
    let file = bundled;
    try {
      const saved = await Filesystem.readFile({ path: DOWNLOADED_CATALOG, directory: Directory.Data, encoding: Encoding.UTF8 });
      const downloaded: CatalogFile = JSON.parse(String(saved.data));
      if (downloaded.format === bundled.format && downloaded.generated_at > bundled.generated_at) file = withBundledJackets(downloaded, bundled);
    } catch { /* 받은 카탈로그가 없거나 깨졌으면 내장본을 쓴다 */ }
    return new Catalog(file);
  }

  jacketPath(song: Song): string | null {
    return song.jacket ? `./catalog/${song.jacket}` : null;
  }

  levels(type: ChartType): number[] {
    return [...new Set(this.charts.filter((c) => c.type === type).map((c) => c.level))].sort((a, b) => a - b);
  }

  chartsAt(type: ChartType, level: number): Chart[] {
    return this.charts.filter((c) => c.type === type && c.level === level);
  }
}
