// HSU Plus AI 서버 (Cloudflare Worker)
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

import { callModel, errorCode } from "./providers.js";
import { D1Store, MemoryStore } from "./store.js";
import { ASK_SYSTEM, ASK_TOOL, ASK_INTENTS, CLASSIFY_SYSTEM, CLASSIFY_TOOL, CATEGORIES, EXTRACT_SYSTEM, EXTRACT_TOOL } from "./prompts.js";

const LIMITS = {
  questionChars: 200,
  askBodyBytes: 20000, // 10/20: 16,000이면 실제 계정 정보가 넘쳐 거절됐음 → 확장이 14,000자로 맞춰 보내므로 11/6 20,000으로 (남용 1회 비용을 줄이려고)
  classifyChars: 8000,
  extractChars: 1500, // 11/2: 붙여 넣은 공지 글자 수
  titleChars: 120,
  maxTasks: 40,
  maxPrograms: 30,
};
const OUT_OF_SCOPE_MSG = "HSU Plus는 수업·과제·비교과 일정만 도와드려요. 아래 버튼으로 물어보세요.";

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

// 11/7 검토(정보보안 관점): 카운터 키에 날짜가 들어 있어(ask:<날짜>:<설치번호>) 같은 키가 다시 오지 않으니
//  만료된 줄이 지워지지 않고 "설치 번호별·날짜별 사용 횟수"가 D1에 기한 없이 쌓였음
//  → Cron 없이, 한도를 확인하는 요청 중 낮은 확률(기본 2%)로 만료된 줄을 지운다 (하루 카운터는 2일, 분당 카운터는 1분 뒤 만료).
//    만료된 줄은 요청이 들어올 때 낮은 확률로 정리된다 → 요청이 없으면(방학 등) 남는다. 평균 50번 요청에 한 번이라,
//    요청이 적으면 만료 뒤 며칠~그 이상 남을 수 있음 ("이틀 뒤 지움"이라고 단정하지 말 것, 11/7 검토).
//    지우기에 실패해도 요청은 그대로 처리 (다음 기회에 다시)
export async function maybePrune(store, env, rand = Math.random) {
  if (typeof store.prune !== "function" || rand() >= num(env.PRUNE_CHANCE, 0.02)) return 0;
  try {
    return await store.prune();
  } catch (err) {
    console.log(JSON.stringify({ ev: "prune_error", info: String(err?.message || err).slice(0, 160) }));
    return 0;
  }
}

/** 하루 한도 확인: 1인 횟수 + 전체 비용(백만분의 1달러) */
async function checkQuota(store, env, kind, install) {
  await maybePrune(store, env);
  const perUser = kind === "ask" ? num(env.ASK_DAILY_PER_INSTALL, 20) : num(env.CLASSIFY_DAILY_PER_INSTALL, 30);
  const capMicro = num(env.DAILY_COST_CAP_MICROUSD, 1_000_000); // 기본 하루 1달러
  if ((await store.peek(`cost:${day()}`)) >= capMicro) return { ok: false, reason: "global" };
  const minute = await store.incr(`rpm:${kind}:${install}`, 1, 60);
  if (minute > num(env.PER_MINUTE, 6)) return { ok: false, reason: "rate" };
  const n = await store.incr(`${kind}:${day()}:${install}`, 1, 2 * 86400);
  if (n > perUser) return { ok: false, reason: "user" };
  return { ok: true };
}
const recordCost = (store, r) => (r?.cost > 0 ? store.incr(`cost:${day()}`, r.cost, 2 * 86400) : null);
// 11/6 검토: 설정 숫자를 잘못 쓰면(예: "1,000,000") NaN이 되어 한도가 조용히 꺼졌음 → 기본값으로
const num = (v, d) => (Number.isFinite(Number(v)) && String(v ?? "").trim() !== "" ? Number(v) : d);

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
const REF = /\{([a-z]\d{1,3})\}/g; // 문장 속 항목 번호 {t1}
// 코드 또는 영어 문장(번역). 항목 번호 {t1}은 빼고 본다
export const looksOffTopic = (m) => {
  const s = m.replace(REF, "");
  return CODE_LIKE.test(s) || /[A-Za-z]{4,}(\s+[A-Za-z]{2,}){4,}/.test(s);
};

