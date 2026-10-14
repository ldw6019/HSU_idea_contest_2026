// 저장소: 사용량 카운터 + 비교과 분류 결과(안내문 내용으로 찾는 캐시)
// 실제 배포는 Cloudflare D1(무료: 하루 쓰기 10만 줄). KV는 무료 쓰기가 하루 1,000회라 카운터에 맞지 않음.
// 질문 내용·할 일 목록은 저장하지 않는다 (카운터와 공개 안내문 분류 결과만).

export class D1Store {
  constructor(db) {
    this.db = db;
  }
  /** 카운터 k를 by만큼 올리고 새 값 돌려줌. exp(초)가 지나면 0부터 다시 */
  async incr(k, by, ttlSec) {
    const now = Math.floor(Date.now() / 1000);
    const row = await this.db
      .prepare(
        `INSERT INTO counters (k, n, exp) VALUES (?1, ?2, ?3)
         ON CONFLICT(k) DO UPDATE SET n = CASE WHEN counters.exp < ?4 THEN ?2 ELSE counters.n + ?2 END,
                                      exp = CASE WHEN counters.exp < ?4 THEN ?3 ELSE counters.exp END
         RETURNING n`
      )
      .bind(k, by, now + ttlSec, now)
      .first();
    return row?.n ?? by;
  }
  async peek(k) {
    const now = Math.floor(Date.now() / 1000);
    const row = await this.db.prepare(`SELECT n FROM counters WHERE k = ?1 AND exp >= ?2`).bind(k, now).first();
    return row?.n ?? 0;
  }
  async getClassify(hash) {
    const row = await this.db.prepare(`SELECT result, model, created FROM classify WHERE hash = ?1`).bind(hash).first();
    return row ? { result: JSON.parse(row.result), model: row.model, created: row.created } : null;
  }
  async putClassify(hash, programId, result, model) {
    await this.db
      .prepare(`INSERT OR REPLACE INTO classify (hash, program_id, result, model, created) VALUES (?1, ?2, ?3, ?4, ?5)`)
      .bind(hash, programId, JSON.stringify(result), model, Date.now())
      .run();
  }
}

/** 시험용 메모리 저장소 */
export class MemoryStore {
  constructor() {
    this.c = new Map();
    this.cls = new Map();
  }
  async incr(k, by, ttlSec) {
    const now = Date.now();
    const cur = this.c.get(k);
    const n = cur && cur.exp >= now ? cur.n + by : by;
    this.c.set(k, { n, exp: cur && cur.exp >= now ? cur.exp : now + ttlSec * 1000 });
    return n;
  }
  async peek(k) {
    const cur = this.c.get(k);
    return cur && cur.exp >= Date.now() ? cur.n : 0;
  }
  async getClassify(hash) {
    return this.cls.get(hash) || null;
  }
  async putClassify(hash, programId, result, model) {
    this.cls.set(hash, { result, model, created: Date.now() });
  }
}
