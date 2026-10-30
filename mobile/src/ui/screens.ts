// 곡 상세 · 최근 플레이 · 갱신 결과 · 통계 화면(목업 4~7번). 데이터 가공은 views.ts, 그래프는 charts.ts.

import { type Lang, type SongIndex, type SongView, tileName } from "../board";
import { GRADE_GUIDES, lineChart, scoreRange } from "../charts";
import type { HistoryRow, PlayRow, RecordRow } from "../db";
import { solveMaxCombo } from "../merge";
import type { SyncSummary } from "../sync";
import {
  bestPlay, changeItem, type Day, fmtDate, fmtDelta, fmtScore, fmtTime, historyItems, judgeText, type LevelStat,
} from "../views";
import { esc, gradeClass, jacketBox, plateClass } from "./boardView";

const chartTag = (type: string, level: number) => `${type === "Single" ? "S" : type === "Double" ? "D" : "CO"}${level}`;
const chartClass = (type: string) => (type === "Single" ? "c-single" : type === "Double" ? "c-double" : "");

function gradeSpan(r: { status: string; grade: string | null }, cls = "g"): string {
  if (r.status === "broken") return `<span class="${cls} g-fail">F</span>`;
  return `<span class="${cls} ${gradeClass(r.grade)}">${esc(r.grade ?? "")}</span>`;
}

function plateSpan(r: { status: string; plate: string | null }, cls = "pl"): string {
  if (r.status === "broken") return `<span class="${cls} b-break">BREAK</span>`;
  return r.plate ? `<span class="${cls} ${plateClass(r.plate)}">${r.plate}</span>` : `<span class="${cls}"></span>`;
}

const backButton = (label: string) =>
  `<button type="button" class="back" data-close aria-label="${label}"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.5 4 6.5 10l6 6"/></svg></button>`;

/* ---------- 곡 상세 ---------- */

export function detailHtml(o: {
  view: SongView; lang: Lang; type: string; level: number; record: RecordRow | null; history: HistoryRow[]; plays: PlayRow[];
}): string {
  const { view, record } = o;
  const has = record && record.status !== "stage_break";
  const items = historyItems(o.history);
  const latest = items[0];

  let best = `<p class="muted">아직 기록이 없어요</p>`;
  if (has) {
    const bp = bestPlay(o.plays, record);
    const combo = bp && record.score != null ? solveMaxCombo(record.score, bp) : null;
    const judges = bp
      ? [["PERFECT", bp.perfect, "j-p"], ["GREAT", bp.great, "j-gr"], ["GOOD", bp.good, "j-go"], ["BAD", bp.bad, "j-b"],
         ["MISS", bp.miss, "j-m"], ["COMBO", combo ?? "-", "j-c"]]
        .map(([k, v, c]) => `<div class="jd"><span class="${c}">${k}</span><b>${v}</b></div>`).join("")
      : `<p class="muted">판정 정보 없음 (최고 기록을 세운 플레이가 최근 플레이에 남아 있지 않아요)</p>`;
    const when = latest ? ` · ${latest.date} 갱신` : record.played_at ? ` · ${fmtDate(record.played_at)}` : "";
    const delta = latest && latest.deltaKind === "up" ? ` · <span class="up-text">${latest.delta}</span>` : "";
    best = `<div class="best-main">${gradeSpan(record, "bg")}<span class="bs">${fmtScore(record.score)}</span>${plateSpan(record, "bp")}</div>
      <div class="best-sub">최고 기록${when}${delta}</div>
      <div class="judges">${judges}</div>`;
  }

  const points = items.filter((i) => i.score != null).slice().reverse().map((i) => ({ label: i.date.replace(/^0/, ""), value: i.score! }));
  const graph = points.length
    ? lineChart(points, { ...scoreRange(points.map((p) => p.value)), guides: GRADE_GUIDES,
        ariaLabel: `점수 변화: ${points[0].label} ${fmtScore(points[0].value)}점에서 ${points[points.length - 1].label} ${fmtScore(points[points.length - 1].value)}점` })
    : "";
  const historyList = items.length
    ? `<ul class="hist">${items.map((i) => `<li><span class="d">${i.date}</span>${gradeSpan({ status: i.status, grade: i.grade })}
        <span class="s">${fmtScore(i.score)}</span>${plateSpan({ status: i.status, plate: i.status === "broken" ? null : i.plate })}
        <span class="dl ${i.deltaKind}">${i.delta}</span></li>`).join("")}</ul>`
    : `<p class="muted">기록 이력이 없어요</p>`;

  const plays = o.plays.length
    ? o.plays.map((p) => `<div class="play"><div class="pr"><span class="w">${fmtDate(p.played_at)} ${fmtTime(p.played_at)}</span>
        ${p.status === "stage_break" ? `<span class="g g-low">-</span><span class="s">STAGE BREAK</span>` : `${gradeSpan(p)}<span class="s">${fmtScore(p.score)}</span>`}
        ${plateSpan(p)}${p.set_best ? `<span class="best-tag">BEST</span>` : ""}</div><span class="jt">${judgeText(p)}</span></div>`).join("")
    : `<p class="muted">저장된 플레이가 없어요</p>`;

  return `<header class="sub-head">${backButton("기록표로 돌아가기")}<span>곡 상세</span></header>
    <section class="song-head">${jacketBox(view, o.lang, "jacket lg")}
      <div><h1>${esc(view.nameKo ?? view.nameEn ?? "알 수 없는 곡")}</h1>${view.nameKo && view.nameEn ? `<span class="en">${esc(view.nameEn)}</span>` : ""}
      <span class="chart-tag ${chartClass(o.type)}">${chartTag(o.type, o.level)}</span></div></section>
    <section class="card best" aria-label="최고 기록">${best}</section>
    <section class="card" aria-label="점수 변화"><h2>점수 변화</h2>${graph}${historyList}</section>
    <section class="card" aria-label="플레이 이력"><h2>플레이 이력</h2>${plays}</section>`;
}

