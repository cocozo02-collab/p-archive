import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


def _path(name: str, default: Path) -> Path:
    value = os.getenv(name)
    return (ROOT / value).resolve() if value else default


DATA_DIR = _path("DATA_DIR", ROOT / "data")
DB_PATH = _path("DB_PATH", DATA_DIR / "p-archive.db")
HTML_DIR = DATA_DIR / "html"
LOG_DIR = DATA_DIR / "logs"
SESSIONS_DIR = DATA_DIR / "sessions"
SESSION_CHECK_LOG = DATA_DIR / "session_checks.log"
JACKETS_PIUGAME_DIR = DATA_DIR / "jackets" / "piugame"
JACKETS_CDN_DIR = DATA_DIR / "jackets" / "cdn"

MIGRATIONS_DIR = ROOT / "app" / "migrations"
MANUAL_SONG_MAP = ROOT / "seeds" / "manual_song_map.json"

# piugame.com은 중간 인증서를 보내지 않는다. certifi 번들에 이 인증서를 더한 번들로 검증한다.
EXTRA_CA_CERT = ROOT / "certs" / "sectigo-dv-r36.pem"
CA_BUNDLE = DATA_DIR / "ca-bundle.pem"

MIX = "Phoenix2"  # PIU Scores API의 mix 값과 같게 쓴다
PIU_BASE_URL = "https://piugame.com"
AMPASS_URL = "https://am-pass.net"
PIU_SCORES_BASE_URL = os.getenv("PIU_SCORES_BASE_URL") or "https://piuscores.arroweclip.se"

REQUEST_DELAY_SECONDS = max(1.0, float(os.getenv("PIU_REQUEST_DELAY") or 1.5))

# 지금은 사용자가 한 명이다. 다중 사용자로 바뀌면 요청마다 사용자를 정한다.
DEFAULT_USER_ID = 1


def piu_credentials() -> tuple[str | None, str | None]:
    return os.getenv("PIU_ID") or None, os.getenv("PIU_PASSWORD") or None


def piu_scores_token() -> str | None:
    return os.getenv("PIU_SCORES_TOKEN") or None


def session_file(user_id: int) -> Path:
    return SESSIONS_DIR / f"user_{user_id}.json"
