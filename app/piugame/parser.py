"""piugame.com my_page HTML 파서.

선택자와 이미지 파일명 규칙은 PIU Scores(DrMurloc/PumpItUpScoreTracker)의
ScoreTracker.OfficialMirror/Infrastructure/Apis/PiuGameApi.cs와 그 HTML 픽스처를 따른다.
"""

import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from bs4 import BeautifulSoup, Tag

# 레벨 숫자와 타입은 스텝볼 이미지 파일명에 들어 있다. Phoenix 2는 경로에 /p2/가 붙는다.
LEVEL_DIGIT_RE = re.compile(r"/stepball/full/[a-z]+_num_(\d)\.png", re.I)
TYPE_RE = re.compile(r"/stepball/full/([a-z]+)_text\.png", re.I)
GRADE_RE = re.compile(r"/grade/([a-z_]+)\.png", re.I)
PLATE_RE = re.compile(r"/plate/(?:s_)?([a-z]+)\.png", re.I)
JACKET_RE = re.compile(r"url\(['\"]?([^'\")]*/data/song_img2?/[^'\")]+)['\"]?\)")
PLAYED_AT_RE = re.compile(r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s*\(GMT([+-]\d{1,2})\)")
PAGE_RE = re.compile(r"page=(\d+)")
NUMBER_RE = re.compile(r"\d[\d,]*")

JACKET_HASH_RE = re.compile(r"/data/song_img2?/([0-9a-f]{32})\.", re.I)

# PIU Scores API의 type 값과 같게 쓴다.
CHART_TYPES = {"s": "Single", "d": "Double", "c": "CoOp"}
GRADES = {
    "f": "F", "d": "D", "c": "C", "b": "B", "a": "A", "a_p": "A+",
    "aa": "AA", "aa_p": "AA+", "aaa": "AAA", "aaa_p": "AAA+",
    "s": "S", "s_p": "S+", "ss": "SS", "ss_p": "SS+", "sss": "SSS", "sss_p": "SSS+",
}
PLATES = {"pg", "ug", "eg", "sg", "mg", "tg", "fg", "rg"}

# 1948 D29는 Phoenix 2에서 숫자 이미지 없이 "??" 스텝볼로 나온다. PIU Scores는 29로 본다.
UNREADABLE_LEVEL = 29


class ParseError(Exception):
    pass


@dataclass
class ChartScore:
    song_name: str
    chart_type: str  # Single / Double / CoOp
    level: int
    score: int | None  # 스테이지 브레이크면 None (표시되는 숫자는 중간 점수라 저장하지 않는다)
    grade: str | None  # SSS+ ~ F. 스테이지 브레이크면 None
    plate: str | None  # PG ~ RG. 브레이크오프면 None
    is_broken: bool  # 클리어 실패 (플레이트 없음)
    is_stage_break: bool  # 마지막 노트 전에 중단됨
    played_at: datetime | None
    jacket_url: str | None

    @property
    def jacket_hash(self) -> str | None:
        return jacket_hash(self.jacket_url)

    @property
    def status(self) -> str:
        return "stage_break" if self.is_stage_break else "broken" if self.is_broken else "pass"


@dataclass
class RecentPlay(ChartScore):
    perfect: int = 0
    great: int = 0
    good: int = 0
    bad: int = 0
    miss: int = 0


@dataclass
class BestScorePage:
    scores: list[ChartScore]
    max_page: int
    total_charts: int | None
    skipped_ucs: int = 0
    errors: list[str] = field(default_factory=list)


@dataclass
class GameCard:
    game_tag: str
    sub_profile_id: str
    is_main: bool


@dataclass
class RankingChart:
    """Over Lv.20 Ranking의 한 항목(채보 하나)."""
    song_name: str
    chart_type: str
    level: int
    jacket_url: str | None

    @property
    def jacket_hash(self) -> str | None:
        return jacket_hash(self.jacket_url)


@dataclass
class RankingPage:
    charts: list[RankingChart]
    max_page: int
    errors: list[str] = field(default_factory=list)


def jacket_hash(url: str | None) -> str | None:
    match = JACKET_HASH_RE.search(url or "")
    return match.group(1).lower() if match else None


def _soup(html: str) -> BeautifulSoup:
    return BeautifulSoup(html, "html.parser")


def is_logged_in(html: str) -> bool:
    """공통 헤더에 로그아웃 링크가 있으면 로그인된 페이지다.

    .login_wrap은 로그인 여부와 상관없이 모든 페이지 헤더에 들어 있어서 판정에 쓸 수 없다
    (로그인 상태에서는 그 안에 Log Out 링크가 들어간다. PIU Scores AvatarCatalogReconTests 참고).
    """
    return _soup(html).select_one('a[href*="bbs/logout.php"]') is not None


def has_classic_best_layout(html: str) -> bool:
    return _soup(html).select_one("ul.my_best_scoreList") is not None


def _chart_type(card: Tag) -> str | None:
    """Single/Double/Co-op. UCS(u_text)와 알 수 없는 타입은 None."""
    img = card.select_one(".stepBall_img_wrap .tw img")
    match = TYPE_RE.search(img.get("src", "")) if img else None
    return CHART_TYPES.get(match.group(1).lower()) if match else None


def _is_ucs(card: Tag) -> bool:
    img = card.select_one(".stepBall_img_wrap .tw img")
    return img is not None and "u_text" in img.get("src", "").lower()


def _level(card: Tag) -> int:
    digits = ""
    for img in card.select(".stepBall_img_wrap .numw img"):
        match = LEVEL_DIGIT_RE.search(img.get("src", ""))
        if match:
            digits += match.group(1)
    return int(digits) if digits else UNREADABLE_LEVEL


def _played_at(card: Tag) -> datetime | None:
    node = card.select_one("p.recently_date_tt")
    match = PLAYED_AT_RE.search(node.get_text()) if node else None
    if not match:
        return None
    tz = timezone(timedelta(hours=int(match.group(2))))
    return datetime.strptime(match.group(1), "%Y-%m-%d %H:%M:%S").replace(tzinfo=tz)


def _jacket_url(card: Tag, selector: str = "div.in.bgfix") -> str | None:
    node = card.select_one(selector)
    match = JACKET_RE.search(node.get("style", "")) if node else None
    return match.group(1) if match else None


def _parse_card(card: Tag, cls=ChartScore, **extra) -> ChartScore:
    song = card.select_one(".song_name p")
    chart_type = _chart_type(card)
    if song is None or chart_type is None:
        raise ParseError("곡명이나 채보 타입을 찾지 못함")

    score_cell = card.select_one("div.li_in.ac")
    score_text = score_cell.select_one("i.tx").get_text(strip=True) if score_cell else ""
    grade_img = score_cell.find("img", recursive=False) if score_cell else None
    grade_src = grade_img.get("src", "") if grade_img else ""

    plate = None
    for img in card.select("div.li_in > img"):
        match = PLATE_RE.search(img.get("src", ""))
        if match and match.group(1).lower() in PLATES:
            plate = match.group(1).upper()
            break

    # 플레이트가 없으면 브레이크오프. 그중 등급 이미지가 비었거나 STAGE BREAK라고 나오면 스테이지 브레이크다.
    is_broken = plate is None
    is_stage_break = is_broken and (score_text == "STAGE BREAK" or (grade_img is not None and not grade_src.strip()))

    grade = None
    grade_match = GRADE_RE.search(grade_src)
    if grade_match and not is_stage_break:
        stem = grade_match.group(1).lower()
        # 클리어 실패한 플레이는 같은 등급 이미지에 x_ 접두사가 붙는다.
        grade = GRADES.get(stem[2:] if stem.startswith("x_") else stem)

    score = None if is_stage_break else int(score_text.replace(",", ""))

    return cls(
        song_name=song.get_text(strip=True),  # BeautifulSoup가 HTML 엔티티를 디코딩해 준다
        chart_type=chart_type,
        level=_level(card),
        score=score,
        grade=grade,
        plate=plate,
        is_broken=is_broken,
        is_stage_break=is_stage_break,
        played_at=_played_at(card),
        jacket_url=_jacket_url(card),
        **extra,
    )


def _max_page(soup: BeautifulSoup, current: int) -> int:
    last = soup.select_one("i.last")
    if last is None or last.parent is None:
        return current
    match = PAGE_RE.search(last.parent.get("onclick", ""))
    return int(match.group(1)) if match else current


def _total_charts(soup: BeautifulSoup) -> int | None:
    wrap = soup.select_one(".total_wrap")
    match = NUMBER_RE.search(wrap.get_text()) if wrap else None
    return int(match.group(0).replace(",", "")) if match else None


def parse_best_scores(html: str, page: int = 1) -> BestScorePage:
    """my_page/my_best_score.php. Phoenix 2 개편 레이아웃(최근 플레이 카드 재사용)만 지원한다."""
    soup = _soup(html)
    if soup.select_one("ul.my_best_scoreList") is not None:
        raise ParseError("예전 레이아웃(my_best_scoreList)이다. Phoenix 2 개편 레이아웃이 아니므로 HTML을 확인해야 함")

    result = BestScorePage(scores=[], max_page=_max_page(soup, page), total_charts=_total_charts(soup))
    for card in soup.select("ul.recently_playeList > li"):
        if _is_ucs(card):
            result.skipped_ucs += 1
            continue
        try:
            result.scores.append(_parse_card(card))
        except (ParseError, ValueError, AttributeError) as e:
            result.errors.append(f"{type(e).__name__}: {e}")
    return result


def _judgement(card: Tag, name: str) -> int:
    node = card.select_one(f'td[data-th="{name}"] div')
    if node is None:
        raise ParseError(f"{name} 판정 칸을 찾지 못함")
    return int(node.get_text(strip=True).replace(",", ""))


def parse_recent_plays(html: str) -> tuple[list[RecentPlay], list[str]]:
    """my_page/recently_played.php. 최근 약 50플레이와 판정 수."""
    plays, errors = [], []
    for card in _soup(html).select("ul.recently_playeList > li"):
        if _is_ucs(card):
            continue
        try:
            judgements = {k.lower(): _judgement(card, k) for k in ("PERFECT", "GREAT", "GOOD", "BAD", "MISS")}
            plays.append(_parse_card(card, RecentPlay, **judgements))
        except (ParseError, ValueError, AttributeError) as e:
            errors.append(f"{type(e).__name__}: {e}")
    return plays, errors


def parse_over_ranking(html: str, page: int = 1) -> RankingPage:
    """leaderboard/over_ranking.php. 레벨 20 이상·CO-OP 채보 목록(한국어 곡명, 자켓). PIU Scores Get20AboveSongs 참고."""
    soup = _soup(html)
    result = RankingPage(charts=[], max_page=_max_page(soup, page))
    for item in soup.select("ul.rating_ranking_list div.li_in"):
        if _is_ucs(item):
            continue
        try:
            name = item.select_one(".songName_w p.tt")
            chart_type = _chart_type(item)
            if name is None or chart_type is None:
                raise ParseError("곡명이나 채보 타입을 찾지 못함")
            result.charts.append(RankingChart(
                song_name=name.get_text(strip=True),
                chart_type=chart_type,
                level=_level(item),
                jacket_url=_jacket_url(item, ".songImg_w .bgfix"),
            ))
        except (ParseError, ValueError, AttributeError) as e:
            result.errors.append(f"{type(e).__name__}: {e}")
    return result


def parse_game_cards(html: str) -> list[GameCard]:
    """my_page/game_id_information.php. 계정에 딸린 게임카드(서브 프로필) 목록."""
    soup = _soup(html)
    main = soup.select_one(".subProfile_wrap .name_w p.t2")
    main_tag = main.get_text(strip=True) if main else ""
    cards = []
    for box in soup.select("#profile_modal .in_profile"):
        tag = box.select_one(".name_w p.t2")
        radio = box.select_one('input[name="sub_profile"]')
        if tag and radio and radio.get("value"):
            name = tag.get_text(strip=True)
            cards.append(GameCard(game_tag=name, sub_profile_id=radio["value"], is_main=name == main_tag))
    return cards
