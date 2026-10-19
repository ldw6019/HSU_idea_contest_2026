// HSU PLUS AI 탭 — 질문 의도 파악, 보낼 정보 최소화, AI 연결 전(또는 한도 초과 시) 브라우저 안 기본 답변
//
// 원칙 (2026-10-14 사용자와 정함)
//  - 사용자가 AI 탭에서 직접 물을 때만 보낸다. 자동으로 보내지 않는다.
//  - 보내는 범위: 들어야 할 강의, 남은 과제·퀴즈, 내 비교과(진행 중·시작 대기·설문 필요), 신청할 만한 비교과, 졸업까지 남은 포인트.
//    (10/20 추가) 직접 넣은 일정의 제목·날짜(장소·메모는 안 보냄), 학교 학사일정(공개), 이번 학기 포인트 칸(숫자만).
//  - 보내지 않는 것: 이름·학번·성적·연락처, 학교 사이트 주소(식별값이 들어 있음), 교수명·강의실.
//  - 항목 번호는 t1·p1처럼 짧은 번호로 바꿔 보낸다. AI는 "어떤 번호를, 어떤 순서로, 한 줄 이유"만 고르고,
//    날짜·마감은 화면이 가진 실제 값으로 그린다 (AI가 날짜를 틀리게 말할 여지를 없앰).
//  - 범위 밖 질문("버블 소트 알려줘", "과제 답 알려줘")은 답하지 않는다.
// 이 파일은 순수 함수만 둔다 (화면 그리기는 content/main.js, 서버 쪽은 worker/).

export const MAX_Q = 200; // 질문 글자 수 상한

export const PRESETS = [
  { id: "today", label: "오늘 뭐 해야 돼?" },
  { id: "week", label: "이번 주 일정 요약" },
  { id: "free", label: "비는 시간에 할 비교과" },
  { id: "points", label: "졸업 포인트 얼마 남았어?" },
  { id: "academic", label: "학교 신청 기간 알려줘" },
];

export const OUT_OF_SCOPE =
  "HSU PLUS는 수업·과제·비교과 일정만 도와드려요. 아래 버튼으로 물어보세요.";

/** 질문 정리: 공백 정리 + 글자 수 자르기 */
export function sanitizeQuestion(q) {
  return String(q || "").normalize("NFC").replace(/\s+/g, " ").trim().slice(0, MAX_Q);
}

/** 브라우저 안 의도 판정 (AI 연결 전·한도 초과 때 쓰는 기본 방식). 모르면 "unknown" */
export function detectIntent(q) {
  const s = sanitizeQuestion(q);
  if (!s) return "unknown";
  // 과제 풀이·코드 작성 같은 학습 대체 요청은 범위 밖
  if (/(답|정답|풀이|풀어|코드|짜\s*줘|구현|작성해|번역|알고리즘|소트|정렬\s*알)/.test(s) && !/(마감|일정|언제)/.test(s)) return "out";
  if (/(포인트|졸업|점수\s*남)/.test(s)) return "points";
  if (/(학사|수강\s*신청|휴학|복학|전과|재입학|신청\s*기간|중간고사|기말고사|시험\s*기간|개강|종강)/.test(s)) return "academic";
  if (/(비는|빈\s*시간|공강|여유|틈|신청할\s*만|추천)/.test(s)) return "free";
  if (/(이번\s*주|요약|일정|스케줄|주간)/.test(s)) return "week";
  if (/(오늘|뭐\s*해|뭘\s*해|할\s*일|급한|먼저|마감)/.test(s)) return "today";
  return "unknown";
}

/**
 * 서버에 보내기 전에 막을 뻔한 범위 밖 질문 (코드·번역·과제 정답 등). 보내지 않으니 비용도 0 (10/20)
 * detectIntent의 "out"보다 좁게: "설문 답 안 한 거"처럼 일정 질문까지 막지 않도록 확실한 말만
 */
