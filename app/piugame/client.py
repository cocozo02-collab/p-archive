"""piugame.com(Phoenix 2) HTTP 클라이언트.

로그인 흐름은 PIU Scores PiuGameApi.GetSessionId를 따른다.
  1. GET  {base}/                     익명 세션 쿠키 받기
  2. POST {base}/bbs/login_check.php  url=/, mb_id, mb_password (+ Origin 헤더)
  3. 이름이 sid로 시작하는 쿠키가 생기면 로그인 성공. 없으면 거부된 것
  4. GET  https://am-pass.net          SSO 연동
이후 요청에는 sid 쿠키와 Origin 헤더만 있으면 된다.

비밀번호와 sid 값은 redactor에 등록되므로 로그와 예외 메시지에 찍히지 않는다.
리다이렉트 URL의 쿼리 문자열에는 SSO 토큰이 들어 있을 수 있어서, 이동 기록에는 경로까지만 남긴다.
"""

import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from http.cookiejar import Cookie
from pathlib import Path
from urllib.parse import urlsplit

import certifi
import requests

from app import config
from app.redact import redactor
from app.piugame.parser import is_logged_in

log = logging.getLogger(__name__)

MAX_RETRIES = 3
RETRY_BASE_SECONDS = 1.0
TIMEOUT_SECONDS = 30


class LoginError(Exception):
    pass


class SessionExpired(Exception):
    def __init__(self, message: str, html: str | None = None):
        super().__init__(message)
        self.html = html  # 진단용: 로그인 상태가 아니라고 판정한 페이지


class SsoBounce(Exception):
    """새 세션의 첫 요청이 am-pass.net을 거쳐 깨진 /ssoc URL로 끝나는 경우. 쿠키는 이미 받았으므로 다시 요청하면 된다."""


@dataclass
class Hop:
    method: str
    url: str
    status: int
    location: str | None
    cookie_names: list[str]
    elapsed_ms: int
    server: str | None
    cf_ray: bool

    def __str__(self) -> str:
        parts = [f"{self.method} {self.url} -> {self.status}", f"{self.elapsed_ms}ms"]
        if self.location:
            parts.append(f"location={self.location}")
        if self.cookie_names:
            parts.append(f"set-cookie=[{', '.join(self.cookie_names)}]")
        if self.server:
            parts.append(f"server={self.server}")
        if self.cf_ray:
            parts.append("cf-ray")
        return "  ".join(parts)


def _strip_query(url: str | None) -> str | None:
    if not url:
        return url
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}{parts.path}" + ("?…" if parts.query else "") if parts.netloc \
        else parts.path + ("?…" if parts.query else "")


def _hop(response: requests.Response) -> Hop:
    return Hop(
        method=response.request.method or "?",
        url=_strip_query(response.url) or "",
        status=response.status_code,
        location=_strip_query(response.headers.get("Location")),
        cookie_names=sorted({c.name for c in response.cookies}),
        elapsed_ms=int(response.elapsed.total_seconds() * 1000),
        server=response.headers.get("Server"),
        cf_ray="CF-RAY" in response.headers,
    )


def ensure_ca_bundle() -> str:
    """certifi 번들 + piugame.com이 빠뜨린 중간 인증서. TLS 검증은 끄지 않는다."""
    bundle = config.CA_BUNDLE
    if not bundle.exists() or bundle.stat().st_mtime < config.EXTRA_CA_CERT.stat().st_mtime:
        bundle.parent.mkdir(parents=True, exist_ok=True)
        bundle.write_text(
            Path(certifi.where()).read_text(encoding="utf-8") + "\n" + config.EXTRA_CA_CERT.read_text(encoding="utf-8"),
            encoding="utf-8",
        )
    return str(bundle)


