"""스크립트 공통: 프로젝트 루트를 import 경로에 넣고, 콘솔 + 파일 로그를 설정한다."""

import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import config  # noqa: E402
from app.redact import setup_logging  # noqa: E402


def init(name: str) -> Path:
    log_file = config.LOG_DIR / f"{name}_{datetime.now():%Y%m%d_%H%M%S}.log"
    setup_logging(log_file=log_file)
    return log_file


def print_list(title: str, items: list, fmt) -> None:
    print(f"\n{title}: {len(items)}개")
    for item in items:
        print("  -", fmt(item))
