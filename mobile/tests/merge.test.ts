import { describe, expect, it } from "vitest";
import { bestPlayToPatch, gradeBand, isBetter, recordChange, solveMaxCombo } from "../src/merge";

describe("recordChange", () => {
  const rec = (status: "pass" | "broken" | "stage_break", score: number | null, grade: string | null, plate: string | null) =>
    ({ status, score, grade, plate });

  it("같으면 null", () => {
    expect(recordChange(rec("pass", 990000, "SSS", "SG"), rec("pass", 990000, "SSS", "SG"))).toBeNull();
  });
  it("처음 생긴 클리어", () => {
    expect(recordChange(null, rec("pass", 950000, "AAA", "MG"))).toEqual(["first_clear"]);
  });
  it("실패 → 클리어", () => {
    expect(recordChange(rec("broken", 750105, "B", null), rec("pass", 940000, "AA+", "RG"))).toEqual(["first_clear", "score_up"]);
  });
  it("등급·플레이트·점수 상승", () => {
    expect(recordChange(rec("pass", 975000, "S+", "MG"), rec("pass", 990000, "SSS", "SG")))
      .toEqual(["grade_up", "plate_up", "score_up"]);
  });
  it("플레이트만 상승(점수는 그대로)", () => {
    expect(recordChange(rec("pass", 990000, "SSS", "MG"), rec("pass", 990000, "SSS", "SG"))).toEqual(["plate_up"]);
  });
  it("스테이지 브레이크만 생긴 건 기록이 아니다", () => {
    expect(recordChange(null, rec("stage_break", null, null, null))).toBeNull();
  });
});

describe("solveMaxCombo", () => {
  it("DUEL D18 999,582 (P952 Gr1)", () => {
    expect(solveMaxCombo(999582, { perfect: 952, great: 1, good: 0, bad: 0, miss: 0 })).toBe(953);
  });
  it("미스가 섞인 플레이: 공식을 만족하는 콤보를 찾는다", () => {
    const j = { perfect: 1080, great: 41, good: 17, bad: 7, miss: 29 };
    const total = 1174;
    const weighted = 0.995 * (1080 + 0.6 * 41 + 0.2 * 17 + 0.1 * 7);
    const score = Math.floor(((weighted + 0.005 * 400) / total) * 1_000_000);
    expect(solveMaxCombo(score, j)).toBe(400);
  });
  it("공식에 맞지 않으면 null", () => {
    expect(solveMaxCombo(1, { perfect: 100, great: 0, good: 0, bad: 0, miss: 0 })).toBeNull();
  });
});

describe("isBetter", () => {
  it("클리어 > 실패 > 스테이지 브레이크, 같은 단계는 점수", () => {
    expect(isBetter({ status: "broken", score: 1 }, { status: "stage_break", score: null })).toBe(true);
    expect(isBetter({ status: "pass", score: 800000 }, { status: "broken", score: 990000 })).toBe(true);
    expect(isBetter({ status: "pass", score: 950000 }, { status: "pass", score: 940000 })).toBe(true);
    expect(isBetter({ status: "pass", score: 940000 }, { status: "pass", score: 940000 })).toBe(false);
  });
});

describe("bestPlayToPatch", () => {
  it("스테이지 브레이크 기록은 끝까지 친 실패 플레이로 보완", () => {
    const play = { status: "broken" as const, score: 750105 };
    expect(bestPlayToPatch({ status: "stage_break", score: null }, [{ status: "stage_break", score: null }, play])).toBe(play);
  });
  it("클리어 기록은 덮어쓰지 않는다", () => {
    expect(bestPlayToPatch({ status: "pass", score: 990000 }, [{ status: "pass", score: 995000 }])).toBeNull();
  });
});

describe("gradeBand", () => {
  it("등급대", () => {
    expect(["SSS+", "SS", "S+", "AAA", "A", null].map(gradeBand)).toEqual(["SSS", "SS", "S", "AAA-", "AAA-", null]);
  });
});
