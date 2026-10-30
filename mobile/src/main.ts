import { App } from "@capacitor/app";
import { groupByGrade, type Lang, SongIndex, type SongView, type SortMode, sortTiles, summarize, type Tile } from "./board";
import { Catalog } from "./catalog";
import { clearCredentials, type Credentials, loadCredentials, saveCredentials } from "./credentials";
import { Db, type RecordRow } from "./db";
import { initJackets, observeJackets } from "./jackets";
import { isBetter, PLATES } from "./merge";
import { LoginError, PiuClient } from "./piu/client";
import type { ChartType } from "./piu/parser";
import { NeedLogin, type SyncSummary, syncRecords } from "./sync";
import { esc, gradeClass, groupHtml, plateClass, rowHtml, tileHtml } from "./ui/boardView";
import { detailHtml, recentHtml, resultHtml, statsHtml } from "./ui/screens";
import { type AppUpdate, appVersion, checkUpdates, downloadCatalog, installApp } from "./update";
import { groupByDay, levelStat } from "./views";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

type Tab = "board" | "recent" | "stats";

interface ViewState {
  tab: Tab;
  type: ChartType;
  level: number;
  view: "grid" | "list";
  sort: SortMode;
  showNames: boolean;
  lang: Lang;
  statsType: ChartType;
}

const state: ViewState = {
  tab: "board", type: "Single", level: 0, view: "grid", sort: "score", showNames: true, lang: "ko", statsType: "Single",
};
let db: Db;
let catalog: Catalog;
let index: SongIndex;
let typeRecords: RecordRow[] = [];
let tiles: Tile[] = [];
let pendingAppUpdate: AppUpdate | null = null;

// 화면 설정은 앱에 기억한다. 저장소가 막혀 있어도 화면은 기본값으로 동작해야 한다.
const prefs = {
  load() {
    try {
      const v = JSON.parse(localStorage.getItem("view") ?? "null") ?? {};
      if (v.type === "Single" || v.type === "Double") state.type = v.type;
      if (v.statsType === "Single" || v.statsType === "Double") state.statsType = v.statsType;
      if (typeof v.level === "number") state.level = v.level;
      if (v.view === "grid" || v.view === "list") state.view = v.view;
      if (["score", "name", "grade"].includes(v.sort)) state.sort = v.sort;
      if (typeof v.showNames === "boolean") state.showNames = v.showNames;
      if (v.lang === "ko" || v.lang === "en") state.lang = v.lang;
    } catch { /* 무시 */ }
  },
  save() {
    try { localStorage.setItem("view", JSON.stringify({ ...state, tab: undefined })); } catch { /* 무시 */ }
  },
};

const chartLabel = () => `${state.type === "Single" ? "S" : "D"}${state.level}`;

/* ---------- 기록표 ---------- */

function renderTools(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-view]")) b.setAttribute("aria-pressed", String(b.dataset.view === state.view));
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-lang]")) b.setAttribute("aria-pressed", String(b.dataset.lang === state.lang));
  $<HTMLSelectElement>("sort").value = state.sort;
  $("sort-wrap").classList.toggle("active", state.sort === "grade");
  const names = $("names");
  names.textContent = state.showNames ? "곡명 ON" : "곡명 OFF";
  names.setAttribute("aria-pressed", String(state.showNames));
  names.hidden = state.view === "list"; // 목록 보기는 곡명이 항상 보인다
}

function renderSummary(): void {
  const s = summarize(tiles);
  $("sum-label").textContent = `${chartLabel()} 클리어`;
  $("sum-clear").textContent = String(s.clear);
  $("sum-total").textContent = String(s.total);
  const bandLabel = { SSS: "SSS", SS: "SS", S: "S", "A-": "A 이하" } as const;
  $("bands").innerHTML = (["SSS", "SS", "S", "A-"] as const)
    .map((k) => `<div class="cell"><span class="k ${gradeClass(k === "A-" ? "AAA" : k)}">${bandLabel[k]}</span><b>${s.bands[k]}</b></div>`)
    .join("");
  $("plates").innerHTML = PLATES
    .map((p) => `<div class="cell${s.plates[p] ? "" : " zero"}"><span class="k ${plateClass(p)}">${p}</span><b>${s.plates[p]}</b></div>`)
    .join("");
}

