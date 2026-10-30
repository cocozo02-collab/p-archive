import { describe, expect, it } from "vitest";
import { groupByGrade, sortTiles, summarize, type Tile, tileName } from "../src/board";
import type { RecordRow } from "../src/db";

function tile(key: string, nameKo: string | null, nameEn: string, rec?: Partial<RecordRow>): Tile {
  return {
    key, songKey: key, hashes: [key], nameKo, nameEn, jk: key, jsrc: null, jacket: null, improved: false, inCatalog: true,
    record: rec ? { piugame_hash: key, chart_type: "Single", level: 21, score: null, grade: null, plate: null,
                    status: "pass", played_at: null, ...rec } : null,
  };
}

const tiles = [
  tile("a", "가나다", "Alpha", { score: 998120, grade: "SSS+", plate: "UG" }),
  tile("b", "라마바", "Bravo", { score: 991002, grade: "SSS", plate: "SG" }),
  tile("c", null, "Charlie", { score: 976400, grade: "S+", plate: "MG" }),
  tile("d", "사아자", "Delta", { score: 958300, grade: "AAA", plate: "FG" }),
  tile("e", "차카타", "Echo", { score: 812440, grade: "B", status: "broken" }),
  tile("f", "파하", "Foxtrot", { score: null, status: "stage_break" }),
  tile("g", "갸", "Golf"),
];

describe("summarize", () => {
  it("클리어·등급대·플레이트(0개도 칸 유지)", () => {
    const s = summarize(tiles);
    expect([s.clear, s.total]).toEqual([4, 7]);
    expect(s.bands).toEqual({ SSS: 2, SS: 0, S: 1, "A-": 1 });
    expect(s.plates).toEqual({ PG: 0, UG: 1, EG: 0, SG: 1, MG: 1, TG: 0, FG: 1, RG: 0 });
  });
});

describe("tileName", () => {
  it("한글이 없는 곡은 영문", () => {
    expect(tileName(tiles[2], "ko")).toBe("Charlie");
    expect(tileName(tiles[0], "en")).toBe("Alpha");
  });
});

describe("sortTiles", () => {
  it("점수순: 기록 없음(스테이지 브레이크 포함)은 맨 뒤", () => {
    expect(sortTiles(tiles, "score", "ko").map((t) => t.key)).toEqual(["a", "b", "c", "d", "e", "g", "f"]);
  });
  it("이름순: 표시 중인 곡명 기준", () => {
    expect(sortTiles(tiles, "name", "en").map((t) => t.key)).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
  });
});

describe("groupByGrade", () => {
  it("구역, 빈 구역 제외, 평균/최고", () => {
    const g = groupByGrade(tiles, "ko");
    expect(g.map((x) => [x.label, x.tiles.map((t) => t.key)])).toEqual([
      ["SSS+", ["a"]], ["SSS", ["b"]], ["S+ · S", ["c"]], ["AAA 이하", ["d"]], ["실패", ["e"]], ["기록 없음", ["g", "f"]],
    ]);
    expect(g[0].sub).toBe("평균 998,120");
    expect(g[4].sub).toBe("최고 812,440");
    expect(g[5].sub).toBe("");
  });
});
