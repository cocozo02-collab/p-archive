# P-ARCHIVE 안드로이드 앱 (Capacitor 8)

웹 화면(Vite + TypeScript)을 Capacitor로 감싼 앱. 화면 사양은 [../docs/UI-SPEC.md](../docs/UI-SPEC.md).

## 요구 사항

- Node.js 22 이상
- JDK 21 (Android Studio의 JBR, 또는 압축판 JDK 21)
- Android SDK: platform 36, build-tools 35 (`android/local.properties`의 `sdk.dir` 또는 `ANDROID_HOME`)

## 빌드

```bash
npm install
npm run sync                      # 웹 빌드 + android/ 에 복사
cd android
# JAVA_HOME이 JDK 21이 아니면 이 터미널에서만 지정한다 (Git Bash 예시)
export JAVA_HOME="$LOCALAPPDATA/p-archive-tools/jdk21/jdk-21.0.13.0.2+1"
./gradlew assembleDebug           # → android/app/build/outputs/apk/debug/app-debug.apk
```

폰이 USB 디버깅으로 연결돼 있으면: `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`

## 저장하는 데이터 (폰 내부 SQLite)

- `records`: 채보별 최고 기록. 바뀔 때마다 이전 값·새 값을 `record_history`에 남긴다(덮어쓰기 전에 기록).
- `plays`: 최근 플레이와 판정 수. **piugame.com은 최근 플레이를 약 50개만 보여주므로**, 앱은 갱신할 때마다
  중복 없이 쌓아 둔다. 갱신 간격이 길어 그사이 50플레이를 넘기면 오래된 플레이는 받을 수 없다.
- `pumbility_history`: 갱신마다 공식 PUMBILITY 값.
- 스키마 변경은 `src/db.ts`의 `MIGRATIONS`에 번호 순서로 추가한다(기존 데이터 유지).

## 자켓 이미지

저장소(소스 코드)에는 자켓 이미지를 넣지 않는다. APK에는 `export_catalog.py --with-thumbnails`로 만든 192px WebP 썸네일
675장(약 5 MB)을 넣는다(`npm run catalog`가 `../export/catalog`를 `public/catalog`로 복사, 둘 다 git 제외).
APK에 없는 곡(이후 곡 목록 업데이트로 추가된 곡 등)은 **화면에 보이는 자켓만** piugame.com에서 받아(요청 간격 1.5초)
192px로 줄여 폰에 캐시한다(`src/jackets.ts`). 주소를 모르는 곡은 곡별 색 타일과 첫 글자로 보여준다.

## 릴리스

서명 키는 저장소 밖에 있다: `~/.p-archive/release.jks` + `~/.p-archive/signing.properties`(비밀번호 포함).
`android/app/build.gradle`이 이 파일을 읽어 릴리스 APK에 서명한다(다른 위치는 환경 변수 `P_ARCHIVE_SIGNING`).

```bash
# 1. package.json "version"과 android/app/build.gradle의 versionName/versionCode를 올린다
# 2. 빌드 + 업로드 (gh auth login 필요)
mobile/scripts/release.sh app
# 곡 목록만 바꿀 때 (scripts/export_catalog.py 다음)
mobile/scripts/release.sh catalog
```

앱은 `src/update.ts`의 `GITHUB_REPO` 저장소에서 `v*` 릴리스의 `p-archive.apk`와 `catalog-*` 릴리스의 `catalog.json`을 확인한다.

### ⚠ 서명 키 백업

**키를 잃어버리면 기존 설치본에 업데이트를 할 수 없다**(같은 키로 서명한 APK만 덮어 설치된다. 다른 키면 지우고 새로 설치해야 하고, 그러면 폰에 쌓인 기록도 지워진다).

- `~/.p-archive/` 폴더 전체(`release.jks`, `signing.properties`)를 **두 곳 이상**에 보관한다.
  예: 비밀번호 관리자(1Password, Bitwarden 등)의 첨부 파일 + USB 메모리, 또는 암호화한 압축 파일을 클라우드 드라이브에.
- `signing.properties`에는 비밀번호가 평문으로 들어 있으니 공개된 곳(이 저장소, 메신저 등)에 올리지 않는다.
- 키 지문(SHA-256): `23:F5:CC:75:2B:1E:92:83:B1:35:AF:37:E8:45:DD:C7:26:B5:DC:D4:87:F1:B6:7B:51:F5:60:D6:30:84:D8:93`
  (`apksigner verify --print-certs p-archive.apk`로 릴리스 APK가 이 키로 서명됐는지 확인할 수 있다)
- 디버그 APK(개발용 키)로 설치한 앱 위에는 릴리스 APK를 덮어 설치할 수 없다. 한 번 지우고 설치해야 한다.

## 메모

- `android/local.properties`는 git에서 제외된다. properties 형식이라 경로의 `\`는 `\\`로 쓴다(`sdk.dir=C\:\\Android`).
- 앱 ID `com.parchive.app`은 지인에게 배포한 뒤에는 바꾸지 않는다.
