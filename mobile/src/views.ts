// 곡 상세·최근 플레이·갱신 결과·통계 화면에 넣을 데이터 가공(순수 함수, 테스트 대상).

import { hasRecord, type Tile } from "./board";
import type { HistoryRow, PlayRow, RecordChange } from "./db";
import { gradeBand, PLATES } from "./merge";

export const fmtScore = (n: number | null | undefined) => (n == null ? "-" : n.toLocaleString("en-US"));
export const fmtDate = (iso: string | null | undefined) => (iso ? iso.slice(5, 10).replace("-", "/") : "");
export const fmtTime = (iso: string | null | undefined) => (iso ? iso.slice(11, 16) : "");
export const fmtDelta = (d: number) => (d > 0 ? `+${d.toLocaleString("en-US")}` : d < 0 ? d.toLocaleString("en-US") : "±0");

export const judgeText = (p: { perfect: number; great: number; good: number; bad: number; miss: number }) =>
  `P ${p.perfect} · Gr ${p.great} · Go ${p.good} · B ${p.bad} · M ${p.miss}`;

/** 로컬 시각 기준 날짜(YYYY-MM-DD). DB의 ISO 시각에는 시간대가 붙어 있다. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10)
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface HistoryItem {
  date: string;
  grade: string | null;
  status: string;
  score: number | null;
  plate: string | null;
  delta: string; // "+6,122" / "첫 클리어" / "첫 기록" / "기존 기록" / "플레이트 UP"
  deltaKind: "up" | "first" | "base" | "same";
}

/** 기록 이력 목록(최신부터). 스테이지 브레이크는 뺀다. */
export function historyItems(rows: HistoryRow[]): HistoryItem[] {
  return rows.filter((r) => r.new_status !== "stage_break").map((r): HistoryItem => {
    const base = { date: fmtDate(r.changed_at), grade: r.new_status === "broken" ? "F" : r.new_grade,
                   status: r.new_status, score: r.new_score, plate: r.new_status === "broken" ? "BREAK" : r.new_plate };
    if (r.kind === "baseline") return { ...base, delta: "기존 기록", deltaKind: "base" };
    if (!r.old_status || r.old_status === "stage_break") {
      return { ...base, delta: r.new_status === "pass" ? "첫 클리어" : "첫 기록", deltaKind: "first" };
    }
    if (r.old_status !== "pass" && r.new_status === "pass") return { ...base, delta: "첫 클리어", deltaKind: "first" };
    const d = (r.new_score ?? 0) - (r.old_score ?? 0);
    if (d === 0) return { ...base, delta: r.old_plate !== r.new_plate ? "플레이트 UP" : "±0", deltaKind: "same" };
    return { ...base, delta: fmtDelta(d), deltaKind: "up" };
  }).reverse();
}

/** 최고 기록의 판정 수: 같은 점수·상태의 플레이(최고 기록을 세운 플레이 우선). */
export function bestPlay(plays: PlayRow[], record: { score: number | null; status: string } | null): PlayRow | null {
  if (!record || record.score == null) return null;
  const same = plays.filter((p) => p.score === record.score && p.status === record.status);
  return same.find((p) => p.set_best) ?? same[0] ?? null;
}

export interface Day {
  day: string;
  label: string; // "10/30 (목)"
  plays: PlayRow[];
  best: number;
}

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

/** 최근 플레이를 날짜별로 묶는다(최신 날짜부터). */
export function groupByDay(plays: PlayRow[]): Day[] {
  const days = new Map<string, PlayRow[]>();
  for (const p of plays) {
    const d = localDay(p.played_at);
    days.set(d, [...(days.get(d) ?? []), p]);
  }
  return [...days.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([day, ps]) => {
    const dt = new Date(`${day}T12:00:00`);
    return { day, label: `${day.slice(5).replace("-", "/")} (${WEEK[dt.getDay()]})`, plays: ps, best: ps.filter((p) => p.set_best).length };
  });
}

export interface ChangeItem {
  tag: string | null; // 등급 UP / 플레이트 UP / 첫 클리어
  before: string;
  delta: string;
}

/** 갱신 결과의 "달라진 기록" 한 줄. */
export function changeItem(c: RecordChange): ChangeItem {
  const tag = c.tags.includes("first_clear") ? "첫 클리어" : c.tags.includes("grade_up") ? "등급 UP"
    : c.tags.includes("plate_up") ? "플레이트 UP" : null;
  const o = c.old;
  const before = !o || o.status === "stage_break" ? "기록 없음"
    : o.status === "broken" ? `실패 ${fmtScore(o.score)}`
    : `${o.grade ?? ""} ${fmtScore(o.score)}${c.tags.includes("plate_up") && o.plate ? ` ${o.plate}` : ""}`;
  const delta = !o || o.status === "stage_break" || o.score == null ? "NEW" : fmtDelta((c.new.score ?? 0) - o.score);
  return { tag, before, delta };
}

export interface LevelStat {
  level: number;
  clear: number;
  total: number;
  bands: Record<"SSS" | "SS" | "S" | "A-", number>;
  plates: string; // "UG 1 · MG 4 · TG 1"
}

/** 통계 화면의 레벨별 카드. */
export function levelStat(level: number, tiles: Tile[]): LevelStat {
  const bands = { SSS: 0, SS: 0, S: 0, "A-": 0 };
  const plates = new Map<string, number>();
  let clear = 0;
  for (const t of tiles) {
    if (!hasRecord(t) || t.record!.status !== "pass") continue;
    clear++;
    const b = gradeBand(t.record!.grade);
    if (b) bands[b]++;
    if (t.record!.plate) plates.set(t.record!.plate, (plates.get(t.record!.plate) ?? 0) + 1);
  }
  // 많은 순으로 3개를 고른 뒤 플레이트 순서(PG→RG)로 보여준다.
  const top = [...plates.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .sort((a, b) => PLATES.indexOf(a[0] as never) - PLATES.indexOf(b[0] as never));
  return { level, clear, total: tiles.length, bands, plates: top.length ? top.map(([p, n]) => `${p} ${n}`).join(" · ") : "-" };
}
