"""2단계 크롤러 검증 스크립트.

  python scripts/verify_crawler.py                  로그인 → 게임카드/최고 기록/최근 플레이 파싱 → 세션 저장
  python scripts/verify_crawler.py --pages 2        최고 기록을 2페이지까지
  python scripts/verify_crawler.py --check-session  저장된 sid로 재접속만 해 보고 유지 시간을 기록

받은 HTML은 data/html/에, 세션 쿠키는 data/sessions/user_1.json에 저장된다(둘 다 .gitignore 대상).
"""

import argparse
import getpass
import logging
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import config  # noqa: E402
from app.piugame.client import LoginError, PiuGameClient, SessionExpired  # noqa: E402
from app.piugame.parser import ChartScore, parse_best_scores, parse_game_cards, parse_recent_plays  # noqa: E402
from app.redact import redactor, setup_logging  # noqa: E402

log = logging.getLogger("verify")

CAPTCHA_MARKERS = re.compile(r"captcha|recaptcha|hcaptcha|turnstile|cf-challenge|challenge-platform", re.I)


def save_html(name: str, html: str, enabled: bool) -> None:
    if not enabled:
        return
    config.HTML_DIR.mkdir(parents=True, exist_ok=True)
    (config.HTML_DIR / f"{name}.html").write_text(html, encoding="utf-8")


def fmt(s: ChartScore) -> str:
    kind = "S" if s.chart_type == "Single" else "D" if s.chart_type == "Double" else "CO"
    score = "STAGE BREAK" if s.score is None else f"{s.score:>9,}"
    status = " (실패)" if s.is_broken and not s.is_stage_break else ""
    when = s.played_at.strftime("%Y-%m-%d %H:%M") if s.played_at else "-"
    return f"{kind}{s.level:<3} {score:>11}  {s.grade or '-':<5} {s.plate or '-':<3}{status:<5} {when}  {s.song_name}"


def run_login(args: argparse.Namespace) -> int:
    username, password = config.piu_credentials()
    username = username or input("piugame 아이디: ").strip()
    password = password or getpass.getpass("piugame 비밀번호: ")
    redactor.add(password)

    client = PiuGameClient()
    pages: dict[str, str] = {}

    print("\n== 로그인 ==")
    client.login(username, password)
    del password

    print("\n== 게임카드 ==")
    try:
        html = client.get_page("/my_page/game_id_information.php")
    except SessionExpired as e:
        save_html("not_logged_in", e.html or "", args.save_html)
        print("로그인 상태가 아닌 페이지가 나왔습니다. 아이디/비밀번호가 틀렸거나, 로그인 판정 기준(로그아웃 링크)이")
        print(f"Phoenix 2 페이지와 맞지 않을 수 있습니다. 받은 HTML: {config.HTML_DIR / 'not_logged_in.html'}")
        return 1
    pages["game_id_information"] = html
    save_html("game_id_information", html, args.save_html)
    cards = parse_game_cards(html)
    for c in cards:
        print(f"  {'*' if c.is_main else ' '} {c.game_tag}  (sub_profile={c.sub_profile_id})")
    print(f"  → 게임카드 {len(cards)}개" + ("" if cards else " (파싱 실패 — 저장된 HTML 확인 필요)"))

    print("\n== 최고 기록 ==")
    page, max_page = 1, 1
    while page <= min(args.pages, max_page):
        html = client.get_page(f"/my_page/my_best_score.php?&&page={page}")
        pages[f"my_best_score_p{page}"] = html
        save_html(f"my_best_score_p{page}", html, args.save_html)
        result = parse_best_scores(html, page)
        max_page = result.max_page
        print(f"  [page {page}/{result.max_page}] 전체 {result.total_charts}개 중 {len(result.scores)}개 파싱"
              f"{f', UCS {result.skipped_ucs}개 제외' if result.skipped_ucs else ''}")
        for s in result.scores:
            print("   ", fmt(s))
        for e in result.errors:
            print("    ! 파싱 오류:", e)
        page += 1

    print("\n== 최근 플레이 ==")
    html = client.get_page("/my_page/recently_played.php")
    pages["recently_played"] = html
    save_html("recently_played", html, args.save_html)
    plays, errors = parse_recent_plays(html)
    print(f"  {len(plays)}개 파싱")
    for p in plays[:10]:
        print("   ", fmt(p), f"  [P{p.perfect} Gr{p.great} Go{p.good} B{p.bad} M{p.miss}]")
    if len(plays) > 10:
        print(f"    … 외 {len(plays) - 10}개")
    for e in errors:
        print("    ! 파싱 오류:", e)

    print("\n== 차단 장치 점검 ==")
    servers = sorted({h.server for h in client.hops if h.server})
    print(f"  Server 헤더: {', '.join(servers) or '(없음)'}")
    print(f"  CF-RAY 헤더: {'있음 (Cloudflare 경유)' if any(h.cf_ray for h in client.hops) else '없음'}")
    captcha = sorted(name for name, h in pages.items() if CAPTCHA_MARKERS.search(h))
    print(f"  캡차/챌린지 흔적: {', '.join(captcha) if captcha else '없음'}")

    session_path = config.session_file(config.DEFAULT_USER_ID)
    client.save_session(session_path)
    print(f"\n세션 쿠키를 저장했습니다: {session_path}")
    if args.save_html:
        print(f"받은 HTML: {config.HTML_DIR}")
    print("유지 시간 확인: 1시간 뒤, 24시간 뒤에 --check-session으로 실행하세요.")
    return 0


def run_check_session(_: argparse.Namespace) -> int:
    client = PiuGameClient()
    path = config.session_file(config.DEFAULT_USER_ID)
    if not path.exists():
        raise SessionExpired("저장된 세션이 없음")
    saved_at = client.load_session(path)
    age = datetime.now(timezone.utc) - saved_at
    hours = age.total_seconds() / 3600
    try:
        client.get_page("/my_page/play_data.php")
        result = "valid"
    except SessionExpired as e:
        save_html("session_check_expired", e.html or "", True)
        result = "expired"
    print(f"\n저장 후 {hours:.1f}시간 경과: 세션 {'유효' if result == 'valid' else '만료'}")
    config.SESSION_CHECK_LOG.parent.mkdir(parents=True, exist_ok=True)
    with config.SESSION_CHECK_LOG.open("a", encoding="utf-8") as f:
        f.write(f"{datetime.now(timezone.utc).isoformat()}\tage_hours={hours:.2f}\t{result}\n")
    return 0 if result == "valid" else 2


def main() -> int:
    parser = argparse.ArgumentParser(description="piugame.com 크롤러 검증")
    parser.add_argument("--check-session", action="store_true", help="저장된 세션 쿠키가 아직 유효한지만 확인")
    parser.add_argument("--pages", type=int, default=1, help="가져올 최고 기록 페이지 수 (기본 1)")
    parser.add_argument("--no-save-html", dest="save_html", action="store_false", help="받은 HTML을 저장하지 않음")
    args = parser.parse_args()

    setup_logging()
    try:
        return run_check_session(args) if args.check_session else run_login(args)
    except (LoginError, SessionExpired) as e:
        print(f"\n실패: {redactor(str(e))}")
        return 1
    except Exception:
        log.exception("예상하지 못한 오류")  # RedactingFormatter가 트레이스백의 비밀 값도 가린다
        return 1


if __name__ == "__main__":
    sys.exit(main())
