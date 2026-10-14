// AI 모델 연결부. 확장은 우리 Worker 주소만 알고, 어떤 회사·모델을 쓰는지는 여기 + 환경 설정에만 있다.
// 모델을 바꿀 때: wrangler 설정(AI_PROVIDER, AI_MODEL, 요금)만 바꾸면 된다. 확장은 다시 배포하지 않는다.
//
// 모든 연결부는 같은 모양으로 부르고 같은 모양으로 돌려준다:
//   callModel(env, { system, user, tool: {name, description, schema}, maxTokens })
//   → { output: tool 입력(JSON 객체), usage: { input, output }, model }
// "정해진 형식으로만 답하기"는 각 회사의 도구 호출(tool / function calling) 기능으로 강제한다.

const TIMEOUT_MS = 20000;

async function postJSON(url, headers, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(`model http ${res.status}`), { status: res.status, detail: data?.error?.type || data?.error?.message || null });
    return data;
  } finally {
    clearTimeout(timer);
  }
}

const PROVIDERS = {
  // Anthropic Messages API (도구 하나를 강제로 쓰게 해서 JSON만 받는다)
  async anthropic(env, { system, user, tool, maxTokens }) {
    const model = env.AI_MODEL || "claude-haiku-5-5";
    const data = await postJSON(
      "https://api.anthropic.com/v1/messages",
      { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      {
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
        tools: [{ name: tool.name, description: tool.description, input_schema: tool.schema }],
        tool_choice: { type: "tool", name: tool.name },
      }
    );
    const block = (data.content || []).find((b) => b.type === "tool_use" && b.name === tool.name);
    if (!block) throw new Error("model returned no tool output");
    return { output: block.input, usage: { input: data.usage?.input_tokens || 0, output: data.usage?.output_tokens || 0 }, model };
  },

  // OpenAI 호환 Chat Completions (OpenAI, 그리고 같은 형식을 지원하는 다른 회사 주소로도 쓸 수 있게 주소를 설정값으로)
  // ※ 아직 실제 호출로 시험하지 않음. 모델을 바꿀 때 worker/test의 고정 문제 묶음으로 먼저 확인할 것
  async openai_compat(env, { system, user, tool, maxTokens }) {
    const model = env.AI_MODEL;
    const base = (env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
    const data = await postJSON(
      `${base}/chat/completions`,
      { authorization: `Bearer ${env.AI_API_KEY}` },
      {
        model,
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
    return { output: JSON.parse(call.function.arguments || "{}"), usage: { input: data.usage?.prompt_tokens || 0, output: data.usage?.completion_tokens || 0 }, model };
  },

  // 시험용 가짜 모델 (키·결제 없이 서버 동작을 확인). env.MOCK(args) 가 돌려준 값을 그대로 쓴다
  async mock(env, args) {
    const output = await env.MOCK(args);
    return { output, usage: { input: Math.ceil(args.user.length / 2), output: 120 }, model: "mock" };
  },
};

export async function callModel(env, args) {
  const name = env.AI_PROVIDER || "anthropic";
  const fn = PROVIDERS[name];
  if (!fn) throw new Error(`unknown provider ${name}`);
  try {
    return await fn(env, args);
  } catch (err) {
    // 예비 모델: 기본 모델이 실패하면 설정된 예비로 한 번만 더
    if (env.AI_FALLBACK_PROVIDER && env.AI_FALLBACK_PROVIDER !== name && PROVIDERS[env.AI_FALLBACK_PROVIDER]) {
      return PROVIDERS[env.AI_FALLBACK_PROVIDER]({ ...env, AI_MODEL: env.AI_FALLBACK_MODEL }, args);
    }
    throw err;
  }
}

/** 사용한 토큰 → 비용(백만분의 1달러). 요금은 설정값(100만 토큰당 달러) */
export function costMicroUSD(env, usage) {
  const pin = Number(env.PRICE_IN_PER_MTOK ?? 0.1); // Haiku 5.5 기준 (10만 토큰 이하 요청)
  const pout = Number(env.PRICE_OUT_PER_MTOK ?? 0.5);
  return Math.ceil(usage.input * pin + usage.output * pout); // (토큰 × 달러/100만) × 100만
}
