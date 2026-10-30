#!/usr/bin/env bash
# 릴리스 빌드와 GitHub 릴리스 업로드 (Git Bash에서 실행).
#
#   mobile/scripts/release.sh app        서명된 APK를 빌드해 v<버전> 릴리스에 p-archive.apk로 올린다
#   mobile/scripts/release.sh catalog    export/catalog/catalog.json을 catalog-<YYYYMMDDHHmm> 릴리스로 올린다
#   DRY_RUN=1 mobile/scripts/release.sh app   빌드까지만 하고 업로드하지 않는다
#
# 준비: gh CLI 로그인(gh auth login), 서명 정보 ~/.p-archive/signing.properties, JDK 21(JAVA_HOME).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MOBILE="$ROOT/mobile"
OUT="$ROOT/export/release"
mkdir -p "$OUT"

case "${1:-}" in
  app)
    VERSION="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$MOBILE/package.json")"
    GRADLE_VERSION="$(sed -n 's/.*versionName "\(.*\)".*/\1/p' "$MOBILE/android/app/build.gradle")"
    if [ "$VERSION" != "$GRADLE_VERSION" ]; then
      echo "버전이 다름: package.json $VERSION / build.gradle $GRADLE_VERSION" >&2
      exit 1
    fi
    [ -f "${P_ARCHIVE_SIGNING:-$HOME/.p-archive/signing.properties}" ] || { echo "서명 정보가 없음 (~/.p-archive/signing.properties)" >&2; exit 1; }
    THUMBS="$(ls "$ROOT/export/catalog/jackets" 2>/dev/null | wc -l)"
    [ "$THUMBS" -gt 0 ] || { echo "APK에 넣을 썸네일이 없음: scripts/export_catalog.py --with-thumbnails 먼저" >&2; exit 1; }
    (cd "$MOBILE" && npm run sync)
    (cd "$MOBILE/android" && ./gradlew assembleRelease --no-daemon -q)
    cp "$MOBILE/android/app/build/outputs/apk/release/app-release.apk" "$OUT/p-archive.apk"
    cp "$OUT/p-archive.apk" "$OUT/p-archive-$VERSION.apk"
    echo "빌드 완료: $OUT/p-archive.apk (v$VERSION)"
    [ "${DRY_RUN:-}" = "1" ] && exit 0
    # 자산 이름을 p-archive.apk로 고정해 두면 .../releases/latest/download/p-archive.apk가 항상 최신 APK를 가리킨다.
    gh release create "v$VERSION" "$OUT/p-archive.apk" --title "P-ARCHIVE $VERSION" --notes "P-ARCHIVE $VERSION"
    ;;
  catalog)
    FILE="$ROOT/export/catalog/catalog.json"
    [ -f "$FILE" ] || { echo "카탈로그가 없음: $FILE (scripts/export_catalog.py 먼저)" >&2; exit 1; }
    STAMP="$(node -e "const d=new Date(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).generated_at);const p=n=>String(n).padStart(2,'0');console.log(''+d.getUTCFullYear()+p(d.getUTCMonth()+1)+p(d.getUTCDate())+p(d.getUTCHours())+p(d.getUTCMinutes()))" "$(cygpath -m "$FILE" 2>/dev/null || echo "$FILE")")"
    echo "곡 목록 릴리스: catalog-$STAMP"
    [ "${DRY_RUN:-}" = "1" ] && exit 0
    gh release create "catalog-$STAMP" "$FILE" --title "곡 목록 $STAMP" --notes "곡 목록 업데이트 (catalog.json)" --latest=false
    ;;
  *)
    echo "사용법: $0 app|catalog" >&2
    exit 1
    ;;
esac
