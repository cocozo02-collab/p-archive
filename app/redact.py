"""비밀번호와 세션 쿠키 값이 로그나 예외 메시지로 새지 않게 막는다.

비밀 값은 알게 되는 즉시 redactor.add()로 등록한다. 등록된 값은 로그 출력(트레이스백 포함)과
redact()를 거친 문자열에서 모두 ***로 바뀐다.
"""

import logging
from pathlib import Path


class SecretRedactor:
    def __init__(self) -> None:
        self._secrets: set[str] = set()

    def add(self, value: str | None) -> None:
        if value:
            self._secrets.add(value)

    def __call__(self, text: str) -> str:
        for secret in sorted(self._secrets, key=len, reverse=True):
            text = text.replace(secret, "***")
        return text


redactor = SecretRedactor()


class RedactingFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        return redactor(super().format(record))


def setup_logging(level: int = logging.INFO, log_file: Path | None = None) -> None:
    formatter = RedactingFormatter("%(asctime)s %(levelname)s %(name)s: %(message)s", "%H:%M:%S")
    handlers: list[logging.Handler] = [logging.StreamHandler()]
    if log_file:
        log_file.parent.mkdir(parents=True, exist_ok=True)
        handlers.append(logging.FileHandler(log_file, encoding="utf-8"))
    for h in handlers:
        h.setFormatter(formatter)
    root = logging.getLogger()
    root.handlers[:] = handlers
    root.setLevel(level)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
