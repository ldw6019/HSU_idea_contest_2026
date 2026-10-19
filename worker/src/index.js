// HSU PLUS AI 서버 (Cloudflare Worker)
//
//  POST /v1/ask            AI 탭 질문 → { intent, picks: [{id, reason}], message }
//  POST /v1/classify       비교과 안내문 → 분류·일정·요약 (같은 안내문은 한 번만 처리하고 모두가 같이 씀)
//  GET  /v1/classify/:hash 이미 처리한 결과만 조회 (AI 호출 없음)
//
// 지키는 것
//  - API 키는 Worker 비밀값(ANTHROPIC_API_KEY 등)에만. 확장 코드에는 없다.
//  - 질문·할 일 목록은 저장하지 않고 로그에도 남기지 않는다. 저장하는 건 사용량 숫자와 공개 안내문 분류 결과뿐.
//  - 학교 사이트는 robots.txt로 자동 수집을 막고 있어서(Disallow: /), 서버가 학교 사이트를 직접 읽지 않는다.
//    안내문은 학생의 확장이 이미 받아 둔 공개 글을 보내 주고, 결과는 "안내문 내용의 해시"로 찾는다.
//    → 누가 가짜 안내문을 보내도 그 가짜 글의 해시에만 묶여서, 진짜 글을 가진 다른 학생에게는 영향이 없다.
//  - 딴짓 질문 막기: 답 형식 고정(번호 + 짧은 이유), 답 길이 상한, 범위 밖 판정, 입력 검사, 1인·전체 하루 한도.

import { callModel } from "./providers.js";
import { D1Store, MemoryStore } from "./store.js";
import { ASK_SYSTEM, ASK_TOOL, ASK_INTENTS, CLASSIFY_SYSTEM, CLASSIFY_TOOL, CATEGORIES } from "./prompts.js";

const LIMITS = {
  questionChars: 200,
  askBodyBytes: 16000,
  classifyChars: 8000,
  titleChars: 120,
  maxTasks: 40,
  maxPrograms: 30,
};
const OUT_OF_SCOPE_MSG = "HSU PLUS는 수업·과제·비교과 일정만 도와드려요. 아래 버튼으로 물어보세요.";

const memoryStore = new MemoryStore(); // D1이 연결되지 않았을 때(로컬 시험)

export default {
  async fetch(req, env) {
    return handle(req, env, { store: env.DB ? new D1Store(env.DB) : memoryStore });
  },
};

const day = (d = new Date()) => d.toISOString().slice(0, 10);

