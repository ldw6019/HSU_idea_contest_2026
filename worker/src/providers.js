import { resolveModel } from "./models.js";
// AI 모델 연결부. 확장은 우리 Worker 주소만 알고, 어떤 회사·모델을 쓰는지는 여기 + 환경 설정에만 있다.
// 모델을 바꿀 때: wrangler.toml의 AI_PRESET 한 줄만 바꾼다 (목록·요금은 models.js). 확장은 다시 배포하지 않는다.
//
// 모든 연결부는 같은 모양으로 부르고 같은 모양으로 돌려준다:
//   callModel(env, { system, user, tool: {name, description, schema}, maxTokens })
//   → { output: tool 입력(JSON 객체), usage: { input, output }, model, preset, cost }
// "정해진 형식으로만 답하기"는 각 회사의 도구 호출(tool / function calling) 기능으로 강제한다.

const TIMEOUT_MS = 20000;

async function postJSON(url, headers, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(`model http ${res.status}`), { status: res.status, detail: data?.error?.type || data?.error?.status || null, info: String(data?.error?.message || "").slice(0, 160) });
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// Gemini는 함수 매개변수에 JSON Schema 일부만 받는다 → 모르는 키는 빼고 보낸다(설명·종류·목록·필수 등만 남김)
const GEMINI_SCHEMA_KEYS = new Set(["type", "description", "enum", "properties", "required", "items", "maxItems", "minItems", "minimum", "maximum", "nullable", "format"]);
export function geminiSchema(s) {
  if (Array.isArray(s)) return s.map(geminiSchema);
  if (!s || typeof s !== "object") return s;
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    if (!GEMINI_SCHEMA_KEYS.has(k)) continue;
    if (k === "properties") out[k] = Object.fromEntries(Object.entries(v).map(([n, sub]) => [n, geminiSchema(sub)]));
    else if (k === "items") out[k] = geminiSchema(v);
    else out[k] = v;
  }
  return out;
}

