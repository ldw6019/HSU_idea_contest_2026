// 학교 홈페이지 학부 학사일정 (공개, 로그인 필요 없음) — 10/20 확인
//  화면: https://www.hansung.ac.kr/hansung/6096/subview.do (학부학사일정)
//  연간 목록: GET /schdulMng/hansung/39/yearSchdul.do?year=YYYY  (1~12월, 달마다 div.desc > dl)
//    dl > dt > span "2026.11.02(Mon) ~ 2026.11.20(Fri)" 또는 "2026.10.05(Mon)",  dd > a "트랙선택 신청"
//    달 경계에 걸친 일정은 두 달에 다 나와서 날짜+이름으로 중복을 뺀다
//  robots.txt는 /*/*Mngr, 로그인 경로만 막음 → 이 주소는 허용. 쿠키는 보내지 않는다(background PUBLIC_HOSTS).

const BASE = "https://www.hansung.ac.kr";
const text = (el) => (el ? el.textContent.normalize("NFC").replace(/\s+/g, " ").trim() : "");

/**
 * 종류
 *  apply  = 신청·정정·포기·등록처럼 기간 안에 직접 해야 하는 것 → 이번 주 탭에 보여줌
 *  exam   = 시험
 *  term   = 개강·종강·방학·휴일 같은 학기 흐름
 *  other  = 수업일수 N일, 학사협의회, 시무식 등 (캘린더에도 올리지 않음)
 */
export function academicKind(title) {
  if (/수업일수|협의회|시무식|종무식|학위수여식/.test(title)) return "other";
  if (/고사|시험/.test(title)) return "exam";
  if (/신청|정정|포기|등록|조사|접수|변경/.test(title)) return "apply";
  if (/개강|종강|방학|개교기념일|휴일|개시일/.test(title)) return "term";
  return "other";
}

const ymd = (s) => {
  const m = /(\d{4})\.(\d{2})\.(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

/** 연간 화면 HTML → [{ id, title, start: "YYYY-MM-DD", end, kind }] */
export function parseYearSchedule(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out = [];
  const seen = new Set();
  for (const dl of doc.querySelectorAll("div.desc dl")) {
    const when = text(dl.querySelector("dt"));
    const title = text(dl.querySelector("dd"));
    const [a, b] = when.split("~").map((x) => ymd(x));
    if (!a || !title) continue;
    const key = `${a}|${b || a}|${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: `acad:${a}:${title}`.slice(0, 120), title, start: a, end: b || a, kind: academicKind(title) });
  }
  return out.sort((x, y) => x.start.localeCompare(y.start));
}

/** 올해 학사일정 (11·12월이면 다음 해 것도: 겨울방학·1~2월 신청 기간) */
export async function fetchAcademicCalendar(getText, now = new Date()) {
  const y = now.getFullYear();
  const years = now.getMonth() >= 10 ? [y, y + 1] : [y];
  const all = [];
  for (const year of years) all.push(...parseYearSchedule(await getText(`${BASE}/schdulMng/hansung/39/yearSchdul.do?year=${year}`)));
  if (!all.length) throw new Error("학사일정을 읽지 못했어요");
  return all;
}

export const ACADEMIC_URL = `${BASE}/hansung/6096/subview.do`;
