"""곡 목록 동기화 (가끔 수동 실행).

1. PIU Scores API에서 곡·채보 목록을 받는다.
2. 새 CDN 자켓 URL만 HEAD로 크기를 확인한다(매칭 후보를 좁히는 데 쓴다).
3. Over Lv.20 Ranking에 나올 채보가 있는데 한국어 곡명이 없는 곡이 있을 때만 그 레벨 필터 페이지를 받는다.
   full=True면 전체 페이지를 받는다.
4. piugame 자켓을 받아 매칭하고, 한국어 곡명을 채운다.
"""

import logging
import sqlite3
from concurrent.futures import ThreadPoolExecutor

from app import config
from app.db import now
from app.piugame.parser import parse_over_ranking
from app.piugame.session import open_session
from app.piuscores.client import PiuScoresClient, PiuScoresError
from app.redact import redactor
from app.store import catalog, runs
from app.sync.matching import match_pending

log = logging.getLogger(__name__)

CDN_HEAD_WORKERS = 4


def _sync_piuscores(conn: sqlite3.Connection, piuscores: PiuScoresClient, mix: str) -> dict:
    songs = piuscores.songs(mix)
    charts = piuscores.charts(mix)
    ts = now()
    with conn:
        ids = {s["name"]: catalog.upsert_song(conn, mix, s, ts) for s in songs}
        missing = 0
        for c in charts:
            song_id = ids.get(c["songName"])
            if song_id is None:
                missing += 1
                continue
            catalog.upsert_chart(conn, song_id, mix, c, ts)
    log.info("PIU Scores: 곡 %d개, 채보 %d개 받음", len(songs), len(charts))
    return {"songs": len(songs), "charts": len(charts), "charts_without_song": missing}


def _sync_cdn_sizes(conn: sqlite3.Connection, piuscores: PiuScoresClient, mix: str) -> int:
    todo = catalog.songs_needing_cdn_size(conn, mix)
    if not todo:
        return 0
    log.info("CDN 자켓 크기 확인: %d개 (HEAD, 동시 %d개)", len(todo), CDN_HEAD_WORKERS)
    done = 0
    with ThreadPoolExecutor(CDN_HEAD_WORKERS) as pool:
        for row, size in zip(todo, pool.map(lambda r: piuscores.cdn_size(r["piuscores_image_url"]), todo)):
            catalog.set_cdn_size(conn, row["id"], row["piuscores_image_url"], size)
            done += 1
            if done % 25 == 0 or done == len(todo):
                conn.commit()
                log.info("CDN 크기 확인 %d/%d", done, len(todo))
    return done


def _choose_filters(needs: dict[int, set[str]]) -> list[str]:
    """곡마다 나올 수 있는 lv 필터 중, 모든 곡을 덮는 필터를 욕심쟁이 방식으로 고른다."""
    uncovered = dict(needs)
    chosen: list[str] = []
    while uncovered:
        counts: dict[str, int] = {}
        for filters in uncovered.values():
            for f in filters:
                counts[f] = counts.get(f, 0) + 1
        best = max(counts, key=lambda f: (counts[f], f))
        chosen.append(best)
        uncovered = {k: v for k, v in uncovered.items() if best not in v}
    return chosen


def _crawl_over_ranking(conn: sqlite3.Connection, client, mix: str, filters: list[str]) -> dict:
    pages = charts_seen = new_hashes = 0
    errors: list[str] = []
    for f in filters:
        page, max_page = 1, 1
        while page <= max_page:
            html = client.get_page(f"/leaderboard/over_ranking.php?lv={f}&search=&&page={page}")
            result = parse_over_ranking(html, page)
            max_page = result.max_page
            ts = now()
            with conn:
                for ch in result.charts:
                    if not ch.jacket_hash:
                        errors.append(f"자켓 해시 없음: {ch.song_name}")
                        continue
                    new_hashes += catalog.upsert_piugame_song(conn, mix, ch.jacket_hash, ch.song_name,
                                                              ch.jacket_url, "over_ranking", ts)
                    catalog.add_piugame_chart(conn, mix, ch.jacket_hash, ch.chart_type, ch.level)
            errors += result.errors
            pages += 1
            charts_seen += len(result.charts)
            log.info("Over Lv.20 [lv=%s] %d/%d 페이지 (채보 %d개, 새 곡 %d개)",
                     f or "전체", page, max_page, charts_seen, new_hashes)
            page += 1
    return {"filters": filters, "pages": pages, "charts_seen": charts_seen, "new_piugame_songs": new_hashes,
            "parse_errors": errors}


def sync_catalog(conn: sqlite3.Connection, full: bool = False, user_id: int = config.DEFAULT_USER_ID,
                 mix: str = config.MIX) -> dict:
    token = config.piu_scores_token()
    if not token:
        raise PiuScoresError(".env에 PIU_SCORES_TOKEN이 없음")
    run_id = runs.start_run(conn, "catalog")
    summary: dict = {"full": full}
    try:
        piuscores = PiuScoresClient(token)
        summary["piuscores"] = _sync_piuscores(conn, piuscores, mix)
        summary["cdn_sizes_checked"] = _sync_cdn_sizes(conn, piuscores, mix)

        needs = catalog.songs_needing_ko(conn, mix)
        filters = [""] if full else _choose_filters(needs)
        log.info("한국어 곡명이 필요한 곡: %d개 → Over Lv.20 필터: %s",
                 len(needs), ", ".join(f or "전체" for f in filters) or "(건너뜀)")

        client = None
        if filters or catalog.unmatched_piugame_songs(conn, mix):
            client, _ = open_session(user_id)
        if filters:
            summary["over_ranking"] = _crawl_over_ranking(conn, client, mix, filters)
        else:
            summary["over_ranking"] = "skipped"

        if client is not None:
            m = match_pending(conn, mix, client, piuscores)
            summary["matching"] = {"by_manual": m.by_manual, "by_sha": m.by_sha,
                                   "piugame_jackets_downloaded": m.jackets_downloaded,
                                   "cdn_jackets_downloaded": m.cdn_downloaded}
            summary["piugame_requests"] = client.request_count

        # 찾아본 필터에서도 한국어 곡명을 못 찾은 곡은 다음부터 다시 찾지 않는다(--full이면 다시 찾는다).
        if filters:
            still = catalog.songs_needing_ko(conn, mix)
            searched = [sid for sid, fs in still.items() if full or fs & set(filters)]
            with conn:
                catalog.mark_ko_checked(conn, searched, now())
            summary["songs_ko_not_found"] = len(searched)

        summary["stats"] = catalog.catalog_stats(conn, mix)
        summary["unmatched"] = [dict(hash=r["piugame_hash"], name_ko=r["name_ko"], reason=r["match_note"])
                                for r in catalog.unmatched_piugame_songs(conn, mix)]
        summary["hash_conflicts"] = catalog.hash_conflicts(conn, mix)
        runs.finish_run(conn, run_id, "ok", summary)
        return summary
    except BaseException as e:
        summary["error"] = redactor(f"{type(e).__name__}: {e}")
        runs.finish_run(conn, run_id, "failed", summary)
        raise
