"""사용자별 piugame 세션.

세션 쿠키는 사용자별 파일(data/sessions/user_<id>.json)에 둔다. 비밀번호는 저장하지 않는다.
다중 사용자로 바꿀 때는 SessionStore만 다른 구현(예: 암호화된 DB 저장)으로 바꾸면 된다.
"""

from typing import Protocol

from app import config
from app.piugame.client import LoginError, PiuGameClient, SessionExpired


class SessionStore(Protocol):
    def load(self, client: PiuGameClient, user_id: int) -> bool: ...

    def save(self, client: PiuGameClient, user_id: int) -> None: ...


class FileSessionStore:
    def load(self, client: PiuGameClient, user_id: int) -> bool:
        path = config.session_file(user_id)
        if not path.exists():
            return False
        client.load_session(path)
        return True

    def save(self, client: PiuGameClient, user_id: int) -> None:
        client.save_session(config.session_file(user_id))


# 로그인 상태 확인에 쓰는 가벼운 페이지. 게임카드(게임 ID) 정보도 여기서 얻는다.
PROBE_PATH = "/my_page/game_id_information.php"


def open_session(user_id: int, store: SessionStore | None = None,
                 credentials: tuple[str | None, str | None] | None = None) -> tuple[PiuGameClient, str]:
    """저장된 세션으로 접속하고, 만료됐으면 로그인한다. (클라이언트, 확인용 페이지 HTML)을 돌려준다.

    credentials를 주지 않으면 .env의 PIU_ID / PIU_PASSWORD를 쓴다(지금은 사용자가 한 명이라서).
    """
    store = store or FileSessionStore()
    client = PiuGameClient()
    if store.load(client, user_id):
        try:
            return client, client.get_page(PROBE_PATH)
        except SessionExpired:
            pass

    username, password = credentials or config.piu_credentials()
    if not username or not password:
        raise LoginError("세션이 없거나 만료됐고, 로그인할 계정 정보가 없음 (.env의 PIU_ID / PIU_PASSWORD)")
    client = PiuGameClient()
    client.login(username, password)
    html = client.get_page(PROBE_PATH)  # 로그인 실패면 여기서 SessionExpired
    store.save(client, user_id)
    return client, html