/* ---------- 최근 플레이 ---------- */

export function recentHtml(o: { days: Day[]; total: number; index: SongIndex; lang: Lang }): string {
  const days = o.days.map((d) => `<section class="day"><div class="day-head"><h2>${d.label}</h2>
      <span>${d.plays.length}플레이 · 기록 상승 ${d.best}</span></div>
      ${d.plays.map((p) => {
        const v = o.index.byHash(p.piugame_hash);
        const sb = p.status === "stage_break";
        return `<button type="button" class="rp" data-play-hash="${esc(p.piugame_hash)}" data-type="${p.chart_type}" data-level="${p.level}">
          ${jacketBox(v, o.lang, "jacket sm")}
          <span class="rp-body"><span class="rp-top"><span class="nm">${esc(tileName(v, o.lang))}</span>
            <span class="ct ${chartClass(p.chart_type)}">${chartTag(p.chart_type, p.level)}</span>${p.set_best ? `<span class="best-tag">BEST</span>` : ""}</span>
          <span class="rp-mid">${sb ? `<span class="g g-low">-</span><span class="s">STAGE BREAK</span>` : `${gradeSpan(p)}<span class="s">${fmtScore(p.score)}</span>`}
            ${plateSpan(p)}<span class="t">${fmtTime(p.played_at)}</span></span>
          <span class="jt">${judgeText(p)}</span></span></button>`;
      }).join("")}</section>`).join("");
  return `<header class="tab-head"><h1>최근 플레이</h1><span>저장된 플레이 ${o.total}개</span></header>
    <p class="note">piugame.com은 최근 플레이를 약 50개만 보여줘요. 앱은 갱신할 때마다 쌓아 두니 자주 갱신하면 빠짐없이 남아요.</p>
    ${days || `<p class="empty-note">아직 저장된 플레이가 없어요. 기록 갱신을 눌러 보세요.</p>`}`;
}

/* ---------- 갱신 결과 ---------- */

