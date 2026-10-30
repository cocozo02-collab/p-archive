// piugame.com 클라이언트. Python 버전(app/piugame/client.py)과 같은 흐름·규칙.
//
// 로그인: GET / → POST /bbs/login_check.php (url=/, mb_id, mb_password, Origin 헤더) → GET am-pass.net
// 이후 요청은 세션 쿠키로 인증된다. 쿠키는 네이티브 쿠키 저장소(CapacitorCookies)가 보관하고,
// 리다이렉트 중간 단계의 Set-Cookie도 네이티브 HTTP가 처리한다.
// 요청 사이에는 최소 1.5초를 둔다. 비밀번호는 어디에도 기록하지 않는다.

import { CapacitorCookies, CapacitorHttp, type HttpResponse } from "@capacitor/core";
import { isLoggedIn } from "./parser";

export const BASE_URL = "https://piugame.com";
const AMPASS_URL = "https://am-pass.net";
export const REQUEST_DELAY_MS = 1500;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;
const TIMEOUT_MS = 30000;

export class LoginError extends Error {}
export class SessionExpired extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 새 세션의 첫 요청이 am-pass.net을 거쳐 깨진 /ssoc URL로 끝나는 경우. 쿠키는 이미 받았으므로 다시 요청하면 된다. */
class SsoBounce extends Error {}

// 요청 간격은 앱 전체에서 하나로 지킨다(기록 갱신과 자켓 받기가 동시에 돌아도 1.5초 간격).
let queue: Promise<void> = Promise.resolve();
let lastRequest = 0;

function waitTurn(): Promise<void> {
  const turn = queue.then(async () => {
    const remaining = lastRequest + REQUEST_DELAY_MS - Date.now();
    if (remaining > 0) await sleep(remaining);
    lastRequest = Date.now();
  });
  queue = turn.catch(() => undefined);
  return turn;
}

export class PiuClient {
  requestCount = 0;

  private async waitTurn(): Promise<void> {
    await waitTurn();
  }

  private async request(
    method: "GET" | "POST",
    url: string,
    opts: { data?: Record<string, string>; binary?: boolean } = {},
  ): Promise<HttpResponse> {
    for (let attempt = 0; ; attempt++) {
      await this.waitTurn();
      this.requestCount++;
      try {
        const res = await CapacitorHttp.request({
          method,
          url,
          headers: {
            Origin: BASE_URL,
            ...(opts.data ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
          },
          data: opts.data,
          responseType: opts.binary ? "arraybuffer" : "text",
          connectTimeout: TIMEOUT_MS,
          readTimeout: TIMEOUT_MS,
        });
        if (res.url && new URL(res.url).pathname.toLowerCase().includes("ssoc")) throw new SsoBounce();
        return res;
      } catch (e) {
        if (attempt >= MAX_RETRIES) throw e;
        await sleep(RETRY_BASE_MS * 2 ** attempt);
      }
    }
  }

  /** 인증이 필요한 페이지. 로그인 상태가 아니면 SessionExpired. */
  async getPage(path: string): Promise<string> {
    const res = await this.request("GET", BASE_URL + path);
    if (res.status >= 400) throw new Error(`${path}: HTTP ${res.status}`);
    const html = typeof res.data === "string" ? res.data : String(res.data);
    if (!isLoggedIn(html)) throw new SessionExpired("로그인이 필요합니다");
    return html;
  }

  /** 자켓 이미지 등. 다른 요청과 같은 간격 규칙을 따른다. */
  async getBinary(url: string): Promise<Uint8Array> {
    const res = await this.request("GET", url, { binary: true });
    if (res.status >= 400) throw new Error(`이미지 HTTP ${res.status}`);
    const b64 = typeof res.data === "string" ? res.data : "";
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async login(username: string, password: string): Promise<void> {
    await this.request("GET", BASE_URL + "/");
    await this.request("POST", BASE_URL + "/bbs/login_check.php", {
      data: { url: "/", mb_id: username, mb_password: password },
    });
    await this.request("GET", AMPASS_URL);
    // 비밀번호가 틀려도 익명 세션 쿠키는 생긴다. 성공 여부는 호출한 쪽이 첫 my_page 요청으로 판단한다.
  }

  async logout(): Promise<void> {
    await CapacitorCookies.clearCookies({ url: BASE_URL });
    await CapacitorCookies.clearCookies({ url: AMPASS_URL });
  }
}
