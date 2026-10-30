import { describe, expect, it } from "vitest";
import { bestPlayToPatch, gradeBand, isBetter } from "../src/merge";

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