const PROVIDERS = {
  // Anthropic Messages API (도구 하나를 강제로 쓰게 해서 JSON만 받는다)
  async anthropic(m, { system, user, tool, maxTokens }) {
    const data = await postJSON(
      "https://api.anthropic.com/v1/messages",
      { "x-api-key": m.key, "anthropic-version": "2023-06-01" },
      {
        model: m.model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
        tools: [{ name: tool.name, description: tool.description, input_schema: tool.schema }],
        tool_choice: { type: "tool", name: tool.name },
      }
    );
    const block = (data.content || []).find((b) => b.type === "tool_use" && b.name === tool.name);
    if (!block) throw Object.assign(new Error("model returned no tool output"), { code: data.stop_reason === "max_tokens" ? "too_long" : "format" });
    return { output: block.input, usage: { input: data.usage?.input_tokens || 0, output: data.usage?.output_tokens || 0 } };
  },

  // Google Gemini generateContent (함수 하나만 부르게 강제: functionCallingConfig mode ANY + allowedFunctionNames)
  //  10/20 공식 API 문서로 주소·mode ANY·allowedFunctionNames·usageMetadata 이름 확인. 생각 토큰은 출력 요금으로 청구 → 비용 계산에 더함
  //  thinkingConfig(생각 줄이기)는 이름을 공식 문서에서 다 확인하지 못함 → 400이 나면 그 설정을 빼고 한 번 더
  async gemini(m, { system, user, tool, maxTokens }) {
    const generationConfig = { maxOutputTokens: maxTokens, ...(m.thinking ? { thinkingConfig: m.thinking } : {}) };
    const req = () => postJSON(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m.model)}:generateContent`,
      { "x-goog-api-key": m.key },
      {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        tools: [{ functionDeclarations: [{ name: tool.name, description: tool.description, parameters: geminiSchema(tool.schema) }] }],
        toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [tool.name] } },
        generationConfig,
      }
    );
    let data;
    try {
      data = await req();
    } catch (err) {
      if (err.status !== 400 || !generationConfig.thinkingConfig) throw err;
      delete generationConfig.thinkingConfig;
      data = await req();
    }
    const parts = data.candidates?.[0]?.content?.parts || [];
    const call = parts.find((p) => p.functionCall?.name === tool.name)?.functionCall;
    if (!call) throw Object.assign(new Error("model returned no tool output"), { code: data.candidates?.[0]?.finishReason === "MAX_TOKENS" ? "too_long" : "format" });
    const u = data.usageMetadata || {};
    return { output: call.args || {}, usage: { input: u.promptTokenCount || 0, output: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) } };
  },

  // OpenAI 호환 Chat Completions (OpenAI, 그리고 같은 형식을 지원하는 다른 회사 주소로도 쓸 수 있게 주소를 설정값으로)
  // ※ 아직 실제 호출로 시험하지 않음. 모델을 바꿀 때 worker/eval의 고정 문제 묶음으로 먼저 확인할 것
  async openai_compat(m, { system, user, tool, maxTokens }) {
    const base = (m.base || "https://api.openai.com/v1").replace(/\/$/, "");
    const data = await postJSON(
      `${base}/chat/completions`,
      { authorization: `Bearer ${m.key}` },
      {
        model: m.model,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        tools: [{ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.schema } }],
        tool_choice: { type: "function", function: { name: tool.name } },
      }
    );
    const call = data.choices?.[0]?.message?.tool_calls?.find((c) => c.function?.name === tool.name);
    if (!call) throw new Error("model returned no tool output");
    return { output: JSON.parse(call.function.arguments || "{}"), usage: { input: data.usage?.prompt_tokens || 0, output: data.usage?.completion_tokens || 0 } };
  },

  // 시험용 가짜 모델 (키·결제 없이 서버 동작을 확인). env.MOCK(args) 가 돌려준 값을 그대로 쓴다
  async mock(m, args, env) {
    if (typeof env.MOCK !== "function") throw new Error("mock needs env.MOCK");
    const output = await env.MOCK(args);
    return { output, usage: { input: Math.ceil(args.user.length / 2), output: 120 } };
  },
};

/** 모델 부르기: { output, usage, model, cost(백만분의 1달러) }. 기본 모델이 실패하면 예비 모델(AI_FALLBACK_PRESET)로 한 번만 더 */
export async function callModel(env, args) {
  const tries = [resolveModel(env), resolveModel(env, "FALLBACK")].filter(Boolean);
  let lastErr;
  for (const m of tries) {
    const fn = PROVIDERS[m.provider];
    if (!fn) throw new Error(`unknown provider ${m.provider}`);
    if (m.provider !== "mock" && !m.key) {
      lastErr = new Error(`missing key for ${m.name}`);
      continue;
    }
    try {
      let r;
      try {
        r = await fn(m, args, env);
      } catch (err) {
        // 답이 길어 잘리면(예: "영어로 다섯 문장 이상" 같은 요청) 한 번만 2배 길이로 다시 → 서버가 문장을 250자로 자름
        if (err.code !== "too_long") throw err;
        r = await fn(m, { ...args, maxTokens: args.maxTokens * 2 }, env);
      }
      return { ...r, model: m.model, preset: m.name, cost: costMicroUSD(m, r.usage) };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

/** 모델 오류 → 짧은 원인 코드 (확장 안내 끝 괄호, wrangler tail 기록용. 질문 내용은 남기지 않음) */
export function errorCode(err) {
  if (err?.code) return err.code; // too_long | format
  if (err?.name === "AbortError") return "timeout";
  const st = err?.status;
  const d = `${err?.detail || ""} ${err?.info || ""}`.toLowerCase();
  if (/missing key/.test(err?.message || "")) return "no_key";
  // 403 forbidden "Request not allowed" = 지역 차단으로 추정: 서버가 그 순간 돈 Cloudflare 데이터센터(예: 홍콩)가
  //  Anthropic 지원 지역이 아니면 거절됨. 같은 키로 됐다 안 됐다 함 (10/20 실제 겪음) → wrangler.toml [placement]로 미국에서 실행
  if (st === 403 && /forbidden|not allowed/.test(d)) return "region";
  if (st === 403) return "permission"; // 키는 맞는데 권한(워크스페이스·모델) 없음
  if (st === 401) return "key"; // 키가 틀렸거나 지워짐
  if (/credit|balance|billing/.test(d)) return "credit"; // 크레딧 부족
  if (st === 429 || st === 529 || /overload|rate|resource_exhausted/.test(d)) return "busy"; // 회사 쪽이 바쁨·속도 제한
  if (st === 404 || /not_found|model/.test(d)) return "model_name"; // 모델 이름이 틀림·퇴역
  if (st === 400) return "bad_request";
  if (st >= 500) return "provider_down";
  return "unknown";
}

/** 사용한 토큰 → 비용(백만분의 1달러). 요금은 프리셋(100만 토큰당 달러) */
export function costMicroUSD(m, usage) {
  return Math.ceil(usage.input * m.in + usage.output * m.out); // (토큰 × 달러/100만) × 100만
}
