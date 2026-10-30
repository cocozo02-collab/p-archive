import { describe, expect, it } from "vitest";
import { isLoggedIn, parseBestScores, parseGameCards, parseRecentPlays } from "../src/piu/parser";
import { card, page } from "./fixtures";

const H1 = "a".repeat(32), H2 = "b".repeat(32), H3 = "c".repeat(32);

describe("parseBestScores", () => {
  const r = parseBestScores(page([
    card({ name: "굿 나이트", hash: H1, kind: "s", level: 20, score: "940,474", grade: "aa_p", plate: "rg" }),
    card({ name: "이렐리아", hash: H2, kind: "s", level: 22, score: "123,456" }), // 스테이지 브레이크: 빈 등급 이미지
    card({ name: "크로스 소울", hash: H3, kind: "d", level: 17, score: "750,105", grade: "x_b" }), // 실패
  ], 4, 37));

  it("페이지 정보", () => {
    expect([r.maxPage, r.totalCharts, r.errors]).toEqual([4, 37, []]);
  });
  it("클리어", () => {
    expect(r.scores[0]).toMatchObject({
      songName: "굿 나이트", chartType: "Single", level: 20, score: 940474, grade: "AA+", plate: "RG",
      status: "pass", playedAt: "2026-08-27T17:09:00+09:00", jacketHash: H1,
    });
  });
  it("스테이지 브레이크는 점수가 없다", () => {
    expect(r.scores[1]).toMatchObject({ status: "stage_break", score: null, grade: null });
  });
  it("실패는 실제 등급을 남긴다", () => {
    expect(r.scores[2]).toMatchObject({ chartType: "Double", status: "broken", score: 750105, grade: "B", plate: null });
  });
});

describe("parseRecentPlays", () => {
  it("판정 수", () => {
    const { plays, errors } = parseRecentPlays(page([
      card({ name: "풀 문", hash: H1, kind: "s", level: 16, score: "964,482", grade: "aaa_p", plate: "mg", judgements: [1080, 41, 17, 7, 3] }),
    ]));
    expect(errors).toEqual([]);
    expect(plays[0]).toMatchObject({ perfect: 1080, great: 41, good: 17, bad: 7, miss: 3, plate: "MG" });
  });
});

describe("isLoggedIn", () => {
  it(".login_wrap은 로그인 상태에서도 헤더에 있다 — 로그아웃 링크로 판정", () => {
    expect(isLoggedIn('<div class="login_wrap"><a href="https://piugame.com/bbs/logout.php">Log Out</a></div>')).toBe(true);
    expect(isLoggedIn('<div class="login_wrap"><form><input name="mb_password"></form></div>')).toBe(false);
  });
});

describe("parseGameCards", () => {
  it("메인 카드", () => {
    const html = `<div class="subProfile_wrap"><div class="name_w"><p class="t2 en">PLAYER #0000</p></div></div>
      <div id="profile_modal"><div class="in_profile"><input type="radio" name="sub_profile" value="10001">
      <div class="name_w"><p class="t2 en">PLAYER #0000</p></div></div></div>`;
    expect(parseGameCards(html)).toEqual([{ gameTag: "PLAYER #0000", subProfileId: "10001", isMain: true }]);
  });
});
