// 비교과 일정 분류 (규칙 기반, AI 없음) — 10/18
// 입력: 공개 상세 화면에서 읽은 회차 목록 + 안내문 글. 출력: 7가지 중 하나 + 속성.
// AI 분류(worker/의 /v1/classify)와 같은 이름을 쓴다. 규칙으로 확실한 것은 여기서 끝내고,
// 애매한 것(open)만 나중에 AI에 묻는다.
//
//  exact      날짜·시각이 정해짐 (회차가 모두 하루 안, 시작·끝 시각 있음) → 캘린더에 올림
//  recurring  매주 같은 요일·시각 (회차 하나가 여러 주에 걸치고 시작·끝 요일과 시각이 맞음) → 매주 칸에 올림
//  date_only  날짜만 (하루짜리인데 시각이 없거나 종일)
//  online     온라인으로 기간 안에 보는 것 (LMS, 이러닝 등)
//  consult    상담·컨설팅처럼 신청 뒤 개별로 시간을 정함
//  submission 공모전·원고처럼 기간 안에 내는 것
//  long_term  2주 넘게 이어지는 활동 (서포터즈, 소모임 등)
//  open       기간만 있고 세부 일정은 따로 안내 (추후 공지, 단톡방 등) — 사용자가 직접 넣을 수 있게
//
// 속성: chooseOne(회차 중 하나만), multi(여러 회차 신청 가능), surveyOnly 는 안내문에 그렇게 쓰여 있을 때만.

const DAY = 86400000;
const re = {
  // "온라인 신청·예약"은 형식이 아니라서 뺀다 (10/18 실제 목록에서 소모임·캠프가 온라인으로 잘못 나옴)
  online: /비대면|LMS|이러닝|e-?러닝|MOOC|e-?class|이클래스|녹화|VOD|동영상\s*강의|원격\s*(강의|교육|수업)|온라인\s*(으로\s*)?(강의|교육|특강|수강|진행|운영|과정|연수|검사|시청|참여|워크숍)/i,
  onlineTitle: /온라인|비대면/,
  offline: /대면\s*(운영|진행|참여)|운영\s*방식\s*[:：]?\s*대면|장소\s*[:：]/,
  consult: /상담|컨설팅|코칭|클리닉|첨삭|멘토링|멘토와|1\s*:\s*1/,
  arrange: /협의|개별\s*(안내|연락|진행|일정)|일정\s*조율|예약|신청\s*후\s*(안내|연락)|희망\s*(일시|시간)/,
  submission: /공모|원고|응모|출품|(예선|작품|자료|영상|과제물)\s*(을|를)?\s*(제출|접수)|북\s*리뷰|에세이|수기\s*(모집|공모)/,
  later: /추후\s*(공지|안내)|별도\s*(공지|안내)|단톡|오픈\s*채팅|카카오톡|카톡|문자\s*(로\s*)?안내|개별\s*공지/,
  chooseOne: /택\s*1|택일|(한|1)\s*(개|가지|회차?)\s*(만|를)\s*(신청|선택)|중복\s*(신청|참여|지원)\s*(불가|안\s*됨|제한)|하나만(?!\s*(선택|신청|참여)\s*해도)/,
  multi: /중복\s*(신청|참여)\s*가능|모두\s*참여|(선택|신청)\s*해도\s*(참여\s*)?가능|여러\s*(회차|개)\s*(신청|참여)\s*가능|원하는\s*(회차|주제)\s*(모두|를)/,
  // 매주 모이는 것이라는 표시 (기간만 길고 요일이 우연히 같은 공모전 등을 거르기 위해)
  weekly: /매주|주\s*\d\s*회|\d+\s*회(기|차)?\s*[*×x]|[*×x]\s*\d+\s*회|총\s*\d+\s*회|[월화수목금토일]\s*\d{1,2}\s*시|[월화수목금토일]요일\s*\d{1,2}/,
  survey: /설문(조사)?\s*(만|응답\s*시|참여\s*시)\s*(이수|포인트)/,
};

const d = (s) => (s ? new Date(s) : null);
const atMidnight = (x) => x.getHours() === 0 && x.getMinutes() === 0;
const nearDayEnd = (x) => x.getHours() === 23 && x.getMinutes() >= 45;
const sameDay = (a, b) => a.toDateString() === b.toDateString();
const hhmm = (x) => `${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`;

/** 회차 하나의 모양 */
export function sessionShape(s) {
  const a = d(s.start);
  const b = d(s.end);
  if (!a) return { kind: "unknown" };
  if (!b || b <= a) return atMidnight(a) ? { kind: "date_only" } : { kind: "exact_start" }; // 끝 시각 모름
  const span = b - a;
  if (sameDay(a, b) || (span <= 6 * 3600000 && !atMidnight(a))) {
    // 하루 안: 00:00~23:59(종일)는 날짜만
    if (atMidnight(a) && (nearDayEnd(b) || atMidnight(b))) return { kind: "date_only" };
    return { kind: "exact" };
  }
  // 4일 이내 (캠프, 1박 2일 MT, 며칠 저녁 특강): 시작 시각이 있으면 "며칠~며칠 몇 시", 없으면 날짜만
  if (span <= 4 * DAY) return atMidnight(a) ? { kind: "date_only", multiDay: true } : { kind: "multi_day" };
  // 여러 날: 같은 요일·시작 시각이 0시가 아니고 끝 시각도 "하루 끝"이 아니면 매주 같은 시각으로 본다
  const weeks = Math.round(span / (7 * DAY));
  if (a.getDay() === b.getDay() && span >= 6 * DAY && !atMidnight(a) && !nearDayEnd(b) && !atMidnight(b) && b.getHours() * 60 + b.getMinutes() > a.getHours() * 60 + a.getMinutes()) {
    return { kind: "recurring", weekday: a.getDay(), from: hhmm(a), to: hhmm(b), times: weeks + 1 };
  }
  return { kind: span > 14 * DAY ? "long" : "period", days: Math.ceil(span / DAY) };
}