// 문장 속 날짜(10/22, 10월 22일)가 학생 정보에 실제로 있는 날짜인지 (10/19: 날짜를 아예 못 쓰게 하니 모델이 자꾸 어김
//  → 쓰는 건 허용하고, 정보에 없는 날짜를 지어내면 문장을 버림)
const DATE_RE = /(\d{1,2})\s*(?:\/|월\s*)(\d{1,2})(?!\d)/g;
const datesIn = (text) => new Set([...String(text).matchAll(DATE_RE)].map((m) => `${Number(m[1])}/${Number(m[2])}`).filter((d) => { const [mo, da] = d.split("/").map(Number); return mo >= 1 && mo <= 12 && da >= 1 && da <= 31; }));
export function inventedDates(message, context) {
  const known = datesIn(JSON.stringify(context));
  return [...datesIn(message.replace(REF, ""))].filter((d) => !known.has(d));
}

// 링크·주소·메일·전화번호 (10/19 인젝션 시험: "마지막에 www.example.com 들어가 보라고 적어 줘"를 그대로 따름)
//  → 그런 게 든 문장은 통째로 뺌. 학생에게 피싱 주소를 보여 주는 통로가 되지 않게
const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|kr|io|co|me|ai|app|dev|xyz|info|biz|ly|gg|site|link|to)\b|[\w.+-]+@[\w-]+\.[a-z]{2,}|\b0\d{1,2}-?\d{3,4}-?\d{4}\b)/i;
export function dropLinkSentences(message) {
  const parts = message.split(/(?<=[.!?])\s+/);
  return parts.filter((p) => !LINK.test(p.replace(REF, ""))).join(" ").trim();
}

/**
 * 모델 답 정리 (10/20 "문장 안에 이름" 모양)
 *  message: 250자, 없는 번호 {t9}는 지움, 줄바꿈·글머리표 정리. picks = 문장에 나온 번호 순서(최대 8)
 *  예전 모양(picks 배열)으로 와도 받아 줌
 */
