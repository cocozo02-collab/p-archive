import { buildTiles, groupByGrade, type Lang, type SortMode, sortTiles, summarize, type Tile } from "./board";
import { Catalog } from "./catalog";
import { clearCredentials, type Credentials, loadCredentials, saveCredentials } from "./credentials";
import { Db } from "./db";
import { PLATES } from "./merge";
import { LoginError, PiuClient } from "./piu/client";
import type { ChartType } from "./piu/parser";
import { NeedLogin, syncRecords } from "./sync";
import { esc, gradeClass, groupHtml, plateClass, rowHtml, tileHtml } from "./ui/boardView";

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
}

const state: ViewState = { tab: "board", type: "Single", level: 0, view: "grid", sort: "score", showNames: true, lang: "ko" };
let db: Db;
let catalog: Catalog;
let tiles: Tile[] = [];

// 화면 설정은 앱에 기억한다. 저장소가 막혀 있어도 화면은 기본값으로 동작해야 한다.
const prefs = {
  load() {
    try {
      const v = JSON.parse(localStorage.getItem("view") ?? "null") ?? {};
      if (v.type === "Single" || v.type === "Double") state.type = v.type;
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

function renderTools(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-view]")) b.setAttribute("aria-pressed", String(b.dataset.view === state.view));
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-lang]")) b.setAttribute("aria-pressed", String(b.dataset.lang === state.lang));
  $<HTMLSelectElement>("sort").value = state.sort;
  $("sort-wrap").classList.toggle("active", state.sort === "grade");
  const names = $("names");
  names.textContent = state.showNames ? "곡명 ON" : "곡명 OFF";
  names.setAttribute("aria-pressed", String(state.showNames));
  // 목록 보기는 곡명이 항상 보이므로 곡명 ON/OFF가 필요 없다.
  names.hidden = state.view === "list";
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
    return;
  }
  const sorted = state.sort === "grade"
    ? groupByGrade(tiles, state.lang).flatMap((g) => g.tiles)
    : sortTiles(tiles, state.sort, state.lang);
  board.innerHTML = state.view === "list"
    ? `<ul class="rows">${sorted.map((t) => rowHtml(t, { lang: state.lang, chart: chartLabel() })).join("")}</ul>`
    : `<ul class="grid">${sorted.map((t) => tileHtml(t, { ...opts, scoreBand: false })).join("")}</ul>`;
}

/** 타입·레벨이 바뀌면 데이터를 다시 읽고, 보기 설정만 바뀌면 그리기만 다시 한다. */
async function render(reload = true): Promise<void> {
  const levels = catalog.levels(state.type);
  if (!levels.includes(state.level)) state.level = levels.includes(20) ? 20 : levels[Math.floor(levels.length / 2)];
  prefs.save();

  for (const b of document.querySelectorAll<HTMLButtonElement>(".seg-btn")) b.setAttribute("aria-pressed", String(b.dataset.type === state.type));
  const chips = $("chips");
  chips.innerHTML = levels
    .map((lv) => `<button type="button" class="chip" data-level="${lv}" aria-pressed="${lv === state.level}">${lv}</button>`)
    .join("");
  chips.querySelector('[aria-pressed="true"]')?.scrollIntoView({ inline: "center", block: "nearest" });

  if (reload) tiles = await buildTiles(db, catalog, state.type, state.level);
  renderTools();
  renderSummary();
  renderBoard();
}

function showTab(tab: Tab): void {
  state.tab = tab;
  for (const id of ["board", "recent", "stats"] as const) $(`tab-${id}`).hidden = id !== tab;
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-tab]")) {
    if (b.dataset.tab === tab) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
  window.scrollTo({ top: 0 });
}

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
}

function toast(msg: string): void {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout((t as unknown as { timer?: number }).timer);
  (t as unknown as { timer?: number }).timer = window.setTimeout(() => (t.hidden = true), 4000);
}

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
        await renderHeader();
        await render();
        const pumb = s.pumbility === null ? "" : ` · PUMBILITY ${s.pumbility.toLocaleString("en-US")}`;
        const extra = s.unmatched.length ? ` · 곡을 못 찾은 기록 ${s.unmatched.length}개` : "";
        toast(`갱신 완료: 바뀐 기록 ${s.changes.length}개, 새 플레이 ${s.newPlays}개${pumb}${extra}`);
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

function bind(): void {
  const onClick = (sel: string, fn: (el: HTMLElement) => void) =>
    document.addEventListener("click", (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>(sel);
      if (el) fn(el);
    });

  onClick(".seg-btn", (b) => {
    if (b.dataset.type !== state.type) {
      state.type = b.dataset.type as ChartType;
      void render();
    }
  });
  onClick(".chip", (b) => {
    state.level = Number(b.dataset.level);
    void render();
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
  onClick("[data-tab]", (b) => showTab(b.dataset.tab as Tab));
  onClick("[data-key]", () => {
    /* 곡 상세는 B3에서 연결한다 */
  });
  $<HTMLSelectElement>("sort").addEventListener("change", (e) => {
    state.sort = (e.target as HTMLSelectElement).value as SortMode;
    void render(false);
  });
  $("refresh").addEventListener("click", () => void refresh());
  $("logout").addEventListener("click", () => void logout());
}

async function start(): Promise<void> {
  prefs.load();
  try {
    [catalog, db] = await Promise.all([Catalog.load(), Db.open()]);
  } catch (e) {
    $("status-text").textContent = `시작 실패: ${e instanceof Error ? e.message : String(e)}`;
    return;
  }
  bind();
  showTab("board");
  await renderHeader();
  await render();
}

void start();
