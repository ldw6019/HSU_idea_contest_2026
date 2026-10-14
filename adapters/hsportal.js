// 비교과(hsportal.hansung.ac.kr, 스마트자기관리시스템) 어댑터
// 다른 사이트라 화면 쪽에서 직접 요청할 수 없다 → 페이지 글은 백그라운드가 받아 주고(getText),
// 해석(DOMParser)은 여기서 한다.
// 비교과 목록·상세는 로그인 없이도 보인다 (2026-10-10 확인).

import { makeItem, SOURCE, TYPE, STATUS } from "../core/model.js";
import { ParseError, LoginRequiredError } from "../core/errors.js";
import { runLimited } from "../core/limit.js";

const BASE = "https://hsportal.hansung.ac.kr";

const text = (el) => (el ? el.textContent.normalize("NFC").replace(/\s+/g, " ").trim() : "");

/** <small class="date_layer"> 안의 "신청:" / "운영:" 줄에서 <time datetime> 두 개를 꺼낸다 */
function readRange(card, label) {
  const layer = [...card.querySelectorAll("small.date_layer")].find((s) => text(s.querySelector(".date_title")).startsWith(label));
  if (!layer) return { from: null, to: null };
  const times = [...layer.querySelectorAll("time")].map((t) => t.getAttribute("datetime")).filter(Boolean);
  return { from: times[0] || null, to: times[1] || times[0] || null };
}

