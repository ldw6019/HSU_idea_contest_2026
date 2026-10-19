// 모델 연결부 시험 (키·인터넷 없이): 회사마다 요청 모양이 맞는지, 답에서 JSON·토큰 수를 제대로 꺼내는지, 프리셋 교체가 되는지
// 실행: node worker/test/providers.test.mjs
import { callModel, geminiSchema } from "../src/providers.js";
import { resolveModel, PRESETS } from "../src/models.js";
import { ASK_TOOL, CLASSIFY_TOOL } from "../src/prompts.js";

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => (cond ? pass++ : fail++, console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`));

let sent = null;
let reply = null;
globalThis.fetch = async (url, init) => {
  sent = { url, headers: init.headers, body: JSON.parse(init.body) };
  const r = typeof reply === "function" ? reply(url) : reply;
  return new Response(JSON.stringify(r.body), { status: r.status || 200 });
};
const args = { system: "SYS", user: "USER", tool: ASK_TOOL, maxTokens: 400 };
const answer = { intent: "today", picks: [{ id: "t1", reason: "내일 마감" }], message: "과제부터 하세요." };

// 1) 기본값 = Haiku 5.5
check("프리셋 없으면 haiku-5.5", resolveModel({}).name === "haiku-5.5");

// 2) Anthropic
reply = { body: { content: [{ type: "tool_use", name: "answer", input: answer }], usage: { input_tokens: 2000, output_tokens: 100 } } };
let r = await callModel({ AI_PRESET: "haiku-5.5", ANTHROPIC_API_KEY: "k-a" }, args);
check("anthropic 주소", sent.url === "https://api.anthropic.com/v1/messages");
check("anthropic 키 헤더", sent.headers["x-api-key"] === "k-a");
check("anthropic 도구 강제", sent.body.tool_choice.name === "answer" && sent.body.model === "claude-haiku-5-5");
check("anthropic 답 꺼내기", r.output.intent === "today" && r.preset === "haiku-5.5");
check("anthropic 비용 = 2000×0.1 + 100×0.5", r.cost === 250, String(r.cost));

// 3) Gemini (한 줄 바꾸기)
reply = { body: { candidates: [{ content: { parts: [{ functionCall: { name: "answer", args: answer } }] } }], usageMetadata: { promptTokenCount: 2000, candidatesTokenCount: 100, thoughtsTokenCount: 50 } } };
r = await callModel({ AI_PRESET: "gemini-3.8-flash", GEMINI_API_KEY: "k-g" }, args);
check("gemini 주소", sent.url === "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent", sent.url);
check("gemini 키 헤더", sent.headers["x-goog-api-key"] === "k-g");
check("gemini 함수 강제", sent.body.toolConfig.functionCallingConfig.mode === "ANY" && sent.body.toolConfig.functionCallingConfig.allowedFunctionNames[0] === "answer");
check("gemini 시스템 지시문", sent.body.systemInstruction.parts[0].text === "SYS");
check("gemini 생각 줄이기", sent.body.generationConfig.thinkingConfig?.thinkingLevel === "low" && sent.body.generationConfig.maxOutputTokens === 400);
check("gemini 답 꺼내기", r.output.picks[0].id === "t1");
check("gemini 비용(생각 토큰 포함) = 2000×0.75 + 150×3.75", r.cost === Math.ceil(2000 * 0.75 + 150 * 3.75), String(r.cost));
const gs = JSON.stringify(geminiSchema(CLASSIFY_TOOL.schema));
check("gemini 스키마에 모르는 키 없음", !/additionalProperties|\$schema/.test(gs) && /"enum"/.test(gs));

// 3-2) 생각 설정 이름이 틀려 400이면 그 설정만 빼고 다시
let n400 = 0;
reply = () => (n400++ === 0 ? { status: 400, body: { error: { message: "Invalid JSON payload: thinkingConfig" } } } : { body: { candidates: [{ content: { parts: [{ functionCall: { name: "answer", args: answer } }] } }], usageMetadata: {} } });
r = await callModel({ AI_PRESET: "gemini-3.8-flash", GEMINI_API_KEY: "k-g" }, args);
check("gemini 400 → 생각 설정 빼고 재시도", n400 === 2 && !sent.body.generationConfig.thinkingConfig && r.output.intent === "today");

// 4) OpenAI 호환 (다른 회사 주소)
reply = { body: { choices: [{ message: { tool_calls: [{ function: { name: "answer", arguments: JSON.stringify(answer) } }] } }], usage: { prompt_tokens: 10, completion_tokens: 5 } } };
r = await callModel({ AI_PROVIDER: "openai_compat", AI_MODEL: "some-model", AI_BASE_URL: "https://api.example.com/v1/", AI_API_KEY: "k-o", PRICE_IN_PER_MTOK: "1", PRICE_OUT_PER_MTOK: "2" }, args);
check("openai 호환 주소", sent.url === "https://api.example.com/v1/chat/completions");
check("openai 호환 키", sent.headers.authorization === "Bearer k-o");
check("openai 호환 비용(설정값 요금)", r.cost === 20);

// 5) 예비 모델: 기본 실패 → 예비로 한 번
reply = (url) => (url.includes("anthropic") ? { status: 529, body: { error: { type: "overloaded_error" } } } : { body: { candidates: [{ content: { parts: [{ functionCall: { name: "answer", args: answer } }] } }], usageMetadata: {} } });
r = await callModel({ AI_PRESET: "haiku-5.5", AI_FALLBACK_PRESET: "gemini-2.5-flash-lite", ANTHROPIC_API_KEY: "a", GEMINI_API_KEY: "g" }, args);
check("기본 실패 → 예비 모델", r.preset === "gemini-2.5-flash-lite");

// 6) 키가 없으면 부르지 않고 실패 (키 없는 예비는 건너뜀)
sent = null;
let err = null;
try {
  await callModel({ AI_PRESET: "gemini-3.8-flash" }, args);
} catch (e) {
  err = e;
}
check("키 없으면 요청 안 보냄", err && !sent, err?.message);

// 7) 목록에 없는 프리셋 이름은 바로 오류
err = null;
try {
  resolveModel({ AI_PRESET: "gpt-9" });
} catch (e) {
  err = e;
}
check("모르는 프리셋 이름 오류", !!err);
check("프리셋마다 요금·키 이름 있음", Object.values(PRESETS).every((p) => p.in > 0 && p.out > 0 && (p.provider === "mock" || p.key)));

// 8) 답이 길어 잘리면(도구 입력 없음 + max_tokens) 2배 길이로 한 번 더
{
  let n = 0;
  const lens = [];
  reply = () => {
    lens.push(sent.body.max_tokens);
    return n++ === 0 ? { body: { content: [], stop_reason: "max_tokens", usage: {} } } : { body: { content: [{ type: "tool_use", name: "answer", input: answer }], usage: { input_tokens: 10, output_tokens: 10 } } };
  };
  const r2 = await callModel({ AI_PRESET: "haiku-5.5", ANTHROPIC_API_KEY: "a" }, args);
  check("잘린 답 → 2배 길이로 재시도", lens.join() === "400,800" && r2.output.intent === "today", lens.join());
}
// 9) 오류 → 원인 코드
{
  const { errorCode } = await import("../src/providers.js");
  const mk = (status, detail, info) => Object.assign(new Error("model http"), { status, detail, info });
  check("401 → key", errorCode(mk(401, "authentication_error")) === "key");
  check("크레딧 부족 → credit", errorCode(mk(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API")) === "credit");
  check("529 → busy", errorCode(mk(529, "overloaded_error")) === "busy");
  check("모델 이름 틀림 → model_name", errorCode(mk(404, "not_found_error", "model: claude-x")) === "model_name");
  check("잘림 → too_long", errorCode(Object.assign(new Error("x"), { code: "too_long" })) === "too_long");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
