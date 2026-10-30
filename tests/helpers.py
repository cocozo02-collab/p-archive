"""테스트용 HTML 조각과 임시 DB. HTML 구조는 실제 piugame.com 응답(2026-10-30)과 PIU Scores 픽스처를 따른다."""

import tempfile
from pathlib import Path

from app import config, db

STEP = "https://piugame.com/l_img/p2/stepball/full"


def stepball(kind: str, level: int) -> str:
    digits = "".join(f'<div class="imG"><img src="{STEP}/{kind}_num_{d}.png" alt=""></div>' for d in str(level))
    return (f'<div class="stepBall_img_wrap"><div class="stepBall_in"><div class="tw">'
            f'<img src="{STEP}/{kind}_text.png" alt=""></div><div class="numw">{digits}</div></div></div>')


def jacket(h: str) -> str:
    return f"https://piugame.com/data/song_img2/{h}.png?v=20260903133210"


def best_card(name: str, h: str, kind: str, level: int, score: str, grade: str | None, plate: str | None,
              date: str = "2026-08-27 17:09:00") -> str:
    grade_src = f"https://piugame.com/l_img/p2/grade/{grade}.png" if grade else ""
    plate_li = (f'<li><div class="li_in"><img src="https://piugame.com/l_img/p2/plate/{plate}.png" alt=""></div></li>'
                if plate else "")
    return f"""
    <li><div class="wrap_in">
      <div class="in bgfix" style="background-image:url('{jacket(h)}')">
        <div class="song_name flex"><i class="xi"></i><p>{name}</p></div>
        <ul class="list"><li><div class="li_in">{stepball(kind, level)}</div></li>
          <li><div class="li_in ac"><img src="{grade_src}" alt=""><i class="tx">{score}</i></div></li>{plate_li}
        </ul>
      </div>
      <div class="in2"><p class="recently_date_tt">{date} (GMT+9)</p></div>
    </div></li>"""


def best_page(cards: list[str], last_page: int = 1, total: int | None = None) -> str:
    total_html = f'<div class="left total_wrap"><i class="tt t1">Total.</i><i class="tt t2">{total}</i></div>' if total else ""
    return (f'<html><body><a href="https://piugame.com/bbs/logout.php">로그아웃</a>{total_html}'
            f'<ul class="recently_playeList flex wrap">{"".join(cards)}</ul>'
            f'<button onclick="location.href=\'?&&amp;page={last_page}\'"><i class="xi last"></i></button></body></html>')


def ranking_item(name: str, h: str, kind: str, level: int) -> str:
    return f"""<div class="li_in"><a class="in" href="over_ranking_view.php?no=abc">
      <div class="songImg_w"><div class="in_img"><div class="re img bgfix" style="background-image:url('{jacket(h)}')"></div></div></div>
      <div class="songName_w"><p class="tt">{name}</p></div><div class="level_w">{stepball(kind, level)}</div></a></div>"""


def ranking_page(items: list[str], last_page: int) -> str:
    return (f'<html><body><a href="https://piugame.com/bbs/logout.php">로그아웃</a>'
            f'<ul class="rating_ranking_list">{"".join(f"<li>{i}</li>" for i in items)}</ul>'
            f'<button onclick="location.href=\'?lv=&search=&&page={last_page}\'"><i class="xi last"></i></button>'
            f'</body></html>')


class TempData:
    """config의 데이터 경로를 임시 폴더로 바꾸고 새 DB를 연다."""

    def __enter__(self):
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)
        self._saved = {k: getattr(config, k) for k in
                       ("DATA_DIR", "JACKETS_PIUGAME_DIR", "JACKETS_CDN_DIR", "MANUAL_SONG_MAP")}
        config.DATA_DIR = root
        config.JACKETS_PIUGAME_DIR = root / "jackets" / "piugame"
        config.JACKETS_CDN_DIR = root / "jackets" / "cdn"
        config.MANUAL_SONG_MAP = root / "manual_song_map.json"
        self.root = root
        self.conn = db.connect(root / "test.db")
        return self

    def __exit__(self, *exc):
        self.conn.close()
        for k, v in self._saved.items():
            setattr(config, k, v)
        self._tmp.cleanup()
