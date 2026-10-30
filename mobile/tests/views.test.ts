import { describe, expect, it } from "vitest";
import { lineChart, scoreRange } from "../src/charts";
import type { HistoryRow, PlayRow } from "../src/db";
import { catalogStamp, compareVersions, pickUpdates } from "../src/update";
import { bestPlay, changeItem, groupByDay, historyItems, levelStat } from "../src/views";

function hist(o: Partial<HistoryRow>): HistoryRow {
  return { id: 1, piugame_hash: "h", old_score: null, old_grade: null, old_plate: null, old_status: null, new_score: null,
           new_grade: null, new_plate: null, new_status: "pass", tags: "[]", kind: "change", changed_at: "2026-10-30T07:20:00Z",
           sync_run_id: 1, ...o };
}

function play(o: Partial<PlayRow>): PlayRow {
  return { id: 1, piugame_hash: "h", chart_type: "Single", level: 21, score: 991002, grade: "SSS", plate: "SG", status: "pass",
           played_at: "2026-10-30T15:12:00+09:00", perfect: 812, great: 14, good: 2, bad: 1, miss: 1, set_best: 0, ...o };
}

describe("historyItems", () => {
  it("최신부터, 상승폭·첫 클리어·기존 기록·플레이트 UP", () => {
    const items = historyItems([
      hist({ kind: "baseline", new_score: 950000, new_grade: "AAA", new_plate: "TG", changed_at: "2026-09-01T00:00:00Z" }),
      hist({ old_status: "pass", old_score: 950000, old_grade: "AAA", old_plate: "TG", new_score: 962110, new_grade: "AAA+", new_plate: "TG", changed_at: "2026-09-14T00:00:00Z" }),
      hist({ old_status: "pass", old_score: 962110, old_plate: "TG", new_score: 962110, new_grade: "AAA+", new_plate: "MG", changed_at: "2026-09-20T00:00:00Z" }),
      hist({ new_status: "stage_break", changed_at: "2026-09-21T00:00:00Z" }),
    ]);
    expect(items.map((i) => [i.date, i.delta])).toEqual([["09/20", "플레이트 UP"], ["09/14", "+12,110"], ["09/01", "기존 기록"]]);
  });
  it("처음 생긴 기록: 클리어면 첫 클리어, 실패면 첫 기록", () => {
    expect(historyItems([hist({ new_score: 900000, new_grade: "A+" })])[0].delta).toBe("첫 클리어");
    expect(historyItems([hist({ new_status: "broken", new_score: 700000, new_grade: "B" })])[0]).toMatchObject({ delta: "첫 기록", grade: "F", plate: "BREAK" });
  });
});

describe("bestPlay", () => {
  it("같은 점수 중 최고 기록을 세운 플레이 우선", () => {
    const a = play({ id: 1 });
    const b = play({ id: 2, set_best: 1 });
    expect(bestPlay([a, b], { score: 991002, status: "pass" })).toBe(b);
    expect(bestPlay([a], { score: 1, status: "pass" })).toBeNull();
  });
});

describe("groupByDay", () => {
  it("날짜별 묶음과 기록 상승 수", () => {
    const days = groupByDay([
      play({ played_at: "2026-10-30T15:12:00+09:00", set_best: 1 }),
      play({ played_at: "2026-10-30T15:04:00+09:00" }),
      play({ played_at: "2026-10-19T20:33:00+09:00", set_best: 1 }),
    ]);
    expect(days.map((d) => [d.label, d.plays.length, d.best])).toEqual([["10/30 (금)", 2, 1], ["10/19 (월)", 1, 1]]);
  });
});