function renderBoard(): void {
  const board = $("board");
  const opts = { lang: state.lang, showName: state.showNames };
  if (state.sort === "grade" && state.view === "grid") {
    board.innerHTML = `<div class="groups">${groupByGrade(tiles, state.lang).map((g) => groupHtml(g, opts)).join("")}</div>`;
  } else {
    const sorted = state.sort === "grade" ? groupByGrade(tiles, state.lang).flatMap((g) => g.tiles) : sortTiles(tiles, state.sort, state.lang);
    board.innerHTML = state.view === "list"
      ? `<ul class="rows">${sorted.map((t) => rowHtml(t, { lang: state.lang, chart: chartLabel() })).join("")}</ul>`
      : `<ul class="grid">${sorted.map((t) => tileHtml(t, { ...opts, scoreBand: false })).join("")}</ul>`;
  }
  observeJackets(board);
}

/** 타입·레벨이 바뀌면 데이터를 다시 읽고, 보기 설정만 바뀌면 그리기만 다시 한다. */
async function render(reload = true): Promise<void> {
  const levels = catalog.levels(state.type);
  if (!levels.includes(state.level)) state.level = levels.includes(20) ? 20 : levels[Math.floor(levels.length / 2)];
  prefs.save();

  for (const b of document.querySelectorAll<HTMLButtonElement>("#tab-board .seg-btn")) b.setAttribute("aria-pressed", String(b.dataset.type === state.type));
  const chips = $("chips");
  chips.innerHTML = levels
    .map((lv) => `<button type="button" class="chip" data-level="${lv}" aria-pressed="${lv === state.level}">${lv}</button>`)
    .join("");
  chips.querySelector('[aria-pressed="true"]')?.scrollIntoView({ inline: "center", block: "nearest" });

  if (reload) typeRecords = await db.recordsByType(catalog.mix, state.type);
  tiles = index.tiles(typeRecords, state.type, state.level);
  renderTools();
  renderSummary();
  renderBoard();
}

/* ---------- 최근 플레이 / 통계 ---------- */

async function renderRecent(): Promise<void> {
  const el = $("tab-recent");
  const [plays, total] = await Promise.all([db.recentPlays(catalog.mix), db.playCount(catalog.mix)]);
  el.innerHTML = recentHtml({ days: groupByDay(plays), total, index, lang: state.lang });
  observeJackets(el);
}

async function renderStats(): Promise<void> {
  const el = $("tab-stats");
  const records = await db.recordsByType(catalog.mix, state.statsType);
  const levels = catalog.levels(state.statsType)
    .map((lv) => levelStat(lv, index.tiles(records, state.statsType, lv)))
    .filter((l) => l.total > 0);
  el.innerHTML = statsHtml({ history: await db.pumbilityHistory(catalog.mix), type: state.statsType, levels });
}

function showTab(tab: Tab): void {
  state.tab = tab;
  for (const id of ["board", "recent", "stats"] as const) $(`tab-${id}`).hidden = id !== tab;
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-tab]")) {
    if (b.dataset.tab === tab) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
  window.scrollTo({ top: 0 });
  if (tab === "recent") void renderRecent();
  if (tab === "stats") void renderStats();
  if (tab === "board") observeJackets($("board"));
}

/* ---------- 곡 상세 / 갱신 결과 (전체 화면) ---------- */

let screenScroll = 0;

function openScreen(id: "detail" | "result", html: string): void {
  const el = $(id);
  if ($("detail").hidden && $("result").hidden) screenScroll = window.scrollY;
  el.innerHTML = html;
  el.hidden = false;
  el.scrollTop = 0;
  document.body.classList.add("screen-open");
  observeJackets(el);
}

function closeScreen(el: HTMLElement): void {
  el.hidden = true;
  el.innerHTML = "";
  if ($("detail").hidden && $("result").hidden) {
    document.body.classList.remove("screen-open");
    window.scrollTo({ top: screenScroll });
    // 화면이 덮여 있는 동안 멈췄던 자켓 받기를 다시 시작한다
    observeJackets($(`tab-${state.tab}`));
  }
}

