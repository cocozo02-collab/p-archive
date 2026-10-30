# P-ARCHIVE

펌프잇업 피닉스 2 기록을 레벨별 기록표로 보는 비공식 안드로이드 앱.

> **안내**: P-ARCHIVE는 안다미로(ANDAMIRO)가 만든 공식 앱이 아니며, 안다미로의 승인을 받거나 제휴한 앱이 아닙니다.
> PUMP IT UP 상표, 곡 정보와 자켓 이미지 등에 대한 권리는 안다미로에 있습니다.
> 이 저장소와 릴리스에는 자켓 이미지가 들어 있지 않습니다. 앱이 piugame.com에서 필요할 때 받아 폰에만 저장합니다.

## 다운로드

[최신 APK 받기](https://github.com/cocozo02-collab/p-archive/releases/latest/download/p-archive.apk) · [모든 릴리스](https://github.com/cocozo02-collab/p-archive/releases)

설치할 때 "출처를 알 수 없는 앱 설치"를 허용해야 합니다. 새 버전이 나오면 앱 안에서 바로 업데이트할 수 있습니다.

## 기능

- **기록표**: 레벨을 고르면 그 레벨 채보가 자켓 타일로 나온다. 등급·플레이트·점수, 이번 갱신에서 오른 기록(▲),
  격자/목록 보기, 점수순·이름순·등급순(등급 구역) 정렬, 곡명 한/영 전환.
- **곡 상세**: 최고 기록, 판정 수(맥스 콤보는 점수와 판정 수로 계산), 점수 변화 그래프, 기록 이력, 플레이 이력.
- **최근 플레이**: 날짜별 플레이와 판정 수, 최고 기록을 세운 플레이(BEST).
- **갱신 결과**: 오른 기록, 새 클리어, PUMBILITY 변화.
- **통계**: PUMBILITY 추이, 레벨별 클리어·등급·플레이트.

## 개인정보와 동작 방식

- 각자 자기 폰에서 piugame.com(AM-PASS 계정)에 로그인해 자기 기록을 받는다. 서버가 따로 없고, 기록은 폰 안(SQLite)에만 저장된다.
- 비밀번호는 기본적으로 저장하지 않는다(로그인 요청에만 쓰고 버린다). "로그인 정보 기억"을 켜면 안드로이드 보안 저장소(Keystore)에 저장된다.
- 앱 데이터는 클라우드 백업에서 제외된다.
- piugame.com에는 "기록 갱신"을 누를 때만 요청하고, 요청 사이에 1.5초 간격을 둔다. 자동으로 주기적으로 가져오지 않는다.
- **piugame.com은 최근 플레이를 약 50개만 보여준다.** 앱은 갱신할 때마다 최근 플레이를 중복 없이 쌓아 두므로,
  갱신 사이에 50플레이를 넘기면 그 사이의 오래된 플레이는 받을 수 없다.
- 최고 기록이 바뀌면 이전 값과 새 값을 이력으로 남기고, 갱신마다 공식 PUMBILITY 값을 저장한다.

## 저장소 구성

| 경로 | 내용 |
|---|---|
| `mobile/` | 안드로이드 앱 (Capacitor 8 + Vite + TypeScript). 빌드 방법은 [mobile/README.md](mobile/README.md) |
| `app/`, `scripts/` | 곡 목록(카탈로그) 동기화·내보내기 도구 (Python, 개발자용) |
| `docs/UI-SPEC.md` | 화면 사양 |

### 곡 목록 도구 (개발자용)

곡·채보 목록과 한국어 곡명을 모아 앱에 넣을 `catalog.json`을 만든다. 실행하려면 `.env` 설정이 필요하다(`.env.example` 참고).

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python scripts\sync_catalog.py      # 곡 목록 동기화 (--full: 한국어 곡명 페이지 전체 다시 받기)
.venv\Scripts\python scripts\export_catalog.py    # export/catalog/catalog.json (자켓 이미지 없음)
.venv\Scripts\python -m unittest discover -s tests -t .
```

- 곡 매칭은 자켓 내용 해시(SHA-256)로 하고, 해시로 안 되는 곡은 `seeds/manual_song_map.json`으로 지정한다.
- 비밀번호, 세션 쿠키, 토큰은 로그와 예외 메시지에서 `***`로 가려진다.
- piugame.com은 중간 인증서를 보내지 않아서 `certs/sectigo-dv-r36.pem`(Sectigo Public Server Authentication CA DV R36,
  SHA-256 `8C:54:C3:34:…:A4:EF:22:E0`)을 더해 검증한다. 인증서 검증을 끄지 않는다.

### 릴리스 (관리자용)

- 앱: 태그 `v<버전>`에 `p-archive.apk`를 첨부한다. 앱은 이 릴리스를 보고 업데이트를 안내한다.
- 곡 목록: 태그 `catalog-<YYYYMMDDHHmm>`(내보낸 시각, UTC)에 `catalog.json`을 첨부한다. 앱이 받아서 바로 적용한다.
- 자세한 순서는 [mobile/README.md](mobile/README.md#릴리스).

## 라이선스

소스 코드는 [MIT](LICENSE). PUMP IT UP 관련 상표와 콘텐츠는 이 라이선스에 포함되지 않는다.
