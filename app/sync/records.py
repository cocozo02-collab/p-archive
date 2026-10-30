"""기록 갱신 (5단계에서 "갱신" 버튼과 연결).

1. 저장된 세션으로 접속(만료면 로그인)하고 게임 ID를 갱신한다.
2. 최고 기록 전체 페이지와 최근 플레이를 받는다.
3. 최고 기록은 목록 그대로 저장하고, 클리어가 아닌 기록은 최근 플레이로 보완한다.
4. 처음 보는 piugame 곡은 자켓을 받아 카탈로그와 매칭한다.
"""

import logging
import sqlite3

from app import config
from app.db import now
from app.piugame.parser import ChartScore, parse_best_scores, parse_game_cards, parse_recent_plays
from app.piugame.session import open_session
from app.piuscores.client import PiuScoresClient
from app.redact import redactor
from app.store import catalog, records, runs
from app.sync.matching import match_pending

log = logging.getLogger(__name__)


def _register_song(conn: sqlite3.Connection, mix: str, s: ChartScore, ts: str) -> bool:
    new = catalog.upsert_piugame_song(conn, mix, s.jacket_hash, s.song_name, s.jacket_url, "records", ts)
    catalog.add_piugame_chart(conn, mix, s.jacket_hash, s.chart_type, s.level)
    return new


def sync_records(conn: sqlite3.Connection, user_id: int = config.DEFAULT_USER_ID, mix: str = config.MIX,
                 credentials: tuple[str | None, str | None] | None = None) -> dict:
    run_id = runs.start_run(conn, "records", user_id)
    summary: dict = {}
    try:
        client, game_id_html = open_session(user_id, credentials=credentials)
        main = next((c for c in parse_game_cards(game_id_html) if c.is_main), None)
        if main:
            with conn:
                conn.execute("UPDATE users SET game_tag = ? WHERE id = ?", (main.game_tag, user_id))
        summary["game_tag"] = main.game_tag if main else None

        best: list[ChartScore] = []
        page, max_page, parse_errors = 1, 1, []
        while page <= max_page:
            result = parse_best_scores(client.get_page(f"/my_page/my_best_score.php?&&page={page}"), page)
            max_page = result.max_page
            best += result.scores
            parse_errors += result.errors
            if page == 1:
                summary["site_total"] = result.total_charts
            log.info("최고 기록 %d/%d 페이지 (%d개)", page, max_page, len(best))
            page += 1

        plays, play_errors = parse_recent_plays(client.get_page("/my_page/recently_played.php"))
        parse_errors += play_errors

        ts = now()
        new_songs = new_plays = skipped = 0
        with conn:
            for s in best:
                if not s.jacket_hash:
                    skipped += 1
                    parse_errors.append(f"자켓 해시 없음: {s.song_name} {s.chart_type} {s.level}")
                    continue
                new_songs += _register_song(conn, mix, s, ts)
                records.upsert_record(conn, user_id, mix, s, ts)
            for p in plays:
                if not p.jacket_hash or p.played_at is None:
                    skipped += 1
                    continue
                new_songs += _register_song(conn, mix, p, ts)
                new_plays += records.insert_play(conn, user_id, mix, p, ts)
            patched = records.patch_from_plays(conn, user_id, mix, ts)

        summary.update(best_scores=len(best), recent_plays=len(plays), new_plays=new_plays,
                       new_piugame_songs=new_songs, patched_from_plays=patched, skipped=skipped,
                       parse_errors=parse_errors)

        if catalog.unmatched_piugame_songs(conn, mix):
            token = config.piu_scores_token()
            if token:
                m = match_pending(conn, mix, client, PiuScoresClient(token))
                summary["matching"] = {"by_manual": m.by_manual, "by_sha": m.by_sha, "unmatched": m.unmatched}
            else:
                summary["matching"] = "PIU_SCORES_TOKEN 없음 — 매칭 건너뜀"

        summary["piugame_requests"] = client.request_count
        summary["stats"] = records.record_stats(conn, user_id, mix)
        summary["unlinked_records"] = [
            dict(name_ko=r["name_ko"], chart=f"{r['chart_type']} {r['level']}", status=r["status"],
                 matched_song=r["song_id"] is not None)
            for r in records.unlinked_records(conn, user_id, mix)]
        summary["hash_conflicts"] = catalog.hash_conflicts(conn, mix)
        runs.finish_run(conn, run_id, "ok", summary)
        return summary
    except BaseException as e:
        summary["error"] = redactor(f"{type(e).__name__}: {e}")
        runs.finish_run(conn, run_id, "failed", summary)
        raise
