"""앱용 카탈로그 내보내기 (sync_catalog 다음에 실행).

  python scripts/export_catalog.py                 export/catalog/ 에 catalog.json + jackets/*.webp
  python scripts/export_catalog.py --size 160 --quality 75
"""

import argparse
import logging
import sys

import _cli

log_file = _cli.init("export_catalog")

from app.db import connect  # noqa: E402
from app.export import export_catalog  # noqa: E402


def kb(n: int) -> str:
    return f"{n / 1024:,.0f} KB" if n < 1024 * 1024 else f"{n / 1024 / 1024:,.2f} MB"


def main() -> int:
    parser = argparse.ArgumentParser(description="앱용 카탈로그 내보내기")
    parser.add_argument("--size", type=int, default=192, help="썸네일 한 변(px), 기본 192")
    parser.add_argument("--quality", type=int, default=80, help="WebP 품질, 기본 80")
    args = parser.parse_args()

    try:
        r = export_catalog(connect(), thumb_size=args.size, quality=args.quality)
    except Exception:
        logging.getLogger("export_catalog").exception("내보내기 실패")
        return 1

    print("\n== 앱용 카탈로그 ==")
    print(f"위치: {r['out_dir']}")
    print(f"곡 {r['songs']}개 (한국어 곡명 {r['songs_with_name_ko']}개) / 채보 {r['charts']}개 / piugame 해시 {r['piugame_songs']}개")
    print(f"catalog.json: {kb(r['catalog_json_bytes'])} (gzip {kb(r['catalog_json_gzip_bytes'])})")
    print(f"썸네일: {r['thumbnails']}장, 합계 {kb(r['thumbnails_bytes'])}"
          f" (평균 {kb(r['thumbnails_bytes'] // max(r['thumbnails'], 1))})")
    _cli.print_list("자켓 없는 곡", r["missing_jackets"], str)
    print(f"\n로그: {log_file}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
