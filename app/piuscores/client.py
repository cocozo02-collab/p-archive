"""PIU Scores(piuscores.arroweclip.se) API v2와 자켓 CDN 클라이언트.

인증: 개인 토큰을 비밀번호로 쓰는 HTTP Basic (docs/API.md). 토큰은 redactor에 등록한다.
목록은 {data, limit, total, next} 봉투로 오고, next를 그대로 따라간다(직접 만들지 않는다).
"""

import base64
import logging
import time

import requests

from app import config
from app.redact import redactor

log = logging.getLogger(__name__)

TIMEOUT_SECONDS = 30
CDN_TIMEOUT_SECONDS = 120
MAX_RETRIES = 3


class PiuScoresError(Exception):
    pass


class PiuScoresClient:
    def __init__(self, token: str, base_url: str = config.PIU_SCORES_BASE_URL):
        redactor.add(token)
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        auth = "Basic " + base64.b64encode(f"x:{token}".encode()).decode()
        redactor.add(auth)
        self.session.headers["Authorization"] = auth
        # CDN에는 토큰을 보내지 않는다.
        self.cdn = requests.Session()

    def _get_json(self, url: str) -> dict:
        for attempt in range(MAX_RETRIES + 1):
            try:
                response = self.session.get(url, timeout=TIMEOUT_SECONDS)
            except (requests.ConnectionError, requests.Timeout):
                if attempt == MAX_RETRIES:
                    raise
                time.sleep(2 ** attempt)
                continue
            if response.status_code == 429:
                wait = int(response.headers.get("Retry-After") or 5)
                log.warning("PIU Scores 요청 한도 초과, %d초 대기", wait)
                time.sleep(wait)
                continue
            if response.status_code == 401:
                raise PiuScoresError("PIU Scores 인증 실패 (PIU_SCORES_TOKEN 확인)")
            response.raise_for_status()
            return response.json()
        raise PiuScoresError(f"요청 실패: {url}")

    def _list(self, path: str) -> list[dict]:
        rows: list[dict] = []
        url: str | None = f"{self.base_url}/api/v2/{path}"
        while url:
            body = self._get_json(url)
            rows += body["data"]
            url = body.get("next")
        return rows

    def songs(self, mix: str) -> list[dict]:
        return self._list(f"songs?mix={mix}&limit=500")

    def charts(self, mix: str) -> list[dict]:
        return self._list(f"charts?mix={mix}&limit=500")

    def cdn_size(self, url: str) -> int | None:
        """자켓 이미지의 Content-Length. 이미지를 받지 않고 크기만 본다."""
        for attempt in range(MAX_RETRIES + 1):
            try:
                response = self.cdn.head(url, timeout=TIMEOUT_SECONDS, allow_redirects=True)
                if response.status_code != 200:
                    return None
                length = response.headers.get("Content-Length")
                return int(length) if length else None
            except (requests.ConnectionError, requests.Timeout):
                if attempt == MAX_RETRIES:
                    raise
                time.sleep(2 ** attempt)
        return None

    def cdn_download(self, url: str) -> bytes:
        for attempt in range(MAX_RETRIES + 1):
            try:
                response = self.cdn.get(url, timeout=CDN_TIMEOUT_SECONDS)
                response.raise_for_status()
                return response.content
            except (requests.ConnectionError, requests.Timeout, requests.exceptions.ChunkedEncodingError):
                if attempt == MAX_RETRIES:
                    raise
                time.sleep(2 ** attempt)
        raise PiuScoresError(f"다운로드 실패: {url}")
