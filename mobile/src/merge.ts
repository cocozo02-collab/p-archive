// 기록 비교·병합 규칙. Python 버전(app/store/records.py)과 같다.

import type { Status } from "./piu/parser";

export interface Comparable {
  status: Status;
  score: number | null;
}

const STATUS_RANK: Record<Status, number> = { pass: 2, broken: 1, stage_break: 0 };

/** a가 b보다 나은 기록인가. 클리어 > 실패 > 스테이지 브레이크, 같은 단계면 점수가 높은 쪽. */
export function isBetter(a: Comparable, b: Comparable | null | undefined): boolean {
  if (!b) return true;
  const ra = STATUS_RANK[a.status];
  const rb = STATUS_RANK[b.status];
  if (ra !== rb) return ra > rb;
  return (a.score ?? -1) > (b.score ?? -1);
}

/**
 * 최고 기록 목록의 기록을 최근 플레이로 보완할지. 클리어가 아닌 기록만 보완한다.
 * (사이트는 최고 점수와 최고 플레이트를 서로 다른 플레이에서 골라 합쳐 보여주므로, 클리어 기록을 덮어쓰면 그 값이 깨진다.)
 */
export function bestPlayToPatch<T extends Comparable>(record: Comparable, plays: T[]): T | null {
  if (record.status === "pass") return null;
  let best: T | null = null;
  for (const p of plays) if (p.status !== "stage_break" && isBetter(p, best)) best = p;
  return best && isBetter(best, record) ? best : null;
}

export interface RecordValue extends Comparable {
  grade: string | null;
  plate: string | null;
}

export type ChangeTag = "first_clear" | "grade_up" | "plate_up" | "score_up";

const GRADE_ORDER = ["F", "D", "C", "B", "A", "A+", "AA", "AA+", "AAA", "AAA+", "S", "S+", "SS", "SS+", "SSS", "SSS+"];
const PLATE_ORDER = ["RG", "FG", "TG", "MG", "SG", "EG", "UG", "PG"];
const rank = (order: string[], v: string | null) => (v ? order.indexOf(v) : -1);

/**
 * 최고 기록이 바뀌었는지와 그 태그. 점수·등급·플레이트·상태 중 하나라도 다르면 바뀐 것으로 본다.
 * 스테이지 브레이크만 생긴 경우는 기록이 아니므로 null.
 */
export function recordChange(oldRec: RecordValue | null, newRec: RecordValue): ChangeTag[] | null {
  if (newRec.status === "stage_break") return null;
  if (oldRec && oldRec.status === newRec.status && oldRec.score === newRec.score &&
      oldRec.grade === newRec.grade && oldRec.plate === newRec.plate) return null;
  const tags: ChangeTag[] = [];
  const wasClear = oldRec?.status === "pass";
  if (newRec.status === "pass" && !wasClear) tags.push("first_clear");
  if (wasClear && rank(GRADE_ORDER, newRec.grade) > rank(GRADE_ORDER, oldRec!.grade)) tags.push("grade_up");
  if (wasClear && rank(PLATE_ORDER, newRec.plate) > rank(PLATE_ORDER, oldRec!.plate)) tags.push("plate_up");
  if (oldRec && (newRec.score ?? -1) > (oldRec.score ?? -1)) tags.push("score_up");
  return tags;
}

/**
 * 맥스 콤보 역산. piugame은 맥스 콤보를 보여주지 않지만 Phoenix 점수 공식으로 구할 수 있다:
 * score = floor((0.995 × (P + 0.6·Gr + 0.2·Go + 0.1·B) + 0.005 × maxCombo) / 노트 수 × 1,000,000)
 * 공식을 정확히 만족하는 값이 없으면 null.
 */
export function solveMaxCombo(score: number, j: { perfect: number; great: number; good: number; bad: number; miss: number }): number | null {
  const total = j.perfect + j.great + j.good + j.bad + j.miss;
  if (total <= 0) return null;
  const weighted = 0.995 * (j.perfect + 0.6 * j.great + 0.2 * j.good + 0.1 * j.bad);
  const calc = (mc: number) => Math.floor(((weighted + 0.005 * mc) / total) * 1_000_000 + 1e-9);
  const guess = Math.ceil(((score * total) / 1_000_000 - weighted) / 0.005 - 1e-6);
  for (const mc of [guess, guess - 1, guess + 1]) {
    if (mc >= 0 && mc <= total && calc(mc) === score) return mc;
  }
  return null;
}

/** 등급, 높은 것부터 (SSS+ … F). */
export const GRADES = [...GRADE_ORDER].reverse();

/** 플레이트, 높은 것부터 (PG … RG). */
export const PLATES = ["PG", "UG", "EG", "SG", "MG", "TG", "FG", "RG"] as const;

export const gradeRank = (g: string | null) => rank(GRADE_ORDER, g);
export const plateRank = (p: string | null) => rank(PLATE_ORDER, p);

/** UI-SPEC 색: SSS+·SSS / SS+·SS / S+·S / AAA+·AAA / 그 이하. */
export function gradeColor(grade: string): string {
  if (grade.startsWith("SSS")) return "#F5C542";
  if (grade.startsWith("SS")) return "#E6D29A";
  if (grade.startsWith("S")) return "#9FD5FF";
  if (grade.startsWith("AAA")) return "#8BE3A8";
  return "#C9CDD4";
}

export function plateColor(plate: string): string {
  return ({ PG: "#F5C542", UG: "#F5C542", EG: "#9FD5FF", SG: "#9FD5FF", MG: "#8BE3A8", TG: "#8BE3A8" } as Record<string, string>)[plate] ?? "#C9CDD4";
}
