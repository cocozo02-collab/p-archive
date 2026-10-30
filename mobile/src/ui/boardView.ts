// 기록표 화면 조각(격자 타일, 목록 행, 등급 구역). 색은 docs/UI-SPEC.md, 배치는 목업 1~3번 화면.

import { type Group, hasRecord, type Lang, type Tile, tileName } from "../board";

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function gradeClass(grade: string | null): string {
  if (!grade) return "";
  if (grade.startsWith("SSS")) return "g-sss";
  if (grade.startsWith("SS")) return "g-ss";
  if (grade.startsWith("S")) return "g-s";
  if (grade.startsWith("AAA")) return "g-aaa";
  return "g-low";
}

export function plateClass(plate: string): string {
  return ({ PG: "p-top", UG: "p-top", EG: "p-high", SG: "p-high", MG: "p-mid", TG: "p-mid" } as Record<string, string>)[plate] ?? "p-low";
}

// 자켓이 없을 때(아직 안 받았거나 URL을 모르는 곡) 곡마다 정해진 색 + 첫 글자.
const PLACEHOLDER = ["#5B3A8C", "#1F6F8B", "#8B3A3A", "#2E7D5B", "#A0612B", "#3B4B9E", "#7A2E6E", "#4E6B2A", "#9C3F5F", "#2B5F7A", "#6E4A2B", "#3E3E7A"];

function placeholderColor(key: string): string {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PLACEHOLDER[h % PLACEHOLDER.length];
}

export function jacketHtml(t: Tile, lang: Lang): string {
  const initial = esc([...tileName(t, lang)][0] ?? "?");
  const img = t.jacket ? `<img src="${esc(t.jacket)}" alt="" loading="lazy" onerror="this.remove()" />` : "";
  return `<span class="ph" style="background:${placeholderColor(t.key)}" aria-hidden="true">${initial}</span>${img}`;
}

const fmtScore = (n: number | null) => (n == null ? "" : n.toLocaleString("en-US"));
const fmtDate = (iso: string | null) => (iso ? iso.slice(5, 10).replace("-", "/") : "");

/** 격자 타일. scoreBand=true(등급순 보기)면 아래 띠에 등급 대신 점수를 보여준다. */
export function tileHtml(t: Tile, o: { lang: Lang; showName: boolean; scoreBand: boolean }): string {
  const r = t.record;
  const has = hasRecord(t);
  let band = "";
  let badge = "";
  if (r?.status === "pass") {
    band = o.scoreBand
      ? `<span class="band score-band">${fmtScore(r.score)}</span>`
      : `<span class="band ${gradeClass(r.grade)}">${esc(r.grade ?? "")}</span>`;
    if (r.plate) badge = `<span class="badge ${plateClass(r.plate)}">${r.plate}</span>`;
  } else if (r?.status === "broken") {
    band = o.scoreBand ? `<span class="band score-band">${fmtScore(r.score)}</span>` : `<span class="band g-fail">F</span>`;
    badge = `<span class="badge b-break">BREAK</span>`;
  }
  const up = t.improved && has ? `<span class="up" aria-label="이번 갱신에서 오름">▲</span>` : "";
  const name = o.showName ? `<span class="name">${esc(tileName(t, o.lang))}</span>` : "";
  const score = o.scoreBand ? "" : `<span class="score${has ? "" : " none"}">${has ? fmtScore(r!.score) : "기록 없음"}</span>`;
  return `<li><button type="button" class="tile${has ? "" : " empty"}${t.improved && has ? " improved" : ""}" data-key="${esc(t.key)}">
    <span class="jacket">${jacketHtml(t, o.lang)}${up}${badge}${band}</span>${name}${score}</button></li>`;
}

/** 목록 행: 자켓(44px), 곡명, 채보·날짜, 등급, 점수, 플레이트. */
export function rowHtml(t: Tile, o: { lang: Lang; chart: string }): string {
  const r = t.record;
  const has = hasRecord(t);
  const grade = r?.status === "broken" ? `<span class="g g-fail">F</span>`
    : r?.status === "pass" ? `<span class="g ${gradeClass(r.grade)}">${esc(r.grade ?? "")}</span>` : "";
  const plate = r?.status === "broken" ? `<span class="pl b-break">BREAK</span>`
    : r?.status === "pass" && r.plate ? `<span class="pl ${plateClass(r.plate)}">${r.plate}</span>` : `<span class="pl"></span>`;
  const date = has && r!.played_at ? ` · ${fmtDate(r!.played_at)}` : "";
  return `<li><button type="button" class="row-item${has ? "" : " empty"}${t.improved && has ? " improved" : ""}" data-key="${esc(t.key)}">
    <span class="jacket sm">${jacketHtml(t, o.lang)}</span>
    <span class="meta"><span class="nm">${esc(tileName(t, o.lang))}</span><span class="sb">${o.chart}${date}</span></span>
    <span class="gs">${grade}<span class="sc">${has ? fmtScore(r!.score) : "기록 없음"}</span></span>${plate}</button></li>`;
}

export function groupHtml(g: Group, o: { lang: Lang; showName: boolean }): string {
  return `<section class="group">
    <div class="group-head" style="border-left-color:${g.color}">
      <span class="gl" style="color:${g.color}">${esc(g.label)}</span><span class="gc">${g.tiles.length}채보</span><span class="gsub">${esc(g.sub)}</span>
    </div>
    <ul class="grid">${g.tiles.map((t) => tileHtml(t, { ...o, scoreBand: true })).join("")}</ul>
  </section>`;
}