export function clearlyOutOfScope(q) {
  const s = sanitizeQuestion(q);
  // "이번 주 일정 짜 줘"처럼 일정을 짜 달라는 건 범위 안
  if (/(일정|계획|스케줄|시간표|공부\s*순서)/.test(s) && !/(코드|코딩|파이썬|자바|함수|번역)/.test(s)) return false;
  // "파이썬 강의 언제까지야?", "코딩 비교과 있어?"는 통과: 낱말이 아니라 "해 달라는 말"이 있을 때만 막음
  return /((코드|코딩|프로그램|함수|스크립트)\s*(좀\s*)?(짜|만들어|작성|써)|짜\s*줘|구현해|번역|영작|정답|답\s*(좀\s*)?알려|풀어\s*줘|풀이\s*해|숙제\s*해|(레포트|보고서|과제|에세이)\s*(좀\s*)?(대신|써\s*줘|작성해)|과제\s*해\s*줘|알고리즘\s*(알려|설명)|(정렬|소트)\s*(알려|설명|짜|코드))/i.test(s);
}

/** 질문에 나온 종류만 골라 보여 주기 ("이번 주 과제 뭐 남았어?" → 과제만). 없으면 빈 배열 = 전부 */
export function detectKinds(q) {
  const s = sanitizeQuestion(q);
  const out = [];
  if (/(강의|영상|수강|출석)/.test(s)) out.push("강의");
  if (/과제/.test(s)) out.push("과제");
  if (/퀴즈/.test(s)) out.push("퀴즈");
  if (/비교과/.test(s)) out.push("비교과");
  if (/설문/.test(s)) out.push("설문");
  return out;
}

// ---------- 날짜 도우미 (main.js와 같은 규칙: 0시 마감은 전날 24:00, D-day는 날짜 차이) ----------
const isMidnight = (d) => d.getHours() === 0 && d.getMinutes() === 0;
const dueDay = (d) => (isMidnight(d) ? new Date(d.getTime() - 60000) : d);
const day0 = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
export const daysLeft = (iso, now = new Date()) => Math.round((day0(dueDay(new Date(iso))) - day0(now)) / 86400000);
const DAY = ["일", "월", "화", "수", "목", "금", "토"];
const pad = (n) => String(n).padStart(2, "0");
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const label = (iso) => {
  const d = new Date(iso);
  const e = dueDay(d);
  return `${e.getMonth() + 1}/${e.getDate()}(${DAY[e.getDay()]}) ${isMidnight(d) ? "24:00" : hm(d)}`;
};
const cut = (s, n = 80) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
const courseName = (s) => cut(String(s || "").replace(/\[[^\]]*\]|\([^)]*\)/g, ""), 40);
/** 이번 주 일요일 24:00 (월요일 0시 기준 다음 주 월요일) */
function weekEnd(now) {
  const s = new Date(now);
  s.setHours(0, 0, 0, 0);
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7) + 7);
  return s;
}
/** 같은 날 시작·끝 시각이 있는 일정인가 (하루 종일 제외) */
function isExact(start, end) {
  if (!start || !end) return false;
  const s = new Date(start);
  const e = new Date(end);
  const allDay = s.getHours() === 0 && s.getMinutes() === 0 && e.getHours() >= 23;
  return s.toDateString() === e.toDateString() && e > s && !allDay;
}

/**
 * 화면이 가진 데이터 → AI에 보낼 최소 정보 (+ 화면에 다시 그릴 때 쓸 원래 항목 연결표)
 * @returns {{ context: object, refs: Map<string, object> }}
 *   context: 실제로 보낼 내용 ("보낼 내용 보기"에 그대로 보여 줌)
 *   refs: 짧은 번호 → 화면용 원래 항목 (보내지 않음)
 */