class PiuGameClient:
    def __init__(self, base_url: str = config.PIU_BASE_URL, delay: float = config.REQUEST_DELAY_SECONDS):
        self.base_url = base_url
        self.delay = max(1.0, delay)
        self.hops: list[Hop] = []
        self.request_count = 0  # 보낸 요청 수(재시도 포함, 리다이렉트 제외)
        self.session = requests.Session()
        self.session.verify = ensure_ca_bundle()
        self.session.headers["Origin"] = base_url
        self._last_request = 0.0

    def _wait_turn(self) -> None:
        remaining = self._last_request + self.delay - time.monotonic()
        if remaining > 0:
            time.sleep(remaining)
        self._last_request = time.monotonic()

    def _request(self, method: str, url: str, **kwargs) -> requests.Response:
        for attempt in range(MAX_RETRIES + 1):
            self._wait_turn()
            self.request_count += 1
            try:
                response = self.session.request(method, url, timeout=TIMEOUT_SECONDS, **kwargs)
                for r in [*response.history, response]:
                    hop = _hop(r)
                    self.hops.append(hop)
                    log.info("%s", hop)
                if "ssoc" in urlsplit(response.url).path.lower():
                    raise SsoBounce(f"SSO 튕김: {_strip_query(response.url)}")
                return response
            except (requests.ConnectionError, requests.Timeout, SsoBounce) as e:
                if attempt == MAX_RETRIES:
                    raise
                wait = RETRY_BASE_SECONDS * (2 ** attempt)
                log.warning("%s %s 실패(%s), %.0f초 후 재시도", method, _strip_query(url), type(e).__name__, wait)
                time.sleep(wait)
        raise AssertionError("unreachable")

    def _sid_cookies(self) -> list[Cookie]:
        host = urlsplit(self.base_url).hostname or ""
        return [c for c in self.session.cookies
                if c.name.lower().startswith("sid") and host.endswith(c.domain.lstrip("."))]

    def login(self, username: str, password: str) -> None:
        redactor.add(password)
        self._request("GET", f"{self.base_url}/")
        self._request("POST", f"{self.base_url}/bbs/login_check.php",
                      data={"url": "/", "mb_id": username, "mb_password": password})
        sids = self._sid_cookies()
        for c in sids:
            redactor.add(c.value)
        if not sids:
            raise LoginError("로그인이 거부됨 (sid 쿠키가 생기지 않음)")
        self._request("GET", config.AMPASS_URL)
        # 비밀번호가 틀려도 익명 sid가 생길 수 있다. 실제 성공 여부는 첫 my_page 요청의 로그인 상태로 판단한다.

    def get_page(self, path: str) -> str:
        """인증이 필요한 페이지를 받는다. 로그인 상태가 아니면 SessionExpired."""
        response = self._request("GET", f"{self.base_url}{path}")
        response.raise_for_status()
        html = response.content.decode("utf-8", errors="replace")
        if not is_logged_in(html):
            raise SessionExpired(f"{path}: 로그인 상태가 아님 (세션 없음/만료 또는 로그인 실패)", html)
        return html

    def get_binary(self, url: str) -> bytes:
        """자켓 이미지 등. 다른 요청과 같은 간격 규칙을 따른다."""
        response = self._request("GET", url)
        response.raise_for_status()
        return response.content

    def save_session(self, path: Path) -> None:
        """세션 쿠키(sid*)만 저장한다."""
        cookies = [{"name": c.name, "value": c.value, "domain": c.domain, "path": c.path} for c in self._sid_cookies()]
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({
            "base_url": self.base_url,
            "saved_at": datetime.now(timezone.utc).isoformat(),
            "cookies": cookies,
        }, indent=2), encoding="utf-8")

    def load_session(self, path: Path) -> datetime:
        """저장된 sid를 불러온다. 저장 시각(UTC)을 돌려준다."""
        if not path.exists():
            raise SessionExpired("저장된 세션이 없음")
        data = json.loads(path.read_text(encoding="utf-8"))
        for c in data["cookies"]:
            redactor.add(c["value"])
            self.session.cookies.set(c["name"], c["value"], domain=c["domain"], path=c["path"])
        return datetime.fromisoformat(data["saved_at"])
