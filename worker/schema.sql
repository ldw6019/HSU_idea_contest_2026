-- HSU PLUS Worker 저장소 (Cloudflare D1)
-- 적용: npx wrangler d1 execute hsuplus --file=worker/schema.sql
CREATE TABLE IF NOT EXISTS counters (
  k   TEXT PRIMARY KEY,   -- 예: ask:2026-10-14:<설치ID>, cost:2026-10-14
  n   INTEGER NOT NULL,
  exp INTEGER NOT NULL    -- 만료(유닉스 초)
);
CREATE TABLE IF NOT EXISTS classify (
  hash       TEXT PRIMARY KEY, -- sha256(프로그램 번호 + 안내문 본문)
  program_id TEXT NOT NULL,
  result     TEXT NOT NULL,    -- 분류 결과 JSON
  model      TEXT NOT NULL,
  created    INTEGER NOT NULL
);
