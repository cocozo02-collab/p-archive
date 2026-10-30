// 앱에 내장한 카탈로그(PC의 scripts/export_catalog.py가 만든 catalog.json + jackets/*.webp).
// 읽기 전용이라 SQLite에 복사하지 않고 메모리에 올려서 쓴다. 카탈로그를 바꾸면 파일만 교체하면 된다.

import type { ChartType } from "./piu/parser";

export interface Song {
  key: string;
  name_en: string;
  name_ko: string | null;
  artist: string | null;
  jacket: string | null;
  jacket_sha256: string[];
}

export interface Chart {
  id: string;
  song: string; // Song.key
  type: ChartType;
  level: number;
}

interface CatalogFile {
  format: number;
  mix: string;
  generated_at: string;
  songs: Song[];
  charts: Chart[];
  piugame_songs: { hash: string; song: string | null; name_ko: string | null }[];
}

export class Catalog {
  readonly mix: string;
  readonly generatedAt: string;
  readonly songs = new Map<string, Song>();
  readonly charts: Chart[];
  /** piugame 자켓 해시 → 곡 키 */
  readonly songByHash = new Map<string, string>();
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
    for (const p of file.piugame_songs) if (p.song) this.songByHash.set(p.hash, p.song);
  }

  static async load(): Promise<Catalog> {
    const res = await fetch("./catalog/catalog.json");
    if (!res.ok) throw new Error("카탈로그를 읽지 못했습니다");
    return new Catalog(await res.json());
  }

  levels(type: ChartType): number[] {
    return [...new Set(this.charts.filter((c) => c.type === type).map((c) => c.level))].sort((a, b) => a - b);
  }

  chartsAt(type: ChartType, level: number): Chart[] {
    return this.charts.filter((c) => c.type === type && c.level === level);
  }

  jacketUrl(song: Song): string | null {
    return song.jacket ? `./catalog/${song.jacket}` : null;
  }
}
