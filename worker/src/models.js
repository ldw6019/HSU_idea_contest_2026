// 모델 목록 (프리셋). 모델을 바꿀 때는 wrangler.toml의 AI_PRESET 한 줄만 바꾸고 다시 배포한다.
// 확장(학생 크롬)은 우리 Worker 주소만 알고 어떤 회사·모델인지 모른다 → 확장은 다시 배포하지 않는다.
//
//  provider: 연결부 이름 (providers.js)  anthropic | gemini | openai_compat | mock
//  key:      Worker 비밀값 이름 (npx wrangler secret put <이름>)
//  in / out: 100만 토큰당 달러 (하루 비용 상한 계산용). 회사가 값을 바꾸면 여기만 고친다
//  thinking: 생각(추론) 토큰을 쓰는 모델에서 줄이는 설정 (답 형식이 정해져 있어 깊은 생각이 필요 없음, 비용 절약)
//
// 요금은 10/20 확인 값. 바꾸기 전에 공식 요금표로 다시 확인할 것
//  - Anthropic Haiku 5.5: 입력 $0.10 / 출력 $0.50 (요청 입력 10만 토큰 이하. 우리 요청은 수천 토큰)
//  - Google Gemini 3.8 Flash: 입력 $0.75 / 출력 $3.75 (생각 토큰 포함, 2026-12-31까지. 2027-01-01부터 $1.50 / $7.50)
//  - Google Gemini 2.5 Flash-Lite: 입력 $0.10 / 출력 $0.40 (요약 글에서 본 값, 공식 표로 재확인 필요)
//  ※ Gemini는 유료 등급만 쓴다. 무료 등급은 보낸 내용을 Google이 제품 개선에 쓴다고 요금표에 적혀 있음
//    (유료 등급: "Content not used to improve our products")

export const PRESETS = {
  "haiku-5.5": { provider: "anthropic", model: "claude-haiku-5-5", key: "ANTHROPIC_API_KEY", in: 0.1, out: 0.5 },
  "gemini-3.8-flash": { provider: "gemini", model: "gemini-3.8-flash", key: "GEMINI_API_KEY", in: 0.75, out: 3.75, thinking: { thinkingLevel: "low" } },
  "gemini-2.5-flash-lite": { provider: "gemini", model: "gemini-2.5-flash-lite", key: "GEMINI_API_KEY", in: 0.1, out: 0.4 },
  // OpenAI 형식을 지원하는 다른 회사도 이렇게 추가 (주소·모델·키 이름만): { provider: "openai_compat", base: "https://…/v1", model: "…", key: "AI_API_KEY", in, out }
  mock: { provider: "mock", model: "mock", key: null, in: 0.1, out: 0.5 },
};

/**
 * 지금 쓸 모델 설정. AI_PRESET이 기본, 개별 값(AI_PROVIDER·AI_MODEL·AI_BASE_URL·PRICE_*)이 있으면 그걸로 덮어씀
 * (목록에 없는 모델을 잠깐 시험할 때). which = "" | "FALLBACK"
 */
export function resolveModel(env, which = "") {
  const p = which ? "AI_FALLBACK_" : "AI_";
  const name = env[`${p}PRESET`] || (which ? "" : env.AI_PROVIDER ? "" : "haiku-5.5");
  const base = name ? PRESETS[name] : null;
  if (name && !base) throw new Error(`unknown preset ${name}`);
  const provider = env[`${p}PROVIDER`] || base?.provider;
  if (!provider) return null; // 예비 모델 없음
  const num = (v, d) => (v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    name: name || `${provider}:${env[`${p}MODEL`]}`,
    provider,
    model: env[`${p}MODEL`] || base?.model,
    base: env[`${p}BASE_URL`] || base?.base || null,
    key: base?.key ? env[base.key] : env.AI_API_KEY || env.ANTHROPIC_API_KEY || env.GEMINI_API_KEY,
    in: num(which ? env.FALLBACK_PRICE_IN_PER_MTOK : env.PRICE_IN_PER_MTOK, base?.in ?? 0.1),
    out: num(which ? env.FALLBACK_PRICE_OUT_PER_MTOK : env.PRICE_OUT_PER_MTOK, base?.out ?? 0.5),
    thinking: base?.thinking || null,
  };
}