/** 비교과 목록 페이지 HTML → 공통 형식 항목들 */
export function parseProgramList(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const cards = [...doc.querySelectorAll("ul.columns-4 > li")];
  if (!cards.length && !/총\s*0\s*개/.test(doc.body?.textContent || "")) {
    // 카드도 없고 "총 0개"도 아니면 구조가 바뀐 것
    if (!doc.querySelector("main")) throw new ParseError("비교과 목록 구조를 읽지 못했습니다");
  }
  return cards
    .map((li) => {
      const a = li.querySelector('a[href*="/program/all/view/"]');
      if (!a) return null;
      const href = a.getAttribute("href");
      const id = /view\/(\d+)/.exec(href)?.[1];
      const label = li.querySelector("label");
      const point = Number((label ? [...label.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("") : "").replace(/\D/g, "")) || null;
      const progress = text(li.querySelector("span.progress")); // "43/50명" 또는 "1/무제한"
      const pm = /(\d+)\s*\/\s*(\d+|무제한)/.exec(progress);
      const apply = readRange(li, "신청");
      const run = readRange(li, "운영");
      return makeItem({
        id: `hsportal:program:${id}`,
        source: SOURCE.HSPORTAL,
        type: TYPE.PROGRAM,
        title: text(li.querySelector("b.title")),
        start: run.from,
        end: run.to,
        due: apply.to, // 신청 마감
        status: STATUS.TODO,
        url: new URL(href, BASE).href,
        meta: {
          programId: id,
          department: text(li.querySelector("span.institution")),
          point,
          dday: text(li.querySelector("label b")),
          applied: pm ? Number(pm[1]) : null,
          capacity: pm ? (pm[2] === "무제한" ? null : Number(pm[2])) : null,
          full: pm && pm[2] !== "무제한" ? Number(pm[1]) >= Number(pm[2]) : false,
          kind: text(li.querySelector("span.type")), // 개인/팀
          applyFrom: apply.from,
          state: li.firstElementChild?.className || "", // APPROACH_CLOSING, SCHEDULED, CLOSED …
        },
      });
    })
    .filter(Boolean);
}

const PAGE_SIZE = 12; // 목록은 한 쪽에 12개씩
const MAX_PAGES = 8; // 학교 서버 부담을 생각해 최대 8쪽(96개)까지만

/** 목록 HTML의 "총 N개" → N (못 찾으면 null). 실제 HTML은 "총 <b>42</b>개" 형태라 태그를 지우고 찾는다 */
export function parseTotal(html) {
  const m = /총\s*([\d,]+)\s*개/.exec(String(html).replace(/<[^>]+>/g, ""));
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

/** 조건(query)에 맞는 목록을 여러 쪽 이어서 받는다. 2쪽부터 /ko/program/all/list/0/{쪽}?… (2026-10-10 확인) */
async function fetchAllPages(getText, query) {
  const first = await getText(`${BASE}/ko/program/all?${query}`);
  const items = parseProgramList(first);
  const total = parseTotal(first);
  const pages = total ? Math.min(Math.ceil(total / PAGE_SIZE), MAX_PAGES) : 1;
  for (let p = 2; p <= pages; p++) {
    items.push(...parseProgramList(await getText(`${BASE}/ko/program/all/list/0/${p}?${query}`)));
  }
  const seen = new Set();
  return items.filter((it) => !seen.has(it.id) && seen.add(it.id));
}

/**
 * 지금 신청을 받는(접수중) 비교과 전체, 신청 마감 순.
 * 이번 주·다음 주·1주일 안 마감 등은 화면에서 이 목록을 걸러 쓴다.
 * @param {(url: string) => Promise<string>} getText 백그라운드를 통해 페이지 글을 받아 오는 함수
 */
export async function fetchOpenPrograms(getText, now = new Date()) {
  const items = await fetchAllPages(getText, "status=open");
  return items
    .filter((it) => !it.due || new Date(it.due) >= now) // 이미 마감된 것 제외
    .sort((a, b) => new Date(a.due || 8.64e15) - new Date(b.due || 8.64e15));
}

// ================================================================ 내 비교과 (마이페이지, 로그인 필요)
// 읽는 곳 (2026-10-14 확인, 모두 GET·읽기만):
//  - 나의 비교과프로그램 /ko/mypage/programs/list/{wait|progress|complete}/{쪽}
//      li.tbody.application_list: .title(분류 p, 부서 span, a 제목), .date(시작 일시, 장소), .mileage, .status, .complete(버튼)
//      종료 목록은 .issuance_status("이수2026-10-01" / "이수처리중" / "미이수")와 "설문조사" 버튼(data-pidx, data-tidx)
//  - 프로그램 화면 /ko/mypage/programs/view/{번호}: "프로그램 일정 | 상태 | 비고" 목록 = 내가 신청한 회차(이름, 시작 ~ 끝)
//  - 포인트 /ko/mypage/point: div.mileage의 6칸(이번 학기 취득, 이월, 소멸, 전체 누적, 졸업 인정)
//  - 설문 화면 /ko/module/eco/@poll/write/{pidx}/{tidx}: 이미 낸 설문은 내 답이 체크된 채로 열린다
//      → 설문조사 버튼은 내고 나서도 계속 눌리는 상태라 버튼만으로는 판단 못 함. 체크된 답이 있는지로 판단한다.
//      (설문 화면은 열기만 하고 제출하지 않는다)
// 신청·취소·설문 제출은 하지 않는다.

const SITE = "비교과 (스마트자기관리시스템)";

function mypageDoc(html, check) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (doc.querySelector('input[type="password"]')) throw new LoginRequiredError(SITE);
  if (!check(doc)) {
    // 로그인 화면으로 넘어가면 비밀번호칸이 있거나, 마이페이지 표가 아예 없다
    if (!doc.querySelector("a[href*='/mypage/']")) throw new LoginRequiredError(SITE);
    throw new ParseError("비교과 마이페이지 구조를 읽지 못했습니다");
  }
  return doc;
}

/** "2026-11-03(Tue) 14:00" · "2026.11.03(화) 14:00" → ISO (한국 시간 그대로의 로컬 시각) */
export function parseKDate(s) {
  const m = /(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})(?:\D*?(\d{1,2}):(\d{2}))?/.exec(String(s || ""));
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)).toISOString();
}
const num = (s) => {
  const m = /-?[\d,]+(?:\.\d+)?/.exec(String(s || ""));
  return m ? Number(m[0].replace(/,/g, "")) : null;
};

