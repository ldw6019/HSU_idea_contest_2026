# AI 연결 안내 (처음 한 번, 약 30분)

HSU Plus의 AI는 이렇게 이어져요.

```
학생 크롬(확장) ──직접 쓴 질문만──▶ 우리 AI 서버(Cloudflare Worker, 무료) ──▶ AI 모델(Haiku·Gemini 등)
```

- 확장은 **우리 서버 주소만** 알아요. 어떤 회사·모델을 쓰는지는 서버 설정 한 줄(`AI_PRESET`)에만 있어요.
  → 모델을 바꿔도 확장은 다시 배포하지 않아요.
- AI 키는 **서버 비밀값에만** 들어가요. 확장 코드·저장소·채팅 어디에도 적지 않아요.
- 추천 질문 버튼은 AI를 쓰지 않아요(기본 답변). 직접 쓴 질문만 AI가 답해요.
- 서버가 꺼졌거나 하루 한도를 넘으면 확장은 자동으로 기본 답변을 보여 줘요.

> 이 문서의 화면 메뉴 이름은 2026-10 기준이에요. 이름이 조금 달라도 같은 뜻의 메뉴를 찾으면 돼요.

---

## 0. 준비: Node.js

PowerShell에서 `node -v` → `v20` 이상이 나오면 OK.
없으면 [nodejs.org](https://nodejs.org)에서 LTS 버전을 설치하고 PowerShell을 다시 열어요.

## 1. AI 키 만들기 (기본: Anthropic Haiku 5.5)

1. [console.anthropic.com](https://console.anthropic.com) 가입·로그인
   (Claude 앱의 구독·크레딧과는 별개예요. API는 콘솔 크레딧으로만 써요.)
2. **Billing**에서 크레딧을 소액 충전 (예: $5). **자동 충전(auto-reload)은 꺼 두기**
   - 선불이라 다 쓰면 멈추고, 그 이상 청구되지 않아요. 크레딧은 1년 뒤 만료·환불 불가라 소액만.
3. (권장) **Limits**에서 월 사용 한도를 낮게 (예: $5)
4. **API Keys** → 새 키 만들기, 이름 `hsuplus-server`
   - 키는 한 번만 보여 줘요. **어디에도 붙여 넣지 말고** 4단계에서 바로 서버에 등록해요.
   - 실수로 노출되면 콘솔에서 그 키를 지우고(Disable/Delete) 새로 만들면 돼요.

> Gemini로 쓰고 싶으면: [aistudio.google.com](https://aistudio.google.com)에서 API 키를 만들고 **결제(유료 등급)를 켠 프로젝트**에서 써요.
> 무료 등급은 보낸 내용을 Google이 제품 개선에 쓴다고 요금표에 적혀 있어서 HSU Plus에는 쓰지 않아요.

## 2. Cloudflare 가입 (무료, 카드 필요 없음)

1. [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up) 가입 → 이메일 인증
2. 왼쪽 메뉴 **Workers & Pages**를 한 번 열어요. 처음이면 `workers.dev` 하위 주소 이름을 정하라고 해요
   (예: `hsuplus` → 서버 주소가 `https://hsuplus-ai.hsuplus.workers.dev`가 돼요).

## 3. 서버 폴더에서 로그인

PowerShell:

```powershell
cd (저장소 폴더)\worker
npx wrangler login
```

브라우저가 열리면 **Allow**. (처음엔 wrangler 설치를 물어보면 `y`)

## 4. 설정 파일·저장소·키 등록

```powershell
copy wrangler.toml.example wrangler.toml
npx wrangler d1 create hsuplus
```

- 마지막 명령이 보여 주는 `database_id = "…"` 값을 `wrangler.toml` 맨 아래 `database_id`에 붙여 넣고 저장해요
  (이건 비밀값이 아니에요).

```powershell
npx wrangler d1 execute hsuplus --remote --file=schema.sql
npx wrangler secret put ANTHROPIC_API_KEY
```

- `secret put`이 키를 물어보면 1단계 키를 붙여 넣고 Enter. **화면에 안 보이는 게 정상**이에요.
- 서버가 아직 없다고 만들지 물어보면 `y`.

## 5. 서버 올리기

```powershell
npx wrangler deploy
```

끝에 나오는 `https://hsuplus-ai.○○○.workers.dev` 주소를 복사해요.
브라우저로 그 주소를 열어 `{"error":"origin"}`이 보이면 서버가 살아 있는 거예요(확장이 아니라서 막힌 것).

## 6. 확장에 주소 넣기

1. 저장소의 `core/config.js`에서
   ```js
   export const AI_ENDPOINT = "https://hsuplus-ai.○○○.workers.dev";
   ```
2. `chrome://extensions` → HSU Plus **새로고침** → e클래스 새로고침
3. AI 탭 위에 **● AI 연결됨**이 보이면 끝. 직접 질문을 하나 써서 보내 봐요.
   답 아래에 "AI 답변"이 붙으면 AI가 답한 거예요. "기본 답변 · (이유)"면 AI 대신 브라우저가 답한 거예요.

## 7. (선택) 모델 비교 시험

같은 문제 24개(가짜 학생 정보)를 모델마다 풀려서 점수·속도·비용을 비교해요. 서버를 거치지 않고 이 컴퓨터에서 바로 불러요.

```powershell
cd (저장소 폴더)
node worker/eval/run.mjs haiku-5.5
node worker/eval/run.mjs haiku-5.5 gemini-3.8-flash
```

- 키를 물어보면 붙여 넣고 Enter (화면에 안 보이고 저장되지 않아요). 없는 모델은 그냥 Enter로 건너뛰어요.
- 비용은 한 번 돌리는 데 보통 1~2센트예요.
- `--holdout`을 붙이면 점검용 새 질문 14개(학생 말투·특정 과목·결과 없는 질문·개인정보 유도 등, `worker/eval/holdout.mjs`)로 돌려요. 이 묶음은 지침을 고칠 때 기준으로 쓰지 않고, 처음 보는 질문에도 잘 답하는지만 봐요.

---

## 모델 바꾸기 (예: Haiku → Gemini Flash)

1. `worker/wrangler.toml`에서 한 줄만:
   ```toml
   AI_PRESET = "gemini-3.8-flash"
   ```
2. 그 회사 키가 아직 없으면 등록: `npx wrangler secret put GEMINI_API_KEY`
3. `npx wrangler deploy` — 확장은 그대로

| AI_PRESET | 회사 | 100만 토큰당 (입력 / 출력) | 키 이름 |
|---|---|---|---|
| `haiku-5.5` (기본) | Anthropic | $0.10 / $0.50 | ANTHROPIC_API_KEY |
| `gemini-3.8-flash` | Google | $0.75 / $3.75 (생각 토큰 포함, 2027-01부터 2배) | GEMINI_API_KEY |
| `gemini-2.5-flash-lite` | Google | $0.10 / $0.40 (요약 글 기준, 재확인 필요) | GEMINI_API_KEY |

- 2026-10-20에 본 요금이에요. 목록·요금은 `worker/src/models.js` 한 곳에서 고쳐요.
- 다른 회사(OpenAI 형식 지원)도 `models.js`에 주소·모델·키 이름만 한 줄 추가하면 돼요.
- 예비 모델: `AI_FALLBACK_PRESET`을 켜면 기본 모델이 실패할 때 한 번 더 시도해요(그 키도 등록돼 있어야 함).
- 바꾸기 전에 7단계 비교 시험을 먼저 돌려 보는 걸 권해요.

## 사용량 보기

| 어디서 | 무엇을 |
|---|---|
| [Anthropic 콘솔](https://console.anthropic.com) → **Usage / Cost** | 실제로 청구된 금액·토큰 (가장 정확) |
| Cloudflare → Workers & Pages → `hsuplus-ai` → **Metrics** | 서버에 온 요청 수·오류 수 |
| PowerShell (`worker` 폴더) | 우리 서버가 센 오늘 비용·질문 수 (아래) |

```powershell
# 날짜별 추정 비용 (n ÷ 1,000,000 = 달러)
npx wrangler d1 execute hsuplus --remote --command "SELECT k, n FROM counters WHERE k LIKE 'cost:%'"
# 오늘 질문한 설치 수와 질문 수 (날짜는 세계 표준시 기준, 한국 시간 오전 9시에 바뀜)
npx wrangler d1 execute hsuplus --remote --command "SELECT COUNT(*) AS 설치, SUM(n) AS 질문 FROM counters WHERE k LIKE 'ask:2026-10-20:%'"
```

질문 내용은 어디에도 남지 않아요(숫자만 셈). 그래서 "누가 무엇을 물었는지"는 볼 수 없어요.

## 딴짓 질문 막기 (지침 고치기)

"파이썬 코드 짜 줘" 같은 질문은 네 겹으로 막아요.

1. **확장에서 먼저**: 코드·번역·과제 정답처럼 뻔한 요청은 서버에 보내지 않고 바로 안내 (비용 0, 한도도 안 씀). `core/ai.js`의 `clearlyOutOfScope`
2. **지침(시스템 프롬프트)**: 수업·과제·비교과 일정과 관계없는 질문, 과제 풀이·정답 요청은 `out_of_scope`로 답하라고 지시. `worker/src/prompts.js`의 `ASK_SYSTEM`
3. **답 형식 고정**: 모델은 정해진 칸(질문 종류 + 250자 문장)으로만 답하고, 항목은 `{t1}` 같은 번호로만 가리켜요. 화면이 번호를 진짜 이름·D-day로 바꿔 그리니 모델이 제목·날짜를 지어낼 수 없어요
4. **서버가 한 번 더 걸러냄**: `out_of_scope`면 정해진 문구로 바꾸고, 안내 문구에 코드나 영어 문장이 섞이면 버려요. 없는 항목 번호도 버려요 (`worker/src/index.js`의 `cleanAnswer`)

지침을 고치려면 `worker/src/prompts.js`의 `ASK_SYSTEM` 글을 바꾸고 `worker` 폴더에서 `npx wrangler deploy` (확장은 그대로). 고친 뒤엔 7단계 비교 시험으로 점수가 떨어지지 않았는지 확인해요.

## 돈이 새지 않게 (이미 들어 있는 것)

| 장치 | 값 (`wrangler.toml`) |
|---|---|
| 한 설치당 하루 질문 | 20회 (`ASK_DAILY_PER_INSTALL`) |
| 1분에 | 6회 (`PER_MINUTE`) |
| 서버 전체 하루 비용 | $1 넘으면 그날은 기본 답변 (`DAILY_COST_CAP_MICROUSD`) |
| 답 길이 | 600토큰 (`ASK_MAX_TOKENS`, 잘리면 한 번만 2배로 다시) |
| 콘솔 쪽 | 선불 크레딧 + 월 한도 (1단계) |

질문 한 번은 Haiku 5.5 기준 약 0.5원이에요 (10/21 실측: 테스트 143회에 $0.05). 질문 내용·할 일 목록은 서버에 저장하지 않아요(하루 횟수 숫자만 세요).

## 문제가 생기면

| 증상 | 확인 |
|---|---|
| AI 탭이 계속 "기본 답변 모드" | `core/config.js` 주소를 넣고 확장을 새로고침했는지 |
| "AI 서버에 연결하지 못해…" | 5단계 주소를 브라우저로 열어 보기, 주소 끝에 `/`가 두 번 붙지 않았는지 |
| 매번 기본 답변 + 콘솔에 사용 기록 없음 | 키 등록(4단계) 후 `npx wrangler deploy`를 다시 했는지, 크레딧이 남았는지 |
| 서버 기록 보기 | `npx wrangler tail` (질문 내용은 남기지 않아요) |