/** 근거 문구: 맞은 곳 앞뒤 몇 글자 */
function snippet(text, rx) {
  const m = rx.exec(text);
  if (!m) return null;
  const from = Math.max(0, m.index - 18);
  return text.slice(from, m.index + m[0].length + 22).replace(/\s+/g, " ").trim();
}

/**
 * @param {{ title: string, text?: string, sessions: {name?:string,start:string,end:string}[], pick?: string }} p
 *   pick: 회차 고르는 칸 종류 ("checkbox" = 여러 회차 중 고름, "hidden" = 회차 하나)
 */
export function classifyProgram(p, now = new Date()) {
  const text = `${p.title || ""}\n${p.text || ""}`.normalize("NFC");
  const all = (p.sessions || []).filter((s) => s.start);
  // 이미 끝난 회차는 판단에서 뺀다 (지난 회차가 남아 있는 목록이 많음)
  const live = all.filter((s) => !s.end || new Date(s.end) >= now);
  const weeklyText = re.weekly.test(text);
  const sessions = (live.length ? live : all).map((s) => {
    let shape = sessionShape(s);
    // 요일·시각이 맞아도 안내문에 "매주/4회/화 10시" 같은 말이 없으면 매주로 보지 않는다 (예: 9/22~11/10 공모전)
    if (shape.kind === "recurring" && !weeklyText) shape = { kind: (new Date(s.end) - new Date(s.start)) > 14 * DAY ? "long" : "period" };
    return { ...s, shape };
  });
  const kinds = sessions.map((s) => s.shape.kind);
  const fixed = kinds.filter((k) => k === "exact" || k === "exact_start" || k === "multi_day").length;
  const has = (k) => kinds.includes(k);
  const every = (...ks) => kinds.length > 0 && kinds.every((k) => ks.includes(k));
  const evidence = [];
  const hit = (name) => {
    const s = snippet(text, re[name]);
    if (s) evidence.push(s);
    return !!s;
  };

  let category;
  let confidence = "high";
  if (!sessions.length) {
    category = "open";
    confidence = "low";
  } else if (every("exact", "exact_start", "multi_day") || fixed * 2 >= kinds.length) {
    // 시각이 정해진 회차뿐(또는 절반 이상). 상담이라도 회차 시각이 박혀 있으면 그 시각에 간다
    category = "exact";
  } else if (every("exact", "exact_start", "recurring") && has("recurring")) {
    category = "recurring";
  } else if (every("date_only", "exact", "exact_start", "multi_day")) {
    category = "date_only";
  } else if (re.consult.test(text) && (re.arrange.test(text) || re.consult.test(p.title || ""))) {
    hit("consult");
    hit("arrange");
    category = "consult";
  } else if (hit("submission")) {
    category = "submission";
  } else if (hit("online") || re.onlineTitle.test(p.title || "")) {
    // 시각이 정해진 회차가 없는 온라인 = 기간 안에 보는 것 (실시간 검사가 한 번 끼어 있어도)
    category = "online";
  } else if (has("long")) {
    category = "long_term";
    if (hit("later")) confidence = "medium";
  } else {
    category = "open";
    hit("later");
    confidence = "medium";
  }

  // 회차 고르기: 회차가 2개 이상일 때만 의미 있음
  const many = sessions.length > 1;
  const chooseOne = many && re.chooseOne.test(text);
  const multi = many && !chooseOne ? (re.multi.test(text) ? true : null) : false;
  if (chooseOne) evidence.push(snippet(text, re.chooseOne));
  const online = (re.online.test(text) || re.onlineTitle.test(p.title || "")) && !re.offline.test(text);
  const recurring = sessions.find((s) => s.shape.kind === "recurring")?.shape || null;

  return {
    category,
    confidence,
    chooseOne, // true = 하나만 (안내문에 쓰여 있음)
    multi, // true = 여러 개 가능(쓰여 있음), null = 고를 수 있지만 몇 개인지 모름, false = 회차 하나
    online, // 장소가 온라인(실시간 포함)
    surveyOnly: re.survey.test(text),
    recurring: recurring ? { weekday: recurring.weekday, start: recurring.from, end: recurring.to, times: recurring.times } : null,
    // 회차 kind: exact(하루 안 시각) / multi_day(며칠~며칠 시각) / date_only / recurring / long / period
    sessions: sessions.map(({ shape, ...s }) => ({ ...s, kind: shape.kind === "exact_start" ? "exact" : shape.kind })),
    evidence: [...new Set(evidence.filter(Boolean))].slice(0, 3),
  };
}

export const CATEGORY_LABEL = {
  exact: "날짜·시각 확정",
  recurring: "매주",
  date_only: "날짜만",
  online: "온라인",
  consult: "상담·개별 일정",
  submission: "제출형",
  long_term: "장기 활동",
  open: "세부 일정 따로 안내",
};