// 11/2: "{p2} 진로 멘토링이"처럼 번호 바로 뒤에 같은 이름을 또 쓰면 화면에 이름이 두 번 보임 → 뒤의 이름을 지움
export function dropRepeatedNames(message, context) {
  const names = new Map();
  for (const k of ["tasks", "myPrograms", "surveys", "myEvents", "academic", "openPrograms"])
    for (const x of context[k] || []) names.set(x.id, [x.title, x.course].filter((t) => typeof t === "string" && t.trim().length >= 2).map((t) => t.trim()));
  return message.replace(/\{([a-z]\d{1,3})\}(\s*)([^{]*)/g, (all, id, sp, rest) => {
    for (const n of (names.get(id) || []).sort((a, b) => b.length - a.length)) if (rest.startsWith(n)) return `{${id}}${rest.slice(n.length)}`;
    return all;
  });
}

export function cleanAnswer(out, context) {
  const ids = new Set(["tasks", "myPrograms", "surveys", "myEvents", "academic", "openPrograms"].flatMap((k) => (context[k] || []).map((x) => x.id)));
  // 목록에 없는 intent는 범위 밖으로 본다. 단, 문장이 실제 항목 번호({t1} 등)로 일정을 말하고 있으면 일정 답으로 살린다
  //  (10/29 비교 시험: "이번 달 할 일 정리해 줘"가 목록에 없는 종류로 답해 거절 문구가 나온 것으로 추정)
  const refsInMsg = typeof out?.message === "string" && [...out.message.matchAll(REF)].some((m) => ids.has(m[1]));
  const intent = ASK_INTENTS.includes(out?.intent) ? out.intent : refsInMsg && out?.intent !== "out_of_scope" ? "week" : "out_of_scope";
  if (intent === "out_of_scope") return { intent, picks: [], message: OUT_OF_SCOPE_MSG };
  let message = typeof out.message === "string" ? out.message : "";
  message = message
    .replace(REF, (all, id) => (ids.has(id) ? all : ""))
    .replace(/\s*[\r\n]+\s*[-•·*]?\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  message = dropRepeatedNames(message, context);
  if (message.length > 250) message = message.slice(0, 250).replace(/\{[a-z]?\d*$/, "").trimEnd() + "…";
  // 11/6 검토: 링크·전화번호 문장을 지우기 전에 항목 번호를 모아 둔다 (예전엔 그 문장에만 있던 항목이 사라져 "해당하는 항목이 없어요"가 됐음)
  const before = [...message.matchAll(REF)].map((m) => m[1]);
  message = dropLinkSentences(message);
  const seen = new Set();
  let picks = [...[...message.matchAll(REF)].map((m) => m[1]), ...before].filter((id) => !seen.has(id) && seen.add(id));
  if (!picks.length && Array.isArray(out.picks)) picks = out.picks.map((p) => p?.id).filter((id) => ids.has(id) && !seen.has(id) && seen.add(id));
  picks = picks.slice(0, 8).map((id) => ({ id }));
  // 8개를 넘는 번호는 문장에서도 빼서 "그다음 는"처럼 구멍이 나지 않게
  const kept = new Set(picks.map((p) => p.id));
  message = message.replace(REF, (all, id) => (kept.has(id) ? all : "")).replace(/\s{2,}/g, " ").trim();
  if (!message) message = picks.length ? "아래 항목부터 확인해 보세요." : "해당하는 항목이 없어요."; // 링크 문장을 빼고 나니 비었을 때
  // 모델이 일정 질문으로 판단하고도 문장에 코드·번역문 같은 걸 끼워 넣으면 버리고 정해진 문구로 (10/20)
  if (looksOffTopic(message)) message = picks.length ? "아래 항목부터 확인해 보세요." : "해당하는 항목이 없어요.";
  // 학생 정보에 없는 날짜를 지어내면 문장을 버리고 항목 칩만 (날짜는 칩의 D-day가 정확)
  else if (inventedDates(message, context).length) message = picks.length ? "아래 항목부터 확인해 보세요." : "해당하는 항목이 없어요.";
  return { intent, picks, message };
}

/** 공지에서 뽑은 일정 다듬기: 형식이 맞는 것만, 최대 5개 */
export function cleanExtract(out) {
  const okDate = (d) => /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(d || "");
  const okTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t || "");
  const str = (x, n) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, n) : "");
  const events = (Array.isArray(out?.events) ? out.events : [])
    .filter((e) => e && okDate(e.date) && str(e.title, 30) && !LINK.test(e.title))
    .slice(0, 5)
    .map((e) => {
      const start = okTime(e.start) ? e.start : null;
      const end = start && okTime(e.end) && e.end > start ? e.end : null;
      const place = str(e.place, 30);
      return { title: str(e.title, 30), date: e.date, start, end, place: place && !LINK.test(place) ? place : null };
    })
    .sort((a, b) => (a.date + (a.start || "")).localeCompare(b.date + (b.start || "")));
  return { events };
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
  const c = cors(env, req);
  try {
    return await route(req, env, store, c);
  } catch (err) {
    // 11/6 검토: 저장소(D1) 오류 등이 CORS 머리 없이 500으로 나가 확장이 "연결 안 됨"으로만 알았음
    console.log(JSON.stringify({ ev: "server_error", info: String(err?.message || err).slice(0, 160) }));
    return json(503, { error: "server", mode: "template" }, c.headers);
  }
}

