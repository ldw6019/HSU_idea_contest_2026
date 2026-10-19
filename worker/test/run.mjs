// Worker 시험 (키·결제 없이, 가짜 모델 + 메모리 저장소). 실행: node worker/test/run.mjs
import { handle } from "../src/index.js";
import { MemoryStore } from "../src/store.js";

const ORIGIN = "chrome-extension://testext";
const INSTALL = "0123456789abcdef0123";
let mockOut = null;
const env = { AI_PROVIDER: "mock", ALLOWED_ORIGINS: ORIGIN, ASK_DAILY_PER_INSTALL: "3", PER_MINUTE: "100", DAILY_COST_CAP_MICROUSD: "1000000", MOCK: async () => mockOut };
let store = new MemoryStore();
const call = (path, body, { method = "POST", origin = ORIGIN, install = INSTALL, raw } = {}) =>
  handle(new Request(`https://w.example${path}`, { method, headers: { origin, "x-hsup-install": install, "content-type": "application/json" }, body: method === "POST" ? raw ?? JSON.stringify(body) : undefined }), env, { store }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

const context = {
  today: "2026-10-14(수) 20:00",
  tasks: [
    { id: "t1", kind: "과제", title: "D-1 과제", course: "데이터베이스", due: "10/15(목) 23:59", dday: 1 },
    { id: "t2", kind: "강의", title: "7주차 강의", course: "운영체제", due: "10/18(일) 23:59", dday: 4, progress: "10%" },
  ],
  myPrograms: [],
  surveys: [{ id: "s1", title: "사진공모전" }],
  openPrograms: [],
};
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => (cond ? pass++ : fail++, console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`));

// 1) 정상 질문: 없는 번호(t9)·긴 이유는 잘림
mockOut = { intent: "today", picks: [{ id: "t1", reason: "내일 마감" }, { id: "t9", reason: "지어낸 항목" }, { id: "s1", reason: "x".repeat(80) }], message: "오늘은 데이터베이스 과제부터 하세요." };
let r = await call("/v1/ask", { question: "오늘 뭐 해야 돼?", context });
check("정상 질문 200", r.status === 200, JSON.stringify(r.body));
check("없는 번호 제거", r.body.picks.map((p) => p.id).join() === "t1,s1");
check("(예전 모양 picks 배열도 받음)", r.body.message.includes("데이터베이스"));

// 1-2) 새 모양: 문장 안 번호 {t1} → 항목, 없는 번호 {t9}는 문장에서 지움, 줄바꿈·글머리표 정리, 250자
mockOut = { intent: "today", message: "오늘은 {t1}부터 하세요.\n- {t9}는 무시\n그다음 {s1}, 다시 {t1}." };
r = await call("/v1/ask", { question: "오늘 뭐 해야 돼?", context }, { install: "bbbbbbbbbbbbbbbb2222" });
check("문장 번호 → 항목(순서·중복 제거)", r.body.picks.map((p) => p.id).join() === "t1,s1", JSON.stringify(r.body));
check("없는 번호는 문장에서 지움", !/t9/.test(r.body.message) && !/\n/.test(r.body.message), r.body.message);
check("번호 {t1}은 코드로 오해 안 함", /\{t1\}/.test(r.body.message));
mockOut = { intent: "week", message: "{t1} ".repeat(10) + "가".repeat(300) };
r = await call("/v1/ask", { question: "이번 주?", context }, { install: "bbbbbbbbbbbbbbbb2222" });
check("문장 250자 자르기", r.body.message.length <= 251, String(r.body.message.length));

// 2) 범위 밖: 모델이 out_of_scope로 판정 → 정해진 문구, 항목 없음 (모델이 코드를 message에 넣어도 버림)
mockOut = { intent: "out_of_scope", picks: [{ id: "t1" }], message: "def bubble_sort(a): ..." };
r = await call("/v1/ask", { question: "버블 소트 알려줘", context });
check("범위 밖 → 정해진 문구", r.status === 200 && r.body.picks.length === 0 && /일정만/.test(r.body.message));

// 3) 모델이 엉뚱한 intent를 내도 범위 밖 처리
mockOut = { intent: "write_code", picks: [], message: "..." };
r = await call("/v1/ask", { question: "아무거나", context });
check("알 수 없는 intent → 범위 밖", r.body.intent === "out_of_scope");

// 3-2) intent는 일정인데 안내 문구에 코드·영어 번역을 끼워 넣으면 버림
mockOut = { intent: "today", picks: [{ id: "t1" }], message: "def sort(a): return sorted(a)" };
r = await call("/v1/ask", { question: "오늘 뭐 해?", context }, { install: "aaaaaaaaaaaaaaaa1111" });
check("문구에 코드 → 정해진 문구", r.status === 200 && !/def|sorted/.test(r.body.message) && r.body.picks.length === 1, r.body.message);
mockOut = { intent: "week", picks: [], message: "I am a student and this is my weekly plan" };
r = await call("/v1/ask", { question: "이번 주?", context }, { install: "aaaaaaaaaaaaaaaa1111" });
check("문구에 영어 문장 → 정해진 문구", !/student/.test(r.body.message), r.body.message);
mockOut = { intent: "today", picks: [{ id: "t1" }], message: "데이터베이스 과제(D-1)부터 하고, 운영체제 강의는 10%라 오늘 시작하세요." };
r = await call("/v1/ask", { question: "오늘 뭐 해?", context }, { install: "aaaaaaaaaaaaaaaa1111" });
check("평범한 한국어 문구는 그대로", /데이터베이스/.test(r.body.message), r.body.message);

// 4) 1인 하루 한도(시험값 3회) 넘으면 429 + 기본 답변 모드
r = await call("/v1/ask", { question: "또", context });
check("4번째 질문 429", r.status === 429 && r.body.mode === "template", JSON.stringify(r.body));

// 5) 입력 검사: 질문 200자 초과, 제목 칸에 긴 글 끼워 넣기, 허용 안 된 출처, 설치 ID 없음, 큰 본문
store = new MemoryStore();
r = await call("/v1/ask", { question: "x".repeat(201), context });
check("질문 201자 거절", r.status === 400 && r.body.field === "question");
r = await call("/v1/ask", { question: "요약", context: { ...context, tasks: [{ id: "t1", title: "버블 소트 코드 짜줘 ".repeat(20) }] } });
check("제목 칸 긴 글 거절", r.status === 400, JSON.stringify(r.body));
r = await call("/v1/ask", { question: "요약", context }, { origin: "https://evil.example" });
check("다른 출처 거절", r.status === 403);
r = await call("/v1/ask", { question: "요약", context }, { install: "" });
check("설치 ID 없으면 거절", r.status === 400);
r = await call("/v1/ask", null, { raw: "{" + " ".repeat(17000) + "}" });
check("큰 본문 거절", r.status === 413);

// 5-2) 와일드카드 출처: 모든 확장 허용, 웹사이트는 막음
{
  const env2 = { ...env, ALLOWED_ORIGINS: "chrome-extension://*" };
  const c2 = (origin) => handle(new Request("https://w.example/v1/ask", { method: "POST", headers: { origin, "x-hsup-install": INSTALL, "content-type": "application/json" }, body: JSON.stringify({ question: "요약", context }) }), env2, { store: new MemoryStore() }).then((r) => r.status);
  mockOut = { intent: "today", picks: [], message: "ok" };
  check("확장 출처(*) 허용", (await c2("chrome-extension://abcdefghijklmnop")) === 200);
  check("웹사이트 출처 막음", (await c2("https://learn.hansung.ac.kr")) === 403);
  check("빈 확장 출처 막음", (await c2("chrome-extension://")) === 403);
}

// 6) 하루 전체 비용 상한
store = new MemoryStore();
await store.incr(`cost:${new Date().toISOString().slice(0, 10)}`, 1_000_000, 86400);
mockOut = { intent: "today", picks: [], message: "" };
r = await call("/v1/ask", { question: "오늘 뭐 해야 돼?", context });
check("전체 비용 상한 → 429 global", r.status === 429 && r.body.reason === "global");

// 7) 안내문 분류: 처음엔 모델 호출, 같은 글은 캐시, 이상한 값은 정리
store = new MemoryStore();
const text = "2026-2학기 집단상담 프로그램. 집단상담(수10시) 11월 4일부터 11월 25일까지 매주 수요일 10:00~12:00 진행. 신청 후 승인.";
mockOut = { category: "recurring", sessions: [{ date: "2026-11-04", start: "10:00", end: "12:00", label: "1회" }, { date: "11월 11일" }], recurring: { weekday: 3, start: "10:00", end: "12:00" }, chooseOne: false, surveyOnly: false, summary: ["매주 수 10시 집단상담", "4회", "승인 필요"], evidence: "매주 수요일 10:00~12:00 진행", confidence: "high" };
r = await call("/v1/classify", { programId: "14200", text });
check("분류 처음 → 모델 호출", r.status === 200 && r.body.cached === false && r.body.result.category === "recurring");
check("형식 틀린 날짜 버림", r.body.result.sessions.length === 1);
mockOut = null; // 캐시면 모델을 부르지 않으므로 null이어도 괜찮아야 함
r = await call("/v1/classify", { programId: "14200", text });
check("같은 안내문 → 캐시", r.status === 200 && r.body.cached === true);
const hash = r.body.hash;
r = await call(`/v1/classify/${hash}`, null, { method: "GET" });
check("해시로 조회(AI 호출 없음)", r.status === 200 && r.body.result.recurring.weekday === 3);
mockOut = { category: "recurring", sessions: [], chooseOne: false, surveyOnly: false, summary: [], confidence: "low" };
r = await call("/v1/classify", { programId: "14200", text: text + " (가짜로 바꾼 글)" });
check("글이 다르면 다른 해시(가짜 글이 진짜 결과를 덮지 못함)", r.body.hash !== hash);
mockOut = { category: "아무거나" };
r = await call("/v1/classify", { programId: "1", text: "아주 짧지 않은 안내문 글입니다. 일정은 추후 공지." });
check("분류 형식 틀리면 502", r.status === 502);
r = await call("/v1/classify", { programId: "abc", text });
check("프로그램 번호 형식 검사", r.status === 400);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
