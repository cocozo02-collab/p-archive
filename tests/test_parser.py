import unittest

from app.piugame.parser import is_logged_in, parse_best_scores, parse_over_ranking
from tests.helpers import best_card, best_page, ranking_item, ranking_page

H1, H2, H3 = "a" * 32, "b" * 32, "c" * 32


class BestScoresTest(unittest.TestCase):
    def setUp(self):
        html = best_page([
            best_card("굿 나이트", H1, "s", 20, "940,474", "aa_p", "rg"),
            best_card("이렐리아", H2, "s", 22, "123,456", None, None),     # 스테이지 브레이크: 등급 이미지가 빈 칸
            best_card("크로스 소울", H3, "d", 17, "750,105", "x_b", None),  # 실패: x_ 접두사, 플레이트 없음
        ], last_page=4, total=37)
        self.page = parse_best_scores(html, 1)

    def test_page_info(self):
        self.assertEqual((self.page.max_page, self.page.total_charts, self.page.errors), (4, 37, []))

    def test_pass(self):
        s = self.page.scores[0]
        self.assertEqual((s.song_name, s.chart_type, s.level, s.score, s.grade, s.plate, s.status),
                         ("굿 나이트", "Single", 20, 940474, "AA+", "RG", "pass"))
        self.assertEqual(s.jacket_hash, H1)

    def test_stage_break_has_no_score(self):
        s = self.page.scores[1]
        self.assertEqual((s.status, s.score, s.grade), ("stage_break", None, None))

    def test_broken_keeps_real_grade(self):
        s = self.page.scores[2]
        self.assertEqual((s.chart_type, s.status, s.score, s.grade, s.plate), ("Double", "broken", 750105, "B", None))


class OverRankingTest(unittest.TestCase):
    def test_parse(self):
        page = parse_over_ranking(ranking_page([ranking_item("1948", H1, "s", 26), ranking_item("풀 문", H2, "c", 2)],
                                               last_page=128))
        self.assertEqual(page.max_page, 128)
        self.assertEqual([(c.song_name, c.chart_type, c.level, c.jacket_hash) for c in page.charts],
                         [("1948", "Single", 26, H1), ("풀 문", "CoOp", 2, H2)])


class LoginDetectionTest(unittest.TestCase):
    def test_header_login_wrap_is_not_a_login_page(self):
        # .login_wrap은 로그인 상태에서도 모든 페이지 헤더에 있다.
        html = '<div class="login_wrap"><a href="https://piugame.com/bbs/logout.php">Log Out</a></div>'
        self.assertTrue(is_logged_in(html))
        self.assertFalse(is_logged_in('<div class="login_wrap"><form><input name="mb_password"></form></div>'))


if __name__ == "__main__":
    unittest.main()