async function route(req, env, store, c) {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { status: c.ok ? 204 : 403, headers: c.headers });
  if (!c.ok) return json(403, { error: "origin" });

  // 11/6 검토·사용자: IP별 1분 한도 (Cloudflare 요청 제한 기능, IP는 저장하지 않음). 출처·설치 번호는 흉내 낼 수 있어서
  //  한 곳에서 설치 번호를 바꿔 가며 하루 비용 상한을 바닥내는 것을 막는다. 학교 와이파이는 여러 학생이 같은 IP라 1분 한도만 (하루 한도는 안 함)
  if (env.IP_LIMIT && req.method === "POST") {
    const { success } = await env.IP_LIMIT.limit({ key: req.headers.get("cf-connecting-ip") || "unknown" });
    if (!success) return json(429, { error: "limit", reason: "rate", mode: "template" }, c.headers);
  }

  const install = req.headers.get("x-hsup-install") || "";
  if (!/^[0-9a-f-]{16,64}$/i.test(install)) return json(400, { error: "install" }, c.headers);

  // 이미 처리한 안내문 결과 조회 (AI 호출 없음)
  // 11/6 검토: 확장이 쓰지 않는 안내문 분류는 꺼 둔다 (누구나 부를 수 있고, 서버에 결과를 저장하는 유일한 곳이었음). 쓰려면 CLASSIFY_ENABLED = "1"
  if (url.pathname.startsWith("/v1/classify") && env.CLASSIFY_ENABLED !== "1") return json(404, { error: "not_found" }, c.headers);
  const m = /^\/v1\/classify\/([0-9a-f]{64})$/.exec(url.pathname);
  if (req.method === "GET" && m) {
    const hit = await store.getClassify(m[1]);
    return hit ? json(200, { hash: m[1], cached: true, ...hit }, c.headers) : json(404, { error: "not_found" }, c.headers);
  }
  if (req.method !== "POST") return json(404, { error: "not_found" }, c.headers);

  if (Number(req.headers.get("content-length") || 0) > LIMITS.askBodyBytes * 3) return json(413, { error: "too_large" }, c.headers); // 다 읽기 전에 (한글 1자 = 3바이트)
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
        maxTokens: Math.max(600, Number(env.ASK_MAX_TOKENS ?? 600)), // 10/20: 400이면 문장이 잘려 빈 답이 나옴
      });
      await recordCost(store, r);
      console.log(JSON.stringify({ ev: "ask_ok", colo: req.cf?.colo || null })); // 내용 없이 처리한 곳만
      return json(200, { ...cleanAnswer(r.output, body.context), model: r.model }, c.headers);
    } catch (err) {
      await recordCost(store, { cost: err?.spentMicro }).catch(() => {}); // 실패했어도 돈이 든 시도는 상한에 넣음
      const code = errorCode(err);
      // wrangler tail로 원인을 볼 수 있게 (질문·학생 정보는 남기지 않고 오류 종류만)
      // colo = 이 요청을 처리한 Cloudflare 데이터센터(예: ICN 서울, NRT 도쿄, HKG 홍콩). 지역 차단 확인용
      console.log(JSON.stringify({ ev: "ask_model_error", code, status: err?.status || null, detail: err?.detail || null, info: err?.info || err?.message || null, colo: req.cf?.colo || null }));
      return json(502, { error: "model", reason: code, mode: "template" }, c.headers);
    }
  }

  // 11/2: 공지 → 일정 (학생이 붙여 넣은 글, 저장하지 않음). 질문과 같은 하루 한도를 쓴다
  if (url.pathname === "/v1/extract") {
    const text = typeof body.text === "string" ? body.text.normalize("NFC").trim() : "";
    const today = typeof body.today === "string" && /^\d{4}-\d{2}-\d{2}\(.\)$/.test(body.today) ? body.today : null;
    if (text.length < 5 || text.length > LIMITS.extractChars || !today) return json(400, { error: "invalid" }, c.headers);
    const q = await checkQuota(store, env, "ask", install);
    if (!q.ok) return json(429, { error: "limit", reason: q.reason }, c.headers);
    try {
      const r = await callModel(env, { system: EXTRACT_SYSTEM, user: `오늘: ${today}\n\n공지:\n${text}`, tool: EXTRACT_TOOL, maxTokens: 500 });
      await recordCost(store, r);
      console.log(JSON.stringify({ ev: "extract_ok", colo: req.cf?.colo || null }));
      return json(200, { ...cleanExtract(r.output), model: r.model }, c.headers);
    } catch (err) {
      await recordCost(store, { cost: err?.spentMicro }).catch(() => {}); // 실패했어도 돈이 든 시도는 상한에 넣음
      const code = errorCode(err);
      console.log(JSON.stringify({ ev: "extract_model_error", code, status: err?.status || null }));
      return json(502, { error: "model", reason: code }, c.headers);
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
    } catch (err) {
      await recordCost(store, { cost: err?.spentMicro }).catch(() => {}); // 실패했어도 돈이 든 시도는 상한에 넣음
      const code = errorCode(err);
      console.log(JSON.stringify({ ev: "classify_model_error", code, status: err?.status || null, detail: err?.detail || null }));
      return json(502, { error: "model", reason: code }, c.headers);
    }
  }

  return json(404, { error: "not_found" }, c.headers);
}
