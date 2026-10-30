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

export type GradeBand = "SSS" | "SS" | "S" | "AAA-";

export function gradeBand(grade: string | null): GradeBand | null {
  if (!grade) return null;
  if (grade.startsWith("SSS")) return "SSS";
  if (grade.startsWith("SS")) return "SS";
  if (grade.startsWith("S")) return "S";
  return "AAA-";
}
