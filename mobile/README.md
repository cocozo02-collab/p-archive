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

## 메모

- `android/local.properties`는 git에서 제외된다. properties 형식이라 경로의 `\`는 `\\`로 쓴다(`sdk.dir=C\:\\Android`).
- 앱 ID `com.parchive.app`은 지인에게 배포한 뒤에는 바꾸지 않는다.
