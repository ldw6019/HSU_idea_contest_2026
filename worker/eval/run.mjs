// 모델 비교 시험: 같은 문제 묶음(cases.mjs)을 모델마다 돌려 점수·평균 시간·비용을 보여준다.
//
//  실행: node worker/eval/run.mjs haiku-5.5 gemini-3.8-flash
//  키가 환경 변수에 없으면 실행할 때 물어본다 (붙여 넣어도 화면에 안 보이고, 어디에도 저장하지 않음).
//  키를 파일·채팅·명령어 줄에 직접 적지 않기 (명령어 기록에 남음)
//  키 없이 시험 도구만 확인: node worker/eval/run.mjs mock
//
//  비용은 models.js 요금표로 계산한 추정치. 질문 16개 × 모델 1개 = 보통 1센트(약 10~20원) 안쪽.
import { callModel } from "../src/providers.js";
import { PRESETS } from "../src/models.js";
import { ASK_SYSTEM, ASK_TOOL } from "../src/prompts.js";
import { cleanAnswer } from "../src/index.js";
import { CONTEXT, CASES, grade } from "./cases.mjs";

const presets = process.argv.slice(2);
if (!presets.length) {
  console.log(`사용법: node worker/eval/run.mjs <프리셋> [프리셋…]\n프리셋: ${Object.keys(PRESETS).join(", ")}`);
  process.exit(1);
}

// 키 없이 도구 확인용 가짜 모델: 질문 낱말로 대충 고름 (점수는 의미 없음)
const MOCK = async ({ user }) => {
  const q = user.slice(user.lastIndexOf("질문:"));
  if (/답 알려|코드|날씨|번역/.test(q)) return { intent: "out_of_scope", picks: [], message: "" };
  return { intent: "today", message: "오늘은 {t1}부터 끝내세요." };
};

// 키 묻기: 입력한 글자를 화면에 보이지 않게
async function askSecret(label) {
  if (!process.stdin.isTTY) return "";
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = (s) => rl.output.write(s.includes(label) ? s : "");
  const v = await new Promise((ok) => rl.question(`${label} 붙여넣고 Enter (화면에 안 보여요, 건너뛰려면 그냥 Enter): `, ok));
  rl.close();
  process.stdout.write("\n");
  return v.trim();
}
for (const name of presets) {
  const k = PRESETS[name]?.key;
  if (k && !process.env[k]) process.env[k] = await askSecret(k);
}

const rows = [];
for (const name of presets) {
  const env = { ...process.env, AI_PRESET: name, MOCK };
  let ok = 0, ms = 0, cost = 0, errors = 0, done = 0;
  console.log(`\n=== ${name} ===`);
  for (const c of CASES) {
    const t0 = Date.now();
    try {
      const r = await callModel(env, { system: ASK_SYSTEM, user: `학생 정보(JSON):\n${JSON.stringify(CONTEXT)}\n\n질문: ${c.q}`, tool: ASK_TOOL, maxTokens: 400 });
      const dt = Date.now() - t0;
      ms += dt;
      done++;
      cost += r.cost;
      const ans = cleanAnswer(r.output, CONTEXT);
      const why = grade(c, ans);
      if (!why.length) ok++;
      console.log(`${why.length ? "FAIL" : "PASS"} ${c.q}  (${dt}ms) → ${ans.intent} [${ans.picks.map((p) => p.id).join(",")}] ${ans.message}${why.length ? "  ← " + why.join("; ") : ""}`);
    } catch (err) {
      errors++;
      console.log(`ERR  ${c.q} → ${err.message}${err.detail ? " (" + err.detail + ")" : ""}`);
      if (/missing key/.test(err.message) || err.status === 401 || err.status === 403) break; // 키가 없거나 틀리면 그 모델은 그만
    }
  }
  const n = done;
  rows.push({ 모델: name, 점수: n ? `${ok}/${CASES.length}` : "키 없음·실패", 오류: errors, "평균 시간(ms)": n ? Math.round(ms / n) : "-", "질문 1회 비용($)": n ? (cost / n / 1e6).toFixed(5) : "-", "1,000회 비용($)": n ? ((cost / n / 1e6) * 1000).toFixed(2) : "-" });
}
console.log("");
console.table(rows);
