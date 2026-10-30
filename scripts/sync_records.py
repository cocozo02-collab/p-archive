"""기록 갱신. 5단계에서 화면의 "갱신" 버튼이 같은 함수(app.sync.records.sync_records)를 부른다.

  python scripts/sync_records.py
"""

import logging
import sys

import _cli

log_file = _cli.init("sync_records")

from app.db import connect  # noqa: E402
from app.sync.records import sync_records  # noqa: E402


def main() -> int:
    conn = connect()
    try:
        s = sync_records(conn)
    except Exception:
        logging.getLogger("sync_records").exception("기록 갱신 실패")
        return 1

    st = s["stats"]
    print("\n== 기록 갱신 결과 ==")
    print(f"게임 ID: {s['game_tag']}")
    print(f"최고 기록 {s['best_scores']}개 (사이트 표기 {s['site_total']}) / 최근 플레이 {s['recent_plays']}개 중 새 플레이 {s['new_plays']}개")
    print(f"저장된 기록 {st['records']}개 {st['by_status']} / 쌓인 플레이 {st['plays']}개")
    print(f"카탈로그 채보와 연결된 기록: {st['linked_charts']}개")
    print(f"piugame.com 요청: {s['piugame_requests']}회")
    _cli.print_list("최근 플레이로 보완한 기록", s["patched_from_plays"], lambda p: f"{p['chart']}: {p['from']} → {p['to']}")
    _cli.print_list("카탈로그와 연결되지 않은 기록", s["unlinked_records"],
                    lambda r: f"{r['name_ko']} {r['chart']} ({r['status']}){'' if r['matched_song'] else ' — 곡 미매칭'}")
    _cli.print_list("⚠ 같은 곡에 자켓 해시가 여러 개", s["hash_conflicts"],
                    lambda c: f"{c['name_en']}: " + ", ".join(f"{h['name_ko']}({h['hash'][:8]})" for h in c["hashes"]))
    if s["parse_errors"]:
        _cli.print_list("파싱 오류", s["parse_errors"], str)
    print(f"\n로그: {log_file}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
