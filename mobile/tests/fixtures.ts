// 테스트용 HTML 조각. Python 테스트(tests/helpers.py)와 같은 구조(실제 piugame.com 응답 기준).

const STEP = "https://piugame.com/l_img/p2/stepball/full";

export function stepball(kind: string, level: number): string {
  const digits = [...String(level)].map((d) => `<div class="imG"><img src="${STEP}/${kind}_num_${d}.png" alt=""></div>`).join("");
  return `<div class="stepBall_img_wrap"><div class="stepBall_in"><div class="tw"><img src="${STEP}/${kind}_text.png" alt=""></div><div class="numw">${digits}</div></div></div>`;
}

export const jacket = (h: string) => `https://piugame.com/data/song_img2/${h}.png?v=20260903133210`;

export function card(o: {
  name: string; hash: string; kind: string; level: number; score: string;
  grade?: string; plate?: string; date?: string; judgements?: number[];
}): string {
  const gradeSrc = o.grade ? `https://piugame.com/l_img/p2/grade/${o.grade}.png` : "";
  const plateLi = o.plate ? `<li><div class="li_in"><img src="https://piugame.com/l_img/p2/plate/${o.plate}.png" alt=""></div></li>` : "";
  const table = o.judgements
    ? `<table><tbody><tr>${["PERFECT", "GREAT", "GOOD", "BAD", "MISS"]
        .map((k, i) => `<td data-th="${k}"><div class="tx">${o.judgements![i].toLocaleString("en-US")}</div></td>`).join("")}</tr></tbody></table>`
    : "";
  return `<li><div class="wrap_in">
    <div class="in bgfix" style="background-image:url('${jacket(o.hash)}')">
      <div class="song_name flex"><i class="xi"></i><p>${o.name}</p></div>
      <ul class="list"><li><div class="li_in">${stepball(o.kind, o.level)}</div></li>
        <li><div class="li_in ac"><img src="${gradeSrc}" alt=""><i class="tx">${o.score}</i></div></li>${plateLi}</ul>
      ${table}
    </div>
    <div class="in2"><p class="recently_date_tt">${o.date ?? "2026-08-27 17:09:00"} (GMT+9)</p></div>
  </div></li>`;
}

export function page(cards: string[], lastPage = 1, total?: number): string {
  const totalHtml = total ? `<div class="left total_wrap"><i class="tt t1">Total.</i><i class="tt t2">${total}</i></div>` : "";
  return `<html><body><div class="login_wrap"><a href="https://piugame.com/bbs/logout.php">로그아웃</a></div>${totalHtml}
    <ul class="recently_playeList flex wrap">${cards.join("")}</ul>
    <button onclick="location.href='?&&amp;page=${lastPage}'"><i class="xi last"></i></button></body></html>`;
}