describe("changeItem", () => {
  const rec = (status: "pass" | "broken", score: number, grade: string, plate: string | null) => ({ status, score, grade, plate });
  it("등급 UP", () => {
    expect(changeItem({ piugame_hash: "h", chart_type: "Single", level: 21, old: rec("pass", 984880, "SS", "MG"),
                        new: rec("pass", 991002, "SSS", "SG"), tags: ["grade_up", "plate_up", "score_up"] }))
      .toEqual({ tag: "등급 UP", before: "SS 984,880 MG", delta: "+6,122" });
  });
  it("실패 → 첫 클리어 / 처음 생긴 기록", () => {
    expect(changeItem({ piugame_hash: "h", chart_type: "Single", level: 21, old: rec("broken", 801220, "B", null),
                        new: rec("pass", 971880, "S", "TG"), tags: ["first_clear", "score_up"] }))
      .toMatchObject({ tag: "첫 클리어", before: "실패 801,220" });
    expect(changeItem({ piugame_hash: "h", chart_type: "Single", level: 21, old: null,
                        new: rec("pass", 971880, "S", "TG"), tags: ["first_clear"] }).delta).toBe("NEW");
  });
});

describe("levelStat", () => {
  it("클리어·등급대·주요 플레이트", () => {
    const t = (grade: string, plate: string) => ({ key: grade + plate, songKey: null, hashes: [], nameKo: null, nameEn: null, bundled: null, jk: null, jsrc: null,
      jacket: null, improved: false, inCatalog: true,
      record: { piugame_hash: "h", chart_type: "Single", level: 21, score: 1, grade, plate, status: "pass" as const, played_at: null } });
    const empty = { ...t("SSS", "PG"), record: null };
    const s = levelStat(21, [t("SSS+", "UG"), t("SS", "MG"), t("S", "MG"), t("AAA", "TG"), empty]);
    expect(s).toEqual({ level: 21, clear: 4, total: 5, bands: { SSS: 1, SS: 1, S: 1, "A-": 1 }, plates: "UG 1 · MG 2 · TG 1" });
  });
});

describe("charts", () => {
  it("점 여러 개: 꺾은선 + 마지막 점 강조 + 기준선", () => {
    const svg = lineChart([{ label: "9/14", value: 962110 }, { label: "10/30", value: 991002 }],
      { ...scoreRange([962110, 991002]), guides: [{ value: 990000, label: "SSS", color: "#F5C542" }], ariaLabel: "x" });
    expect(svg).toContain("<polyline");
    expect(svg).toContain('r="5"');
    expect(svg).toContain(">SSS<");
  });
  it("점 하나면 선 없이 점만", () => {
    expect(lineChart([{ label: "9/14", value: 1 }], { ariaLabel: "x" })).not.toContain("<polyline");
  });
});

describe("update", () => {
  const rel = (tag: string, asset: string, extra = {}) => ({ tag_name: tag, draft: false, prerelease: false, body: "",
    assets: [{ name: asset, browser_download_url: `https://example/${tag}/${asset}`, size: 100 }], ...extra });

  it("compareVersions", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("v0.6.0", "0.6.0")).toBe(0);
  });
  it("catalogStamp는 UTC", () => {
    expect(catalogStamp("2026-10-30T15:30:12+09:00")).toBe("202610300630");
  });
  it("가장 새 앱·카탈로그만, 드래프트·프리릴리스는 무시", () => {
    const r = pickUpdates([
      rel("v0.6.0", "p-archive.apk"), rel("v0.7.0", "p-archive.apk", { prerelease: true }), rel("v0.5.0", "p-archive.apk"),
      rel("catalog-202610300630", "catalog.json"), rel("catalog-202611010000", "catalog.json"),
    ], "0.5.0", "2026-10-30T06:30:00Z");
    expect(r.app?.version).toBe("0.6.0");
    expect(r.catalog?.tag).toBe("catalog-202611010000");
  });
  it("최신이면 없음", () => {
    expect(pickUpdates([rel("v0.5.0", "p-archive.apk")], "0.5.0", "2026-11-02T00:00:00Z")).toEqual({ app: null, catalog: null });
  });
});