export function buildContext(
  { eclassItems = [], myPrograms = null, openPrograms = [], timetable = [], myNext = {}, myEnds = {}, events = [], academic = [], pointSum = null, openInfo = {} } = {},
  now = new Date()
) {
  const refs = new Map();
  const ctx = { today: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}(${DAY[now.getDay()]}) ${hm(now)}`, tasks: [], myPrograms: [], surveys: [], myEvents: [], academic: [], openPrograms: [], points: null };

  // 남은 강의·과제·퀴즈 (기간이 시작된 강의만, 마감 지난 것 제외), 마감 순 최대 40개
  const KIND = { video: "강의", assignment: "과제", quiz: "퀴즈" };
  const tasks = eclassItems
    .filter((it) => it.status === "todo" && it.due && new Date(it.due) >= now && KIND[it.type])
    .filter((it) => it.type !== "video" || !it.start || new Date(it.start) <= now)
    .sort((a, b) => new Date(a.due) - new Date(b.due))
    .slice(0, 40);
  tasks.forEach((it, i) => {
    const id = `t${i + 1}`;
    const t = { id, kind: KIND[it.type], title: cut(it.title), course: courseName(it.course), due: label(it.due), dday: daysLeft(it.due, now) };
    if (it.type === "video" && it.meta?.percent != null) t.progress = `${it.meta.percent}%`;
    ctx.tasks.push(t);
    refs.set(id, { kind: "task", item: it });
  });

  if (myPrograms) {
    // 내 비교과: 시작 대기·진행 중 (다음 회차 또는 기간)
    (myPrograms.programs || []).slice(0, 20).forEach((p, i) => {
      const id = `p${i + 1}`;
      // 다음 회차: 화면이 계산한 것(매주 회차 포함)을 먼저 쓴다
      const nx = myNext[p.id];
      const s = nx ? { kind: "exact", start: nx.start, end: nx.end, weekly: nx.weekly } : p.sessions.find((x) => x.kind === "exact") || p.sessions[0];
      const entry = { id, title: cut(p.title), state: p.phase === "wait" ? "시작 대기" : "진행 중", schedule: nx?.weekly ? "weekly" : s?.kind || "open" };
      if (s?.kind === "exact") {
        entry.next = `${label(s.start).replace(/ .*/, "")} ${hm(new Date(s.start))}-${hm(new Date(s.end))}`;
        entry.dday = daysLeft(s.start, now);
      } else if (s?.start) entry.period = `${label(s.start).replace(/ .*/, "")} ~ ${s.end ? label(s.end) : ""}`;
      if (myEnds[p.id]) {
        entry.endsAt = label(myEnds[p.id]);
        entry.endDday = daysLeft(myEnds[p.id], now);
      }
      ctx.myPrograms.push(entry);
      refs.set(id, { kind: "mine", item: p, session: s });
    });
    (myPrograms.surveys || []).slice(0, 10).forEach((p, i) => {
      const id = `s${i + 1}`;
      ctx.surveys.push({ id, title: cut(p.title) });
      refs.set(id, { kind: "survey", item: p });
    });
    const have = myPrograms.points?.graduation ?? myPrograms.points?.total;
    if (have != null) ctx.points = { needForGraduation: Math.max(0, 800 - have) };
    if (ctx.points && pointSum) ctx.points.thisSemester = { recognized: pointSum.recognized, cap: 200, roomLeft: pointSum.room, earned: pointSum.earned };
  }

  // 직접 넣은 일정: 제목·날짜만 (장소·메모는 보내지 않음), 오늘부터 14일 안, 최대 10개
  events
    .filter((e) => new Date(e.end || e.start) >= new Date(day0(now)) && daysLeft(e.start, now) <= 14)
    .sort((a, b) => new Date(a.start) - new Date(b.start))
    .slice(0, 10)
    .forEach((e, i) => {
      const id = `e${i + 1}`;
      const st = new Date(e.start);
      ctx.myEvents.push({ id, title: cut(e.title, 40), when: e.allDay ? label(e.start).replace(/ .*/, "") : `${label(e.start).replace(/ .*/, "")} ${hm(st)}`, dday: daysLeft(e.start, now) });
      refs.set(id, { kind: "event", item: e });
    });
  // 학교 학사일정 (공개): 진행 중이거나 14일 안에 시작하는 신청·시험, 최대 8개
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  academic
    .filter((a) => (a.kind === "apply" || a.kind === "exam") && a.end >= today && daysLeft(`${a.start}T12:00:00`, now) <= 14)
    .slice(0, 8)
    .forEach((a, i) => {
      const id = `a${i + 1}`;
      const going = a.start <= today;
      ctx.academic.push({ id, title: cut(a.title, 40), kind: a.kind === "exam" ? "시험" : "신청", period: (a.start === a.end ? a.start.slice(5) : `${a.start.slice(5)}~${a.end.slice(5)}`).replace(/-/g, "/"), state: going ? "진행 중" : "예정", dday: daysLeft(`${going ? a.end : a.start}T12:00:00`, now) });
      refs.set(id, { kind: "acad", item: a });
    });

  // 신청할 만한 비교과: 신청 마감 전, 정원 남음, 최대 30개 (신청 마감 순)
  const slots = classSlots(timetable);
  openPrograms
    .filter((it) => it.due && new Date(it.due) >= now && !it.meta?.full)
    .slice(0, 30)
    .forEach((it, i) => {
      const id = `o${i + 1}`;
      // 화면이 공개 상세 화면으로 분류해 둔 게 있으면 그걸 쓴다 (회차별 시각·수업 겹침)
      const info = openInfo[it.meta?.programId];
      const ex = info?.exact || (isExact(it.start, it.end) ? { start: it.start, end: it.end } : null);
      const exact = !!ex;
      const entry = { id, title: cut(it.title), point: it.meta?.point ?? null, applyDue: label(it.due), applyDday: daysLeft(it.due, now) };
      if (info?.category) entry.category = info.category;
      // 판단 재료 (화면이 계산, 공개 정보): 걸리는 시간·회차 수·온라인·남은 자리·시간당 포인트 (10/20)
      for (const k of ["effort", "hours", "ptsPerHour", "sessions", "pick", "online", "seatsLeft"]) if (info?.[k] != null) entry[k] = info[k];
      if (info?.when) {
        entry.when = info.when; // 수업과 안 겹치는 회차 (매주 회차면 "매주 수 10:00–13:00 (11/4~11/25)")
        entry.clashWithClass = false;
      } else if (exact) {
        entry.when = `${label(ex.start).replace(/ .*/, "")} ${hm(new Date(ex.start))}-${hm(new Date(ex.end))}`;
        entry.clashWithClass = info ? !info.free : clashes(slots, ex.start, ex.end);
      } else if (it.start) entry.period = `${label(it.start).replace(/ .*/, "")} ~ ${it.end ? label(it.end).replace(/ .*/, "") : ""}`;
      ctx.openPrograms.push(entry);
      refs.set(id, { kind: "open", item: it, exact });
    });

  return { context: ctx, refs };
}

// 수업 시간: 시간표는 이번 주 것만 오므로 "요일 + 시각"으로 매주 반복된다고 본다
function classSlots(timetable) {
  return timetable.map((c) => {
    const s = new Date(c.start);
    const e = new Date(c.end || c.start);
    return { dow: s.getDay(), from: s.getHours() * 60 + s.getMinutes(), to: e.getHours() * 60 + e.getMinutes() };
  });
}
function clashes(slots, start, end) {
  const s = new Date(start);
  const e = new Date(end);
  const from = s.getHours() * 60 + s.getMinutes();
  const to = e.getHours() * 60 + e.getMinutes();
  return slots.some((c) => c.dow === s.getDay() && c.from < to && from < c.to);
}

/**
 * 브라우저 안 기본 답변 (AI 연결 전, 또는 하루 한도를 넘었을 때)
 * @returns {{ text: string, picks: {id: string, reason?: string}[], note?: string }}
 */
export function localAnswer(intent, { context: full }, now = new Date(), { kinds = [] } = {}) {
  // 질문에 종류가 나오면 그 종류만 (예: "과제" → 과제만, 내 비교과·설문은 "비교과"·"설문"이 나올 때만)
  const c = kinds.length
    ? {
        ...full,
        tasks: full.tasks.filter((t) => kinds.includes(t.kind)),
        myPrograms: kinds.includes("비교과") ? full.myPrograms : [],
        surveys: kinds.includes("설문") || kinds.includes("비교과") ? full.surveys : [],
        myEvents: [],
        academic: [],
      }
    : full;
  c.myEvents ||= [];
  c.academic ||= [];
  if (intent === "out" || intent === "unknown") return { text: intent === "out" ? OUT_OF_SCOPE : "아직은 정해진 질문만 답할 수 있어요. 아래 버튼으로 물어보세요.", picks: [] };

  if (intent === "today") {
    const urgent = c.tasks.filter((t) => t.dday <= 1);
    const progToday = c.myPrograms.filter((p) => p.dday === 0);
    const progEnd = c.myPrograms.filter((p) => p.endDday != null && p.endDday <= 1 && p.dday !== 0);
    const evToday = c.myEvents.filter((e) => e.dday === 0);
    const acadNow = c.academic.filter((a) => (a.state === "진행 중" && a.dday <= 1) || (a.state === "예정" && a.dday === 0));
    const picks = [
      ...c.surveys.map((s) => ({ id: s.id, reason: "설문을 아직 안 냈어요" })),
      ...evToday.map((e) => ({ id: e.id, reason: `오늘 ${e.when.split(" ")[1] || ""}`.trim() })),
      ...progToday.map((p) => ({ id: p.id, reason: `오늘 ${p.next.split(" ")[1]}` })),
      ...urgent.map((t) => ({ id: t.id, reason: t.dday <= 0 ? "오늘 마감" : "내일 마감" })),
      ...progEnd.map((p) => ({ id: p.id, reason: p.endDday <= 0 ? "오늘 기간 끝" : "내일 기간 끝" })),
      ...acadNow.map((a) => ({ id: a.id, reason: a.state === "진행 중" ? (a.dday <= 0 ? "오늘까지 신청" : "내일까지 신청") : "오늘 시작" })),
    ];
    if (picks.length) {
      const nT = urgent.filter((t) => t.dday <= 0).length;
      return { text: `오늘·내일 챙길 게 ${picks.length}개 있어요${nT ? ` (오늘 마감 ${nT}개)` : ""}. 마감 순이에요.`, picks: picks.slice(0, 8) };
    }
    const next = c.tasks.slice(0, 3);
    return next.length
      ? { text: "오늘·내일 마감은 없어요. 가장 가까운 3개예요.", picks: next.map((t) => ({ id: t.id })) }
      : { text: "남은 강의·과제·퀴즈가 없어요.", picks: [] };
  }

  if (intent === "week") {
    const end = weekEnd(now);
    const endDays = Math.round((end - day0(now)) / 86400000) - 1; // 일요일까지 남은 날
    const thisWeek = c.tasks.filter((t) => t.dday <= endDays);
    const count = (k) => thisWeek.filter((t) => t.kind === k).length;
    const progs = c.myPrograms.filter((p) => (p.dday != null && p.dday <= endDays) || (p.endDday != null && p.endDday <= endDays));
    const evs = c.myEvents.filter((e) => e.dday <= endDays);
    const acads = c.academic.filter((a) => a.dday <= endDays);
    const parts = [count("강의") && `강의 ${count("강의")}`, count("과제") && `과제 ${count("과제")}`, count("퀴즈") && `퀴즈 ${count("퀴즈")}`, progs.length && `비교과 ${progs.length}`, evs.length && `내 일정 ${evs.length}`, acads.length && `학사 일정 ${acads.length}`, c.surveys.length && `설문 ${c.surveys.length}`].filter(Boolean);
    return {
      text: parts.length ? `이번 주(일요일까지) 남은 것: ${parts.join(" · ")}. 급한 순서로 보여 드려요.` : "이번 주(일요일까지) 마감인 건 없어요.",
      picks: [...c.surveys.map((s) => ({ id: s.id })), ...thisWeek.map((t) => ({ id: t.id })), ...progs.map((p) => ({ id: p.id })), ...evs.map((e) => ({ id: e.id })), ...acads.map((a) => ({ id: a.id }))].slice(0, 12),
    };
  }

  if (intent === "free") {
    const fit = c.openPrograms.filter((o) => o.when && !o.clashWithClass).sort((a, b) => (b.point || 0) - (a.point || 0));
    if (!fit.length) return { text: "수업과 안 겹치고 날짜·시각이 정해진 신청 가능 비교과가 지금은 없어요.", picks: [] };
    return {
      text: `수업과 안 겹치는 신청 가능 비교과 ${fit.length}개 중 포인트 높은 순이에요.`,
      picks: fit.slice(0, 6).map((o) => ({ id: o.id, reason: `${o.when}${o.point ? ` · ${o.point}점` : ""}` })),
      note: "시간표는 매주 같다고 보고 겹침을 확인했어요.",
    };
  }

  if (intent === "points") {
    if (!c.points) return { text: "비교과 사이트에 로그인해야 포인트를 확인할 수 있어요.", picks: [] };
    const need = c.points.needForGraduation;
    const sem = c.points.thisSemester;
    const semText = sem ? ` 이번 학기 인정은 ${sem.recognized}/${sem.cap}점${sem.roomLeft > 0 ? `, ${sem.roomLeft}점 더 모으면 이번 학기에 바로 인정돼요` : "으로 다 찼고, 더 모으면 다음 학기로 넘어가요"}.` : "";
    if (need === 0) return { text: `졸업 인정 포인트를 이미 다 채웠어요.${sem ? ` 이번 학기에 ${sem.earned}점 모았어요.` : ""}`, picks: [] };
    const good = c.openPrograms.filter((o) => o.point && !o.clashWithClass).sort((a, b) => b.point - a.point || a.applyDday - b.applyDday);
    return {
      text: `졸업까지 ${need}점 남았어요.${semText}${good.length ? " 지금 신청할 수 있는 것 중 포인트 높은 순이에요." : ""}`,
      picks: good.slice(0, 5).map((o) => ({ id: o.id, reason: `${o.point}점 · 신청 ${o.applyDday <= 0 ? "오늘" : `D-${o.applyDday}`} 마감` })),
    };
  }
  if (intent === "academic") {
    if (!c.academic.length) return { text: "앞으로 2주 안에 있는 학교 신청 기간·시험이 없어요.", picks: [] };
    return { text: `앞으로 2주 안 학사 일정이에요 (학교 홈페이지 학사일정 기준).`, picks: c.academic.map((a) => ({ id: a.id, reason: `${a.kind} · ${a.period}${a.state === "진행 중" ? " 진행 중" : ""}` })) };
  }
  return { text: OUT_OF_SCOPE, picks: [] };
}

/**
 * (AI 연결 후) 서버에 묻기. 서버 주소가 없으면 쓰지 않는다.
 * 서버는 { intent, picks: [{id, reason}], message } 형식만 돌려준다 (worker/ 참고).
 * ※ background.js에서 부른다: 화면(content script)에서 부르면 출처가 e클래스 주소가 돼서 서버의 출처 검사에 막힌다.
 */
export async function askRemote(endpoint, installId, question, context, { timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${endpoint.replace(/\/$/, "")}/v1/ask`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hsup-install": installId },
      body: JSON.stringify({ question: sanitizeQuestion(question), context }),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, status: res.status, reason: data.reason || data.error || null };
    return { ok: true, ...data };
  } finally {
    clearTimeout(timer);
  }
}
