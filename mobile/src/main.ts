import { buildBoard, type Tile } from "./board";
import { Catalog } from "./catalog";
import { clearCredentials, type Credentials, loadCredentials, saveCredentials } from "./credentials";
import { Db } from "./db";
import { LoginError, PiuClient } from "./piu/client";
import type { ChartType } from "./piu/parser";
import { NeedLogin, syncRecords } from "./sync";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const state = { type: "Single" as ChartType, level: 0 };
let db: Db;
let catalog: Catalog;

// 마지막으로 본 타입/레벨. 저장소가 막혀 있어도 화면은 동작해야 한다.
const prefs = {
  load() {
    try {
      const v = JSON.parse(localStorage.getItem("view") ?? "null");
      if (v?.type === "Single" || v?.type === "Double") state.type = v.type;
      if (typeof v?.level === "number") state.level = v.level;
    } catch { /* 무시 */ }
  },
  save() {
    try { localStorage.setItem("view", JSON.stringify(state)); } catch { /* 무시 */ }
  },
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function gradeClass(grade: string | null): string {
  if (!grade) return "";
  if (grade.startsWith("SSS")) return "g-sss";
  if (grade.startsWith("SS")) return "g-ss";
  if (grade.startsWith("S")) return "g-s";
  if (grade.startsWith("AAA")) return "g-aaa";
  return "g-low";
}

function plateClass(plate: string): string {
  return { PG: "p-top", UG: "p-top", EG: "p-high", SG: "p-high", MG: "p-mid", TG: "p-mid" }[plate] ?? "p-low";
}

function tileHtml(t: Tile): string {
  const r = t.record;
  const has = r && r.status !== "stage_break";
  const img = t.jacket ? `<img src="${esc(t.jacket)}" alt="" loading="lazy" />` : "";
  let band = "";
  let badge = "";
  if (r?.status === "pass") {
    band = `<span class="band ${gradeClass(r.grade)}">${esc(r.grade ?? "")}</span>`;
    if (r.plate) badge = `<span class="badge ${plateClass(r.plate)}">${r.plate}</span>`;
  } else if (r?.status === "broken") {
    band = `<span class="band g-fail">F</span>`;
    badge = `<span class="badge b-break">BREAK</span>`;
  }
  const score = has && r.score != null ? r.score.toLocaleString("en-US") : "기록 없음";
  return `<li class="tile${has ? "" : " empty"}${t.inCatalog ? "" : " orphan"}">
    <div class="jacket">${img}${band}${badge}</div>
    <div class="name">${esc(t.name)}</div>
    <div class="score${has ? "" : " none"}">${score}</div>
  </li>`;
}

async function render(): Promise<void> {
  const levels = catalog.levels(state.type);
  if (!levels.includes(state.level)) state.level = levels.includes(20) ? 20 : levels[Math.floor(levels.length / 2)];
  prefs.save();

  for (const b of document.querySelectorAll<HTMLButtonElement>(".seg-btn")) {
    b.classList.toggle("on", b.dataset.type === state.type);
    b.setAttribute("aria-selected", String(b.dataset.type === state.type));
  }
  const chips = $("chips");
  chips.innerHTML = levels
    .map((lv) => `<button type="button" class="chip${lv === state.level ? " on" : ""}" data-level="${lv}">${lv}</button>`)
    .join("");
  chips.querySelector(".chip.on")?.scrollIntoView({ inline: "center", block: "nearest" });

  const board = await buildBoard(db, catalog, state.type, state.level);
  $("sum-label").textContent = `${state.type === "Single" ? "S" : "D"} ${state.level} 클리어`;
  $("sum-clear").textContent = String(board.clear);
  $("sum-total").textContent = String(board.total);
  $("bands").innerHTML = (["SSS", "SS", "S", "AAA-"] as const)
    .map((k) => `<div class="cell"><span class="k ${gradeClass(k === "AAA-" ? "AAA" : k)}">${k === "AAA-" ? "AAA 이하" : k}</span><b>${board.bands[k]}</b></div>`)
    .join("");
  $("grid").innerHTML = board.tiles.map(tileHtml).join("");
}

async function renderHeader(): Promise<void> {
  $("game-tag").textContent = (await db.gameTag()) ?? "";
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

async function start(): Promise<void> {
  prefs.load();
  try {
    [catalog, db] = await Promise.all([Catalog.load(), Db.open()]);
  } catch (e) {
    $("status-text").textContent = `시작 실패: ${e instanceof Error ? e.message : String(e)}`;
    return;
  }
  document.querySelector(".seg")!.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>(".seg-btn");
    if (b?.dataset.type && b.dataset.type !== state.type) {
      state.type = b.dataset.type as ChartType;
      void render();
    }
  });
  $("chips").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>(".chip");
    if (b?.dataset.level) {
      state.level = Number(b.dataset.level);
      void render();
    }
  });
  $("refresh").addEventListener("click", () => void refresh());
  $("logout").addEventListener("click", () => void logout());
  await renderHeader();
  await render();
}

void start();
