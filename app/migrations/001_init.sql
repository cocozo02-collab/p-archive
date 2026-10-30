-- 사용자. 지금은 id=1 한 명. 다중 사용자로 바뀌어도 기록 테이블은 그대로 쓴다.
CREATE TABLE users (
    id           INTEGER PRIMARY KEY,
    display_name TEXT NOT NULL,
    game_tag     TEXT,
    created_at   TEXT NOT NULL
);

-- 공유 카탈로그: PIU Scores API에서 받은 곡. PIU Scores v2 곡에는 ID가 없고 이름이 믹스 안에서 고유하다.
CREATE TABLE songs (
    id                  INTEGER PRIMARY KEY,
    mix                 TEXT NOT NULL,
    name_en             TEXT NOT NULL,
    artist              TEXT,
    bpm_min             REAL,
    bpm_max             REAL,
    song_type           TEXT,
    channel             TEXT,
    duration_seconds    INTEGER,
    piuscores_image_url TEXT,
    cdn_size            INTEGER,  -- piuscores_image_url의 Content-Length (HEAD 결과 캐시)
    cdn_size_url        TEXT,     -- cdn_size를 확인한 URL. 이미지 URL이 바뀌면 다시 확인한다
    cdn_sha256          TEXT,
    cdn_jacket_path     TEXT,
    synced_at           TEXT NOT NULL,
    UNIQUE (mix, name_en)
);

-- 공유 카탈로그: 채보. CoOp의 level은 인원수(2~5).
CREATE TABLE charts (
    id                 INTEGER PRIMARY KEY,
    song_id            INTEGER NOT NULL REFERENCES songs (id),
    mix                TEXT NOT NULL,
    piuscores_chart_id TEXT NOT NULL UNIQUE,
    chart_type         TEXT NOT NULL,  -- Single / Double / CoOp
    level              INTEGER NOT NULL,
    note_count         INTEGER,
    step_artist        TEXT,
    synced_at          TEXT NOT NULL
);
CREATE INDEX charts_by_song ON charts (song_id, chart_type, level);
CREATE INDEX charts_by_level ON charts (mix, chart_type, level);

-- piugame 쪽 곡. piugame_hash는 자켓 파일명(song_img2/<hash>.png). 자켓이 바뀌면 해시도 바뀌므로
-- 같은 song_id에 해시가 여러 개 생길 수 있다(기록은 song_id로 묶어서 본다).
CREATE TABLE piugame_songs (
    mix           TEXT NOT NULL,
    piugame_hash  TEXT NOT NULL,
    name_ko       TEXT,
    jacket_url    TEXT,
    jacket_path   TEXT,
    jacket_size   INTEGER,
    jacket_sha256 TEXT,
    song_id       INTEGER REFERENCES songs (id),
    match_method  TEXT,           -- sha / manual
    match_note    TEXT,           -- 미매칭 사유 등
    source        TEXT NOT NULL,  -- over_ranking / records
    first_seen_at TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    PRIMARY KEY (mix, piugame_hash)
);
CREATE INDEX piugame_songs_by_song ON piugame_songs (song_id);

-- piugame에서 본 채보 구성(타입+레벨). 같은 크기·해시 후보가 여럿일 때 채보 구성으로 가린다.
CREATE TABLE piugame_charts (
    mix          TEXT NOT NULL,
    piugame_hash TEXT NOT NULL,
    chart_type   TEXT NOT NULL,
    level        INTEGER NOT NULL,
    PRIMARY KEY (mix, piugame_hash, chart_type, level)
);

-- 20레벨 이상 채보가 있지만 Over Lv.20 Ranking에서 한국어 곡명을 찾지 못한 곡. 매번 다시 찾지 않는다.
CREATE TABLE songs_ko_checked (
    song_id    INTEGER PRIMARY KEY REFERENCES songs (id),
    checked_at TEXT NOT NULL
);

-- 사용자별 최고 기록(piugame 최고 기록 목록 기준 + 최근 플레이로 보완).
-- status: pass / broken(끝까지 쳤지만 실패) / stage_break(중단, 점수 없음)
CREATE TABLE records (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users (id),
    mix          TEXT NOT NULL,
    piugame_hash TEXT NOT NULL,
    chart_type   TEXT NOT NULL,
    level        INTEGER NOT NULL,
    score        INTEGER,
    grade        TEXT,
    plate        TEXT,
    status       TEXT NOT NULL,
    played_at    TEXT,
    source       TEXT NOT NULL,  -- best_list / recent_play(최근 플레이로 보완)
    updated_at   TEXT NOT NULL,
    UNIQUE (user_id, mix, piugame_hash, chart_type, level)
);

-- 최근 플레이(판정 수 포함). piugame은 최근 약 50개만 보여주므로 받을 때마다 쌓는다.
CREATE TABLE plays (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users (id),
    mix          TEXT NOT NULL,
    piugame_hash TEXT NOT NULL,
    chart_type   TEXT NOT NULL,
    level        INTEGER NOT NULL,
    score        INTEGER,
    grade        TEXT,
    plate        TEXT,
    status       TEXT NOT NULL,
    perfect      INTEGER NOT NULL,
    great        INTEGER NOT NULL,
    good         INTEGER NOT NULL,
    bad          INTEGER NOT NULL,
    miss         INTEGER NOT NULL,
    played_at    TEXT NOT NULL,
    fetched_at   TEXT NOT NULL,
    UNIQUE (user_id, mix, piugame_hash, chart_type, level, played_at)
);

CREATE TABLE sync_runs (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER REFERENCES users (id),
    kind        TEXT NOT NULL,  -- catalog / records
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    status      TEXT NOT NULL,  -- running / ok / failed
    summary     TEXT            -- JSON
);