function cors(env, req) {
  const origin = req.headers.get("origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  // "chrome-extension://*" = 모든 크롬 확장 출처 허용 (압축 해제로 설치하면 사람마다 확장 ID가 달라서). 웹사이트 출처는 막힘.
  //  ※ 출처는 브라우저 밖에서 흉내 낼 수 있으니 진짜 방어는 설치별·전체 하루 한도와 비용 상한
  const ok = !!origin && allowed.some((a) => (a.endsWith("*") ? origin.startsWith(a.slice(0, -1)) && origin.length > a.length - 1 : a === origin));
  return {
    ok,
    headers: ok
      ? { "access-control-allow-origin": origin, "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type,x-hsup-install", vary: "origin" }
      : {},
  };
}
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 하루 한도 확인: 1인 횟수 + 전체 비용(백만분의 1달러) */
async function checkQuota(store, env, kind, install) {
  const perUser = Number(kind === "ask" ? env.ASK_DAILY_PER_INSTALL ?? 20 : env.CLASSIFY_DAILY_PER_INSTALL ?? 30);
  const capMicro = Number(env.DAILY_COST_CAP_MICROUSD ?? 1_000_000); // 기본 하루 1달러
  if ((await store.peek(`cost:${day()}`)) >= capMicro) return { ok: false, reason: "global" };
  const minute = await store.incr(`rpm:${kind}:${install}`, 1, 60);
  if (minute > Number(env.PER_MINUTE ?? 6)) return { ok: false, reason: "rate" };
  const n = await store.incr(`${kind}:${day()}:${install}`, 1, 2 * 86400);
  if (n > perUser) return { ok: false, reason: "user" };
  return { ok: true };
}
const recordCost = (store, r) => store.incr(`cost:${day()}`, r.cost, 2 * 86400);

// ---------- 입력 검사 ----------
const str = (v, max) => typeof v === "string" && v.length <= max;
function validAskBody(b) {
  if (!b || typeof b !== "object") return "body";
  if (!str(b.question, LIMITS.questionChars) || !b.question.trim()) return "question";
  const c = b.context;
  if (!c || typeof c !== "object") return "context";
  const lists = { tasks: LIMITS.maxTasks, myPrograms: 20, surveys: 10, myEvents: 10, academic: 8, openPrograms: LIMITS.maxPrograms };
  for (const [k, max] of Object.entries(lists)) {
    const v = c[k] ?? [];
    if (!Array.isArray(v) || v.length > max) return k;
    for (const it of v) {
      if (!it || typeof it !== "object" || !str(it.id, 8) || !str(it.title ?? "", LIMITS.titleChars)) return `${k}.item`;
      for (const val of Object.values(it)) if (typeof val === "string" && val.length > LIMITS.titleChars) return `${k}.field`;
    }
  }
  return null;
}

/** 모델 답 정리: 주어진 번호만, 이유 40자, 안내 120자. 범위 밖이면 정해진 문구 */
const CODE_LIKE = /```|\bdef\s+\w+\s*\(|\bfunction\b|=>|#include|\bimport\s|\bconsole\.|\bprint\s*\(|\breturn\b|;\s*\S|\{\s*\S[^}]*\}|<\/?[a-z]+>|\bSELECT\b|\bfor\s*\(|\bwhile\s*\(/i;
export const looksOffTopic = (m) => CODE_LIKE.test(m) || /[A-Za-z]{4,}(\s+[A-Za-z]{2,}){4,}/.test(m); // 코드 또는 영어 문장(번역)

export function cleanAnswer(out, context) {
  const ids = new Set(["tasks", "myPrograms", "surveys", "myEvents", "academic", "openPrograms"].flatMap((k) => (context[k] || []).map((x) => x.id)));
  const intent = ASK_INTENTS.includes(out?.intent) ? out.intent : "out_of_scope";
  if (intent === "out_of_scope") return { intent, picks: [], message: OUT_OF_SCOPE_MSG };
  const seen = new Set();
  const picks = (Array.isArray(out.picks) ? out.picks : [])
    .filter((p) => p && ids.has(p.id) && !seen.has(p.id) && seen.add(p.id))
    .slice(0, 6)
    .map((p) => ({ id: p.id, reason: typeof p.reason === "string" ? p.reason.slice(0, 40) : undefined }));
  let message = typeof out.message === "string" ? out.message.slice(0, 120) : "";
  // 모델이 일정 질문으로 판단하고도 안내 문구에 코드·번역문 같은 걸 끼워 넣으면 버리고 정해진 문구로 (10/20)
  if (looksOffTopic(message)) message = picks.length ? "아래 항목부터 확인해 보세요." : "해당하는 항목이 없어요.";
  return { intent, picks, message };
}

function cleanClassify(out) {
  if (!out || !CATEGORIES.includes(out.category)) return null;
  const re = { date: /^\d{4}-\d{2}-\d{2}$/, time: /^\d{2}:\d{2}$/ };
  const sessions = (Array.isArray(out.sessions) ? out.sessions : [])
    .filter((s) => s && re.date.test(s.date))
    .slice(0, 12)
    .map((s) => ({ date: s.date, start: re.time.test(s.start || "") ? s.start : null, end: re.time.test(s.end || "") ? s.end : null, label: typeof s.label === "string" ? s.label.slice(0, 40) : null }));
  const r = out.recurring;
  return {
    category: out.category,
    sessions,
    recurring: out.category === "recurring" && r && Number.isInteger(r.weekday) && r.weekday >= 0 && r.weekday <= 6 ? { weekday: r.weekday, start: re.time.test(r.start || "") ? r.start : null, end: re.time.test(r.end || "") ? r.end : null } : null,
    chooseOne: !!out.chooseOne,
    surveyOnly: !!out.surveyOnly,
    summary: (Array.isArray(out.summary) ? out.summary : []).filter((x) => typeof x === "string").slice(0, 3).map((x) => x.slice(0, 50)),
    evidence: typeof out.evidence === "string" ? out.evidence.slice(0, 100) : null,
    confidence: ["high", "medium", "low"].includes(out.confidence) ? out.confidence : "low",
  };
}

// ---------- 요청 처리 ----------
export async function handle(req, env, { store }) {
  const url = new URL(req.url);
  const c = cors(env, req);
  if (req.method === "OPTIONS") return new Response(null, { status: c.ok ? 204 : 403, headers: c.headers });
  if (!c.ok) return json(403, { error: "origin" });

  const install = req.headers.get("x-hsup-install") || "";
  if (!/^[0-9a-f-]{16,64}$/i.test(install)) return json(400, { error: "install" }, c.headers);

  // 이미 처리한 안내문 결과 조회 (AI 호출 없음)
  const m = /^\/v1\/classify\/([0-9a-f]{64})$/.exec(url.pathname);
  if (req.method === "GET" && m) {
    const hit = await store.getClassify(m[1]);
    return hit ? json(200, { hash: m[1], cached: true, ...hit }, c.headers) : json(404, { error: "not_found" }, c.headers);
  }
  if (req.method !== "POST") return json(404, { error: "not_found" }, c.headers);

  const raw = await req.text();
  if (raw.length > LIMITS.askBodyBytes) return json(413, { error: "too_large" }, c.headers);
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: "json" }, c.headers);
  }

  if (url.pathname === "/v1/ask") {
    const bad = validAskBody(body);
    if (bad) return json(400, { error: "invalid", field: bad }, c.headers);
    const q = await checkQuota(store, env, "ask", install);
    if (!q.ok) return json(429, { error: "limit", reason: q.reason, mode: "template" }, c.headers); // 확장은 기본 답변으로
    try {
      const r = await callModel(env, {
        system: ASK_SYSTEM,
        user: `학생 정보(JSON):\n${JSON.stringify(body.context)}\n\n질문: ${body.question.trim()}`,
        tool: ASK_TOOL,
        maxTokens: Number(env.ASK_MAX_TOKENS ?? 400),
      });
      await recordCost(store, r);
      return json(200, { ...cleanAnswer(r.output, body.context), model: r.model }, c.headers);
    } catch (err) {
      return json(502, { error: "model", mode: "template" }, c.headers);
    }
  }

  if (url.pathname === "/v1/classify") {
    const programId = String(body.programId || "");
    const text = typeof body.text === "string" ? body.text.normalize("NFC").replace(/\s+/g, " ").trim() : "";
    if (!/^\d{1,10}$/.test(programId) || text.length < 20 || text.length > LIMITS.classifyChars) return json(400, { error: "invalid" }, c.headers);
    const hash = await sha256(`${programId}\n${text}`);
    const hit = await store.getClassify(hash);
    if (hit) return json(200, { hash, cached: true, ...hit }, c.headers);
    const q = await checkQuota(store, env, "classify", install);
    if (!q.ok) return json(429, { error: "limit", reason: q.reason }, c.headers);
    try {
      const r = await callModel(env, { system: CLASSIFY_SYSTEM, user: `안내문:\n${text}`, tool: CLASSIFY_TOOL, maxTokens: Number(env.CLASSIFY_MAX_TOKENS ?? 700) });
      await recordCost(store, r);
      const result = cleanClassify(r.output);
      if (!result) return json(502, { error: "model_format" }, c.headers);
      await store.putClassify(hash, programId, result, r.model);
      return json(200, { hash, cached: false, result, model: r.model }, c.headers);
    } catch {
      return json(502, { error: "model" }, c.headers);
    }
  }

  return json(404, { error: "not_found" }, c.headers);
}
