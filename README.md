# P-archive

펌프잇업 Phoenix 2 기록을 레벨별 기록표로 보는 도구.

- **PC (Python, 이 저장소)**: 곡 목록 동기화와 앱용 카탈로그(곡·채보·한국어 곡명·자켓 썸네일) 내보내기.
- **안드로이드 앱 (`mobile/`)**: 각자 폰에서 piugame.com에 로그인해 자기 기록을 받아 보여준다.
  최고 기록이 바뀔 때마다 이력을 남기고, 갱신마다 공식 PUMBILITY를 저장한다.
  piugame.com은 최근 플레이를 약 50개만 보여주므로 앱은 갱신할 때마다 최근 플레이를 중복 없이 쌓아 둔다.

## 설치 (Windows, PowerShell)

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
Copy-Item .env.example .env   # PIU_ID / PIU_PASSWORD / PIU_SCORES_TOKEN 입력 후 저장
```

PIU Scores 토큰: https://piuscores.arroweclip.se 로그인 → 오른쪽 위 아바타 → 나의 계정 → API 탭 → Copy Token.
(New Token을 누르면 이전 토큰은 바로 무효가 된다.)

## 곡 목록 동기화 → 앱용 카탈로그

```powershell
.venv\Scripts\python scripts\sync_catalog.py          # PIU Scores 곡·채보 + 필요한 경우만 Over Lv.20 Ranking(한국어 곡명) + 자켓 매칭
.venv\Scripts\python scripts\sync_catalog.py --full   # Over Lv.20 Ranking 전체를 다시 받음
.venv\Scripts\python scripts\export_catalog.py        # export/catalog/catalog.json + jackets/*.webp
```

- 첫 동기화는 piugame.com 요청 약 660회(1.5초 간격, 약 17분). 이후에는 한국어 곡명이 필요한 새 곡이 있을 때만 piugame에 요청한다.
- 곡 매칭: 수동 매핑(`seeds/manual_song_map.json`, 지정 시 우선) → 자켓 내용 해시(크기로 후보를 좁힌 뒤 SHA-256 비교).
- 자켓 원본은 `data/jackets/`에 캐시되므로 중간에 끊겨도 다시 실행하면 이어서 한다.
- 진행 로그: `data/logs/`.

## 검증용 스크립트

```powershell
.venv\Scripts\python scripts\verify_crawler.py                  # 로그인 → 게임카드/최고 기록/최근 플레이 출력
.venv\Scripts\python scripts\verify_crawler.py --check-session  # 저장된 세션이 아직 유효한지 확인
.venv\Scripts\python scripts\sync_records.py                    # 내 기록을 PC DB에 저장 (앱 로직 검증용)
.venv\Scripts\python -m unittest discover -s tests -t .         # 테스트
```

## 데이터 위치 (모두 .gitignore 대상)

| 경로 | 내용 |
|---|---|
| `data/p-archive.db` | SQLite (스키마: `app/migrations/`) |
| `data/sessions/user_<id>.json` | 사용자별 piugame 세션 쿠키 (비밀번호는 저장하지 않음) |
| `data/jackets/` | 자켓 원본 캐시 |
| `data/html/`, `data/logs/` | 받은 HTML(진단용), 로그 |
| `export/catalog/` | 앱용 카탈로그 |

경로는 `.env`의 `DATA_DIR`, `DB_PATH`로 바꿀 수 있다.

## 보안

- 비밀번호는 저장하지 않는다. `.env`에서 읽거나 실행할 때 입력받는다.
- 비밀번호, sid, PIU Scores 토큰은 로그·예외 메시지·트레이스백에서 `***`로 가려진다(`app/redact.py`).
- piugame.com은 중간 인증서를 보내지 않는다. `certs/sectigo-dv-r36.pem`(Sectigo Public Server Authentication CA DV R36,
  SHA-256 `8C:54:C3:34:…:A4:EF:22:E0`, 2036-03-21 만료)을 certifi 번들에 더해 검증한다. 검증을 끄지 않는다.
