"""곡 목록 동기화 (가끔 수동 실행).

  python scripts/sync_catalog.py          필요한 경우에만 Over Lv.20 Ranking을 받는다
  python scripts/sync_catalog.py --full   Over Lv.20 Ranking 전체 페이지를 다시 받는다

진행 로그는 data/logs/sync_catalog_*.log에 남는다. 중간에 끊겨도 다시 실행하면 받은 자켓은 재사용한다.
"""

import argparse
import logging
import sys

import _cli

log_file = _cli.init("sync_catalog")

from app.db import connect  # noqa: E402
from app.sync.catalog import sync_catalog  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="PIU Scores 곡 목록 + piugame 한국어 곡명 동기화")
    parser.add_argument("--full", action="store_true", help="Over Lv.20 Ranking 전체 페이지를 다시 받음")
    args = parser.parse_args()

    conn = connect()
    try:
        s = sync_catalog(conn, full=args.full)
    except Exception:
        logging.getLogger("sync_catalog").exception("곡 목록 동기화 실패")
        return 1

    st = s["stats"]
    print("\n== 곡 목록 동기화 결과 ==")
    print(f"PIU Scores 곡 {st['songs']}개 / 채보 {st['charts']}개")
    print(f"piugame 곡 {st['piugame_songs']}개 중 매칭 {st['piugame_songs_matched']}개")
    print(f"한국어 곡명이 있는 곡: {st['songs_with_name_ko']} / {st['songs']}")
    if isinstance(s.get("over_ranking"), dict):
        o = s["over_ranking"]
        print(f"Over Lv.20 Ranking: 필터 {', '.join(f or '전체' for f in o['filters'])}, {o['pages']}페이지")
    else:
        print("Over Lv.20 Ranking: 건너뜀 (한국어 곡명이 필요한 곡 없음)")
    if "matching" in s:
        m = s["matching"]
        print(f"이번 매칭: 해시 {m['by_sha']}개, 수동 {m['by_manual']}개 "
              f"(piugame 자켓 {m['piugame_jackets_downloaded']}장, CDN 자켓 {m['cdn_jackets_downloaded']}장 받음)")
    if "songs_ko_not_found" in s:
        print(f"Over Lv.20에서도 한국어 곡명을 못 찾은 곡: {s['songs_ko_not_found']}개 (다음부터 건너뜀)")
    print(f"piugame.com 요청: {s.get('piugame_requests', 0)}회")
    _cli.print_list("미매칭 piugame 곡", s["unmatched"], lambda u: f"{u['name_ko']} ({u['hash']}) — {u['reason']}")
    _cli.print_list("⚠ 같은 곡에 자켓 해시가 여러 개", s["hash_conflicts"],
                    lambda c: f"{c['name_en']}: " + ", ".join(f"{h['name_ko']}({h['hash'][:8]})" for h in c["hashes"]))
    print(f"\n로그: {log_file}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
