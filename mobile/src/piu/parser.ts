// piugame.com my_page HTML 파서. Python 버전(app/piugame/parser.py)과 같은 선택자·규칙을 쓴다.
// 근거: PIU Scores PiuGameApi.cs와 실제 응답 HTML(2026-10-30).

const LEVEL_DIGIT_RE = /\/stepball\/full\/[a-z]+_num_(\d)\.png/i;
const TYPE_RE = /\/stepball\/full\/([a-z]+)_text\.png/i;
const GRADE_RE = /\/grade\/([a-z_]+)\.png/i;
const PLATE_RE = /\/plate\/(?:s_)?([a-z]+)\.png/i;
const JACKET_RE = /url\(['"]?([^'")]*\/data\/song_img2?\/[^'")]+)['"]?\)/;
const JACKET_HASH_RE = /\/data\/song_img2?\/([0-9a-f]{32})\./i;
const PLAYED_AT_RE = /(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\s*\(GMT([+-])(\d{1,2})\)/;
const PAGE_RE = /page=(\d+)/;
const NUMBER_RE = /\d[\d,]*/;

export type ChartType = "Single" | "Double" | "CoOp";
export type Status = "pass" | "broken" | "stage_break";

const CHART_TYPES: Record<string, ChartType> = { s: "Single", d: "Double", c: "CoOp" };
const GRADES: Record<string, string> = {
  f: "F", d: "D", c: "C", b: "B", a: "A", a_p: "A+",
  aa: "AA", aa_p: "AA+", aaa: "AAA", aaa_p: "AAA+",
  s: "S", s_p: "S+", ss: "SS", ss_p: "SS+", sss: "SSS", sss_p: "SSS+",
};
const PLATES = new Set(["pg", "ug", "eg", "sg", "mg", "tg", "fg", "rg"]);
// 1948 D29는 숫자 이미지 없이 "??" 스텝볼로 나온다. PIU Scores는 29로 본다.
const UNREADABLE_LEVEL = 29;

export interface ChartScore {
  songName: string;
  chartType: ChartType;
  level: number;
  score: number | null; // 스테이지 브레이크면 null
  grade: string | null;
  plate: string | null;
  status: Status;
  playedAt: string | null; // ISO 8601 (+09:00)
  jacketUrl: string | null;
  jacketHash: string | null;
}

export interface RecentPlay extends ChartScore {
  perfect: number;
  great: number;
  good: number;
  bad: number;
  miss: number;
}

export interface BestScorePage {
  scores: ChartScore[];
  maxPage: number;
  totalCharts: number | null;
  errors: string[];
}

export interface GameCard {
  gameTag: string;
  subProfileId: string;
  isMain: boolean;
}

class ParseError extends Error {}

function doc(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

export function jacketHash(url: string | null | undefined): string | null {
  const m = JACKET_HASH_RE.exec(url ?? "");
  return m ? m[1].toLowerCase() : null;
}

/** 공통 헤더에 로그아웃 링크가 있으면 로그인된 페이지. .login_wrap은 모든 페이지 헤더에 있어서 판정에 못 쓴다. */
export function isLoggedIn(html: string): boolean {
  return doc(html).querySelector('a[href*="bbs/logout.php"]') !== null;
}

function src(el: Element | null | undefined): string {
  return el?.getAttribute("src") ?? "";
}

function isUcs(card: Element): boolean {
  return src(card.querySelector(".stepBall_img_wrap .tw img")).toLowerCase().includes("u_text");
}

function chartType(card: Element): ChartType | null {
  const m = TYPE_RE.exec(src(card.querySelector(".stepBall_img_wrap .tw img")));
  return m ? CHART_TYPES[m[1].toLowerCase()] ?? null : null;
}

function level(card: Element): number {
  let digits = "";
  for (const img of card.querySelectorAll(".stepBall_img_wrap .numw img")) {
    const m = LEVEL_DIGIT_RE.exec(src(img));
    if (m) digits += m[1];
  }
  return digits ? parseInt(digits, 10) : UNREADABLE_LEVEL;
}

function playedAt(card: Element): string | null {
  const m = PLAYED_AT_RE.exec(card.querySelector("p.recently_date_tt")?.textContent ?? "");
  if (!m) return null;
  return `${m[1]}T${m[2]}${m[3]}${m[4].padStart(2, "0")}:00`;
}

function jacketUrl(card: Element, selector: string): string | null {
  const m = JACKET_RE.exec(card.querySelector(selector)?.getAttribute("style") ?? "");
  return m ? m[1] : null;
}

function parseCard(card: Element): ChartScore {
  const song = card.querySelector(".song_name p");
  const type = chartType(card);
  if (!song || !type) throw new ParseError("곡명이나 채보 타입을 찾지 못함");

  const scoreCell = card.querySelector("div.li_in.ac");
  const scoreText = scoreCell?.querySelector("i.tx")?.textContent?.trim() ?? "";
  const gradeImg = scoreCell?.querySelector(":scope > img") ?? null;
  const gradeSrc = src(gradeImg);

  let plate: string | null = null;
  for (const img of card.querySelectorAll("div.li_in > img")) {
    const m = PLATE_RE.exec(src(img));
    if (m && PLATES.has(m[1].toLowerCase())) {
      plate = m[1].toUpperCase();
      break;
    }
  }

  // 플레이트가 없으면 브레이크오프. 그중 등급 이미지가 비었거나 STAGE BREAK면 스테이지 브레이크.
  const isBroken = plate === null;
  const isStageBreak = isBroken && (scoreText === "STAGE BREAK" || (gradeImg !== null && !gradeSrc.trim()));

  let grade: string | null = null;
  const gm = GRADE_RE.exec(gradeSrc);
  if (gm && !isStageBreak) {
    const stem = gm[1].toLowerCase();
    // 클리어 실패한 플레이는 같은 등급 이미지에 x_ 접두사가 붙는다.
    grade = GRADES[stem.startsWith("x_") ? stem.slice(2) : stem] ?? null;
  }

  let score: number | null = null;
  if (!isStageBreak) {
    score = parseInt(scoreText.replace(/,/g, ""), 10);
    if (Number.isNaN(score)) throw new ParseError(`점수를 읽지 못함: ${scoreText}`);
  }

  const url = jacketUrl(card, "div.in.bgfix");
  return {
    songName: song.textContent?.trim() ?? "",
    chartType: type,
    level: level(card),
    score,
    grade,
    plate,
    status: isStageBreak ? "stage_break" : isBroken ? "broken" : "pass",
    playedAt: playedAt(card),
    jacketUrl: url,
    jacketHash: jacketHash(url),
  };
}

function maxPage(d: Document, current: number): number {
  const m = PAGE_RE.exec(d.querySelector("i.last")?.parentElement?.getAttribute("onclick") ?? "");
  return m ? parseInt(m[1], 10) : current;
}

function totalCharts(d: Document): number | null {
  const m = NUMBER_RE.exec(d.querySelector(".total_wrap")?.textContent ?? "");
  return m ? parseInt(m[0].replace(/,/g, ""), 10) : null;
}

function errorText(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

/** my_page/my_best_score.php (Phoenix 2 개편 레이아웃). */
export function parseBestScores(html: string, page = 1): BestScorePage {
  const d = doc(html);
  if (d.querySelector("ul.my_best_scoreList")) {
    throw new ParseError("예전 레이아웃(my_best_scoreList)이다. Phoenix 2 개편 레이아웃이 아님");
  }
  const result: BestScorePage = { scores: [], maxPage: maxPage(d, page), totalCharts: totalCharts(d), errors: [] };
  for (const card of d.querySelectorAll("ul.recently_playeList > li")) {
    if (isUcs(card)) continue;
    try {
      result.scores.push(parseCard(card));
    } catch (e) {
      result.errors.push(errorText(e));
    }
  }
  return result;
}

function judgement(card: Element, name: string): number {
  const text = card.querySelector(`td[data-th="${name}"] div`)?.textContent;
  if (text == null) throw new ParseError(`${name} 판정 칸을 찾지 못함`);
  return parseInt(text.trim().replace(/,/g, ""), 10);
}

/** my_page/recently_played.php. 최근 약 50플레이와 판정 수. */
export function parseRecentPlays(html: string): { plays: RecentPlay[]; errors: string[] } {
  const plays: RecentPlay[] = [];
  const errors: string[] = [];
  for (const card of doc(html).querySelectorAll("ul.recently_playeList > li")) {
    if (isUcs(card)) continue;
    try {
      plays.push({
        ...parseCard(card),
        perfect: judgement(card, "PERFECT"),
        great: judgement(card, "GREAT"),
        good: judgement(card, "GOOD"),
        bad: judgement(card, "BAD"),
        miss: judgement(card, "MISS"),
      });
    } catch (e) {
      errors.push(errorText(e));
    }
  }
  return { plays, errors };
}

/** my_page/pumbility.php의 공식 PUMBILITY 합계. 값은 `8,127<span class="pumbility-point-sub">.66</span>` 형태. */
export function parsePumbility(html: string): number | null {
  const text = doc(html).querySelector(".pumbility_total_wrap .score")?.textContent ?? "";
  const m = /(\d[\d,]*)(\.\d+)?/.exec(text.replace(/\s+/g, ""));
  return m ? parseFloat(m[1].replace(/,/g, "") + (m[2] ?? "")) : null;
}

/** my_page/game_id_information.php. 계정에 딸린 게임카드. */
export function parseGameCards(html: string): GameCard[] {
  const d = doc(html);
  const mainTag = d.querySelector(".subProfile_wrap .name_w p.t2")?.textContent?.trim() ?? "";
  const cards: GameCard[] = [];
  for (const box of d.querySelectorAll("#profile_modal .in_profile")) {
    const tag = box.querySelector(".name_w p.t2")?.textContent?.trim();
    const id = box.querySelector('input[name="sub_profile"]')?.getAttribute("value");
    if (tag && id) cards.push({ gameTag: tag, subProfileId: id, isMain: tag === mainTag });
  }
  return cards;
}