async function openDetail(view: SongView, type: string, level: number): Promise<void> {
  const records = type === state.type ? typeRecords : await db.recordsByType(catalog.mix, type);
  let record: RecordRow | null = null;
  for (const r of records) {
    if (r.level === level && view.hashes.includes(r.piugame_hash) && isBetter(r, record)) record = r;
  }
  const [history, plays] = await Promise.all([
    db.historyFor(catalog.mix, view.hashes, type, level),
    db.playsFor(catalog.mix, view.hashes, type, level),
  ]);
  openScreen("detail", detailHtml({ view, lang: state.lang, type, level, record, history, plays }));
}

/* ---------- 헤더 / 알림 ---------- */

async function renderHeader(): Promise<void> {
  const tag = (await db.gameTag()) ?? "";
  const [name, hash] = tag.split(/(?=#)/);
  $("game-tag").innerHTML = tag ? `${esc(name.trim())} <span class="hash">${esc(hash ?? "")}</span>` : "";
  const last = await db.lastSyncAt();
  $("dot").classList.toggle("ok", !!last);
  $("status-text").textContent = last
    ? `마지막 갱신 · ${new Date(last).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}`
    : "아직 갱신하지 않았어요";
  $("mix").textContent = catalog.mix === "Phoenix2" ? "Phoenix 2" : catalog.mix;
  $("app-info").textContent = `앱 v${await appVersion()} · 곡 목록 ${catalog.generatedAt.slice(0, 10)}`;
}

function toast(msg: string): void {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout((t as unknown as { timer?: number }).timer);
  (t as unknown as { timer?: number }).timer = window.setTimeout(() => (t.hidden = true), 4000);
}

/* ---------- 기록 갱신 ---------- */

function askLogin(message = ""): Promise<{ creds: Credentials; remember: boolean } | null> {
  const dialog = $<HTMLDialogElement>("login");
  const form = $<HTMLFormElement>("login-form");
  $("login-error").textContent = message;
  (form.elements.namedItem("password") as HTMLInputElement).value = "";
  dialog.showModal();
  return new Promise((resolve) => {
    const done = (v: { creds: Credentials; remember: boolean } | null) => {
      form.onsubmit = null;
      $("login-cancel").onclick = null;
      dialog.close();
      resolve(v);
    };
    $("login-cancel").onclick = () => done(null);
    form.onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(form);
      done({
        creds: { username: String(f.get("username")).trim(), password: String(f.get("password")) },
        remember: f.get("remember") === "on",
      });
    };
  });
}

let syncing = false;

async function showResult(s: SyncSummary): Promise<void> {
  const times = await db.syncTimes(2);
  openScreen("result", resultHtml({ s, index, lang: state.lang, prevSyncAt: times[1] ?? null, now: times[0] ?? new Date().toISOString() }));
}

async function refresh(): Promise<void> {
  if (syncing) return;
  syncing = true;
  const overlay = $("progress");
  const setProgress = (m: string) => ($("progress-text").textContent = m);
  let creds = await loadCredentials();
  let remember = false;
  let loginMessage = "";
  try {
    for (;;) {
      overlay.hidden = false;
      try {
        const s = await syncRecords(db, catalog, creds, setProgress);
        if (remember && creds) await saveCredentials(creds);
        index = await SongIndex.load(db, catalog);
        await renderHeader();
        await render();
        if (state.tab !== "board") showTab(state.tab);
        await showResult(s);
        return;
      } catch (e) {
        overlay.hidden = true;
        if (e instanceof NeedLogin || e instanceof LoginError) {
          if (e instanceof LoginError) {
            await clearCredentials(); // 저장된 정보가 틀렸으면 지운다
            loginMessage = e.message;
          }
          const answer = await askLogin(loginMessage);
          if (!answer) return;
          creds = answer.creds;
          remember = answer.remember;
          continue;
        }
        toast(`갱신 실패: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
    }
  } finally {
    overlay.hidden = true;
    syncing = false;
    creds = null; // 비밀번호를 메모리에 오래 두지 않는다
  }
}

async function logout(): Promise<void> {
  await new PiuClient().logout();
  await clearCredentials();
  toast("로그아웃했어요. 다음 갱신 때 다시 로그인해요.");
}

/* ---------- 업데이트 ---------- */

async function runUpdateCheck(manual: boolean): Promise<void> {
  try {
    const { app, catalog: cat } = await checkUpdates(catalog.generatedAt);
    if (cat) {
      const file = await downloadCatalog(cat);
      catalog = new Catalog(file);
      index = await SongIndex.load(db, catalog);
      await renderHeader();
      await render();
      toast("새 곡 목록을 받았어요");
    }
    pendingAppUpdate = app;
    $("update-banner").hidden = !app;
    if (app) $("update-text").textContent = `새 버전 ${app.version}이 있어요`;
    if (manual && !app && !cat) toast("최신 버전이에요");
  } catch (e) {
    if (manual) toast(e instanceof Error ? e.message : String(e));
  }
}

async function startAppUpdate(): Promise<void> {
  if (!pendingAppUpdate) return;
  const overlay = $("progress");
  overlay.hidden = false;
  try {
    await installApp(pendingAppUpdate, (m) => ($("progress-text").textContent = m));
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  } finally {
    overlay.hidden = true;
  }
}

/* ---------- 이벤트 ---------- */

function bind(): void {
  const onClick = (sel: string, fn: (el: HTMLElement) => void) =>
    document.addEventListener("click", (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>(sel);
      if (el) fn(el);
    });

  onClick("#tab-board .seg-btn", (b) => {
    if (b.dataset.type !== state.type) {
      state.type = b.dataset.type as ChartType;
      void render();
    }
  });
  onClick(".chip", (b) => {
    state.level = Number(b.dataset.level);
    void render(false);
  });
  onClick("[data-view]", (b) => {
    state.view = b.dataset.view as ViewState["view"];
    void render(false);
  });
  onClick("[data-lang]", (b) => {
    state.lang = b.dataset.lang as Lang;
    void render(false);
  });
  onClick("#names", () => {
    state.showNames = !state.showNames;
    void render(false);
  });
  onClick("[data-stype]", (b) => {
    state.statsType = b.dataset.stype as ChartType;
    prefs.save();
    void renderStats();
  });
  onClick("[data-tab]", (b) => showTab(b.dataset.tab as Tab));
  onClick("[data-key]", (b) => {
    const key = b.dataset.key!;
    const view = key.startsWith("hash:") ? index.byHash(key.slice(5)) : index.bySong(key);
    void openDetail(view, state.type, state.level);
  });
  onClick("[data-play-hash]", (b) => {
    void openDetail(index.byHash(b.dataset.playHash!), b.dataset.type!, Number(b.dataset.level));
  });
  onClick("[data-close]", (b) => {
    closeScreen(b.closest<HTMLElement>(".screen")!);
    if (b.dataset.goto === "board") showTab("board");
  });
  $<HTMLSelectElement>("sort").addEventListener("change", (e) => {
    state.sort = (e.target as HTMLSelectElement).value as SortMode;
    void render(false);
  });
  $("refresh").addEventListener("click", () => void refresh());
  $("logout").addEventListener("click", () => void logout());
  $("check-update").addEventListener("click", () => void runUpdateCheck(true));
  $("update-btn").addEventListener("click", () => void startAppUpdate());

  // 안드로이드 뒤로 가기: 열린 화면 → 다른 탭 → 앱 닫기 순서
  void App.addListener("backButton", () => {
    if ($<HTMLDialogElement>("login").open) return;
    if (!$("detail").hidden) closeScreen($("detail"));
    else if (!$("result").hidden) closeScreen($("result"));
    else if (state.tab !== "board") showTab("board");
    else void App.exitApp();
  }).catch(() => undefined);
}

async function start(): Promise<void> {
  prefs.load();
  try {
    [catalog, db] = await Promise.all([Catalog.load(), Db.open(), initJackets()]) as [Catalog, Db, void];
    index = await SongIndex.load(db, catalog);
  } catch (e) {
    $("status-text").textContent = `시작 실패: ${e instanceof Error ? e.message : String(e)}`;
    return;
  }
  bind();
  showTab("board");
  await renderHeader();
  await render();
  void runUpdateCheck(false);
}

void start();