/** 나의 비교과프로그램 목록 한 쪽 */
export function parseMyList(html) {
  const doc = mypageDoc(html, (d) => d.querySelector("li.thead"));
  return [...doc.querySelectorAll("li.tbody.application_list")].map((li) => {
    const a = li.querySelector(".title a");
    const href = a?.getAttribute("href") || "";
    const dates = [...li.querySelectorAll(".date p")];
    const poll = [...li.querySelectorAll(".complete button")].find((b) => /설문/.test(b.textContent));
    return {
      id: /view\/(\d+)/.exec(href)?.[1] || null,
      title: text(a),
      url: href ? new URL(href.replace(/\?.*/, ""), BASE).href : null,
      category: text(li.querySelector(".title > p")).replace(/^\[|\]$/g, ""),
      department: text(li.querySelector(".title > span:not(.date)")).replace(/^\[|\]$/g, ""),
      firstAt: parseKDate(text(dates.find((p) => p.querySelector("time")) || dates[0])),
      place: text(dates.find((p) => p.querySelector(".xi-map-marker"))),
      mileage: num(li.querySelector(".mileage")?.textContent),
      status: text(li.querySelector(".status")?.firstChild) || text(li.querySelector(".status")),
      issuance: text(li.querySelector(".issuance_status")), // 종료 목록만
      poll: poll ? { enabled: !poll.disabled, pidx: poll.dataset.pidx, tidx: poll.dataset.tidx } : null,
    };
  });
}

/** 프로그램 화면의 "프로그램 일정 | 상태 | 비고" = 내가 신청한 회차들 */
export function parseMySessions(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const lists = [...doc.querySelectorAll("ul")].filter((u) => /프로그램 일정/.test(text(u.querySelector(":scope > li.thead"))));
  const mine = lists.find((u) => /비고/.test(text(u.querySelector(":scope > li.thead"))));
  if (!mine) return [];
  return [...mine.querySelectorAll(":scope > li.tbody")].map((li) => {
    const t = [...li.querySelectorAll("time")].map((x) => parseKDate(x.textContent));
    return { name: text(li.querySelector("b")), start: t[0] || null, end: t[1] || t[0] || null, status: text(li.querySelector(".status")) };
  });
}

/**
 * 일정 종류
 *  exact  = "며칠 몇 시에": 같은 날 시작·끝 시각이 있음 → 캘린더에 올린다
 *  online = 장소가 온라인이고 기간이 김 (LMS에서 기간 안에 보는 형식) → 기간만, 아래쪽에
 *  open   = 기간만 있고 세부 일정은 따로(추후 공지, 회차마다 다름 등) → 캘린더에 올리지 않음
 */
export function scheduleKind(session, place) {
  const s = session.start && new Date(session.start);
  const e = session.end && new Date(session.end);
  if (s && e) {
    const sameDay = s.toDateString() === e.toDateString();
    const allDay = s.getHours() === 0 && s.getMinutes() === 0 && e.getHours() >= 23;
    if (sameDay && !allDay && e > s) return "exact";
  }
  return /온라인/.test(place || "") ? "online" : "open";
}

/** 포인트 화면 6칸 */
export function parsePoints(html) {
  const doc = mypageDoc(html, (d) => d.querySelector("div.mileage li"));
  const out = {};
  const KEYS = [
    [/이번\s*학기/, "semester"],
    [/지난\s*학기\s*이월/, "carriedIn"],
    [/다음\s*학기\s*이월/, "carryOut"],
    [/소멸/, "expired"],
    [/전체\s*누적/, "total"],
    [/졸업\s*인정/, "graduation"],
  ];
  for (const li of doc.querySelectorAll("div.mileage li")) {
    const label = text(li.querySelector(":scope > span"));
    const key = KEYS.find(([re]) => re.test(label))?.[1];
    if (key) out[key] = num(li.querySelector(".point span")?.textContent ?? li.querySelector(".point")?.textContent);
  }
  if (out.graduation == null && out.total == null) throw new ParseError("비교과 포인트를 읽지 못했습니다");
  return out;
}