export function resultHtml(o: { s: SyncSummary; index: SongIndex; lang: Lang; prevSyncAt: string | null; now: string }): string {
  const { s } = o;
  const firstClear = s.changes.filter((c) => c.tags.includes("first_clear")).length;
  const when = (iso: string) => `${fmtDate(iso)} ${new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
  const since = o.prevSyncAt ? ` · 지난 갱신 ${when(o.prevSyncAt)} 이후` : " · 첫 갱신";
  const pumb = s.pumbility == null ? "" : `<section class="card pumb-row" aria-label="PUMBILITY"><span class="k">PUMBILITY</span>
      ${s.pumbilityBefore != null ? `<span class="v old">${fmtScore(Math.round(s.pumbilityBefore))}</span><span aria-hidden="true">→</span>` : ""}
      <span class="v">${fmtScore(Math.round(s.pumbility))}</span>
      ${s.pumbilityBefore != null ? `<span class="dv">${fmtDelta(Math.round((s.pumbility - s.pumbilityBefore) * 100) / 100)}</span>` : ""}</section>`;
  const changes = s.changes.length
    ? `<ul class="changes">${s.changes.map((c) => {
        const v = o.index.byHash(c.piugame_hash);
        const it = changeItem(c);
        return `<li><button type="button" class="chg" data-play-hash="${esc(c.piugame_hash)}" data-type="${c.chart_type}" data-level="${c.level}">
          ${jacketBox(v, o.lang, "jacket sm")}
          <span class="chg-body"><span class="rp-top"><span class="nm">${esc(tileName(v, o.lang))}</span>
            <span class="ct ${chartClass(c.chart_type)}">${chartTag(c.chart_type, c.level)}</span>${it.tag ? `<span class="tag t-${it.tag === "첫 클리어" ? "first" : it.tag === "등급 UP" ? "grade" : "plate"}">${it.tag}</span>` : ""}</span>
          <span class="rp-mid"><span class="before">${esc(it.before)}</span><span aria-hidden="true">→</span>${gradeSpan(c.new)}
            <span class="s">${fmtScore(c.new.score)}</span>${plateSpan(c.new)}</span></span>
          <span class="dlt">${it.delta}</span></button></li>`;
      }).join("")}</ul>`
    : `<p class="muted">이번 갱신에서 달라진 기록은 없어요.</p>`;
  return `<header class="sub-head result-head"><div><h1>갱신 완료</h1><span>${when(o.now)}${since}</span></div>
      <button type="button" class="back" data-close aria-label="닫기"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15"/></svg></button></header>
    <div class="stat-tiles"><div><b class="c-up">${s.changes.length}</b><span>기록 상승</span></div>
      <div><b class="c-clear">${firstClear}</b><span>새 클리어</span></div><div><b>${s.newPlays}</b><span>플레이</span></div></div>
    ${pumb}<h2 class="sec">달라진 기록</h2>${changes}
    ${s.unmatched.length ? `<p class="muted">곡을 찾지 못한 기록 ${s.unmatched.length}개: ${esc(s.unmatched.join(", "))}</p>` : ""}
    <div class="result-foot"><button type="button" class="refresh" data-close data-goto="board">기록표에서 보기</button></div>`;
}

/* ---------- 통계 ---------- */

export function statsHtml(o: { history: { value: number; fetched_at: string }[]; type: string; levels: LevelStat[]; detail: boolean }): string {
  const h = o.history;
  const cur = h.length ? h[h.length - 1].value : null;
  const prev = h.length > 1 ? h[h.length - 2].value : null;
  const graph = h.length > 1
    ? lineChart(h.map((x) => ({ label: fmtDate(x.fetched_at).replace(/^0/, ""), value: x.value })),
        { height: 110, ariaLabel: `PUMBILITY 변화: ${fmtScore(Math.round(h[0].value))}에서 ${fmtScore(Math.round(cur!))}` })
    : `<p class="muted">${h.length ? "갱신을 한 번 더 하면 변화 그래프가 그려져요." : "기록 갱신을 하면 PUMBILITY가 저장돼요."}</p>`;
  const levels = o.levels.map((l) => {
    const pct = l.total ? Math.round((l.clear / l.total) * 100) : 0;
    return `<div class="lv-card"><div class="lv-top"><span class="lv">${chartTag(o.type, l.level)}</span>
        <span class="bar"><span style="width:${pct}%"></span></span><span class="cl">${l.clear} / ${l.total}</span></div>
      <div class="lv-bot"${o.detail ? "" : " hidden"}>${l.grades.map((g) => `<span class="${gradeClass(g.grade)}">${g.grade} ${g.count}</span>`).join("") || `<span class="muted-inline">클리어 없음</span>`}
        <span class="pls">${esc(l.plates)}</span></div></div>`;
  }).join("");
  return `<header class="tab-head"><h1>통계</h1></header>
    <section class="card" aria-label="PUMBILITY"><div class="pumb-top"><span class="k">PUMBILITY</span>
      <span class="v">${cur == null ? "-" : fmtScore(Math.round(cur))}</span>
      ${cur != null && prev != null ? `<span class="dv">${fmtDelta(Math.round((cur - prev) * 100) / 100)}</span>` : ""}</div>${graph}</section>
    <div class="seg stats-seg"><button type="button" class="seg-btn single" data-stype="Single" aria-pressed="${o.type === "Single"}">SINGLE</button>
      <button type="button" class="seg-btn double" data-stype="Double" aria-pressed="${o.type === "Double"}">DOUBLE</button></div>
    <div class="levels-head"><span>레벨별 현황</span>
      <button type="button" class="fold inline" id="stats-detail" aria-expanded="${o.detail}">${o.detail ? "등급 접기 ▴" : "등급 펼치기 ▾"}</button></div>
    <section class="levels" aria-label="레벨별 현황">${levels}</section>`;
}
