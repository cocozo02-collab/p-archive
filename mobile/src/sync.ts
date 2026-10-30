// 기록 갱신. Python 버전(app/sync/records.py)과 같은 순서.
// 1. 세션 확인(게임 ID 페이지). 만료면 로그인 정보로 로그인(없으면 NeedLogin).
// 2. 최고 기록 전체 페이지 + 최근 플레이.
// 3. 저장하고, 클리어가 아닌 기록은 최근 플레이로 보완.
// 4. 카탈로그에 없는 piugame 곡은 자켓을 받아 SHA-256으로 카탈로그 곡과 매칭.

import { CapacitorCookies } from "@capacitor/core";
import type { Catalog } from "./catalog";
import type { Credentials } from "./credentials";
import { USER_ID, type Db } from "./db";
import { bestPlayToPatch } from "./merge";
import { BASE_URL, LoginError, PiuClient, SessionExpired } from "./piu/client";
import { type ChartScore, parseBestScores, parseGameCards, parseRecentPlays } from "./piu/parser";

const PROBE_PATH = "/my_page/game_id_information.php";

export class NeedLogin extends Error {}

export interface SyncSummary {
  gameTag: string | null;
  bestScores: number;
  siteTotal: number | null;
  recentPlays: number;
  newPlays: number;
  patched: number;
  matched: number;
  unmatched: string[];
  requests: number;
  parseErrors: string[];
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 세션이 살아 있으면 그대로, 아니면 로그인한다. 확인용 페이지 HTML을 돌려준다. */
async function openSession(client: PiuClient, creds: Credentials | null): Promise<string> {
  try {
    return await client.getPage(PROBE_PATH);
  } catch (e) {
    if (!(e instanceof SessionExpired)) throw e;
  }
  if (!creds) throw new NeedLogin("로그인이 필요합니다");
  await client.login(creds.username, creds.password);
  try {
    return await client.getPage(PROBE_PATH);
  } catch (e) {
    if (e instanceof SessionExpired) {
      // 진단용: 쿠키 이름만 보여준다(값은 보여주지 않는다). sid가 없으면 쿠키 저장 문제, 있으면 계정 정보 문제일 가능성이 크다.
      const names = Object.keys(await CapacitorCookies.getCookies({ url: BASE_URL }).catch(() => ({}))).join(", ");
      throw new LoginError(`로그인 실패: 아이디 또는 비밀번호를 확인하세요 (쿠키: ${names || "없음"})`);
    }
    throw e;
  }
}

export async function syncRecords(
  db: Db, catalog: Catalog, creds: Credentials | null, progress: (msg: string) => void,
): Promise<SyncSummary> {
  const client = new PiuClient();
  const runId = await db.startRun("records");
  const parseErrors: string[] = [];
  try {
    progress("접속 확인 중…");
    const probe = await openSession(client, creds);
    const main = parseGameCards(probe).find((c) => c.isMain) ?? null;
    if (main) await db.setGameTag(main.gameTag);

    const best: ChartScore[] = [];
    let siteTotal: number | null = null;
    for (let page = 1, max = 1; page <= max; page++) {
      progress(`최고 기록 ${page}${max > 1 ? `/${max}` : ""} 페이지…`);
      const r = parseBestScores(await client.getPage(`/my_page/my_best_score.php?&&page=${page}`), page);
      max = r.maxPage;
      if (page === 1) siteTotal = r.totalCharts;
      best.push(...r.scores);
      parseErrors.push(...r.errors);
    }

    progress("최근 플레이…");
    const recent = parseRecentPlays(await client.getPage("/my_page/recently_played.php"));
    parseErrors.push(...recent.errors);

    progress("저장 중…");
    const saved = await db.saveFetched(catalog.mix, best, recent.plays,
      (rec, plays) => bestPlayToPatch(rec, plays));

    // 카탈로그에 없는 piugame 해시(자켓 교체, 20레벨 미만 곡 등)는 자켓 내용 해시로 곡을 찾는다.
    const pending = await db.needsMatching(catalog.mix, (h) => catalog.songByHash.has(h));
    let matched = 0;
    const unmatched: string[] = [];
    for (const [i, s] of pending.entries()) {
      progress(`새 곡 확인 ${i + 1}/${pending.length}…`);
      if (!s.jacket_url) {
        await db.setLocalMatch(catalog.mix, s.piugame_hash, null, null, "자켓 URL 없음");
        continue;
      }
      const sha = await sha256Hex(await client.getBinary(s.jacket_url));
      const key = catalog.songBySha.get(sha) ?? null;
      await db.setLocalMatch(catalog.mix, s.piugame_hash, sha, key, key ? null : "같은 자켓 없음");
      if (key) matched++;
      else unmatched.push(s.name_ko ?? s.piugame_hash);
    }

    const summary: SyncSummary = {
      gameTag: main?.gameTag ?? null, bestScores: best.length, siteTotal, recentPlays: recent.plays.length,
      newPlays: saved.newPlays, patched: saved.patched, matched, unmatched, requests: client.requestCount, parseErrors,
    };
    await db.finishRun(runId, "ok", summary);
    return summary;
  } catch (e) {
    await db.finishRun(runId, "failed", { error: e instanceof Error ? e.message : String(e), user: USER_ID });
    throw e;
  }
}