/** 설문 화면이 이미 낸 설문인지: 체크된 답·적힌 답이 하나라도 있으면 낸 것. 입력칸이 아예 없으면 null(모름) */
export function pollAnswered(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const choices = [...doc.querySelectorAll('input[type="radio"], input[type="checkbox"]')];
  const texts = [...doc.querySelectorAll("textarea, input[type='text']")];
  if (!choices.length && !texts.length) return null;
  return choices.some((i) => i.hasAttribute("checked")) || texts.some((t) => (t.tagName === "TEXTAREA" ? t.textContent : t.getAttribute("value") || "").trim() !== "");
}

/**
 * 내 비교과 전체: 포인트, 시작 대기·진행 중(회차 일정 포함), 설문을 아직 안 낸 종료 프로그램(종료 목록 1쪽)
 * @param {(url: string) => Promise<string>} getText
 */
export async function fetchMyPrograms(getText, now = new Date()) {
  const list = (kind) => getText(`${BASE}/ko/mypage/programs/list/${kind}/1`).then(parseMyList);
  const [wait, progress, done, points] = await Promise.all([list("wait"), list("progress"), list("complete"), getText(`${BASE}/ko/mypage/point`).then(parsePoints)]);

  // 시작 대기·진행 중: 프로그램 화면에서 내 회차 일정을 읽는다 (동시 2개)
  const active = [...wait.map((p) => ({ ...p, phase: "wait" })), ...progress.map((p) => ({ ...p, phase: "progress" }))];
  const details = await runLimited(active.map((p) => () => (p.url ? getText(p.url).then(parseMySessions) : [])), 2);
  const programs = active
    .map((p, i) => {
      let sessions = details[i].ok ? details[i].value : [];
      if (!sessions.length && p.firstAt) sessions = [{ name: p.title, start: p.firstAt, end: null, status: p.status }];
      sessions = sessions.map((s) => ({ ...s, kind: scheduleKind(s, p.place) }));
      const left = sessions.filter((s) => !s.end || new Date(s.end) >= now); // 끝난 회차는 뺀다
      return { ...p, sessions: left, allSessions: sessions.length };
    })
    .filter((p) => p.sessions.length); // 다 끝났는데 목록에 남은 것(예: 몇 년 전 승인보류) 제외

  // 종료 목록 1쪽(최근 20개) 중 이수했거나 이수 처리 중이고 설문 버튼이 눌리는 것 → 설문 화면을 열어 이미 냈는지 확인 (동시 2개)
  //  처음엔 이수일 60일 안만 봤는데, 6월에 끝난 프로그램의 미제출 설문을 놓쳐서 기간 제한을 없앰 (10/14 사용자 결정)
  //  미이수는 제외 (설문을 내도 의미가 없음)
  const eligible = (p) => /처리중/.test(p.issuance) || /^이수\s*\d/.test(p.issuance);
  const cand = done.filter((p) => p.poll?.enabled && p.poll.pidx && p.poll.tidx && eligible(p));
  const checks = await runLimited(cand.map((p) => () => getText(`${BASE}/ko/module/eco/@poll/write/${p.poll.pidx}/${p.poll.tidx}`).then(pollAnswered)), 2);
  const surveys = cand
    .map((p, i) => ({ ...p, answered: checks[i].ok ? checks[i].value : null }))
    .filter((p) => p.answered === false)
    .map(({ poll, ...p }) => ({ ...p, listUrl: `${BASE}/ko/mypage/programs/list/complete/1` }));

  return { points, programs, surveys, checkedSurveys: cand.length };
}
