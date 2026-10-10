// 종합정보시스템(info.hansung.ac.kr) 어댑터
// - 이 사이트는 옛 한글 인코딩(EUC-KR)을 쓴다 → TextDecoder('euc-kr')로 읽는다.
// - 개인시간표 화면이 쓰는 데이터 요청(dae_sigan_main_data.jsp)을 똑같이 보내서 JSON을 받는다.
// - 요청에 필요한 학생 식별값은 "그 화면이 스스로 쓰는 값"을 그대로 쓴다.
//   다른 값으로 바꿔 보내지 않고, 로그나 저장소에도 남기지 않는다.

import { makeItem, SOURCE, TYPE } from "../core/model.js";
import { LoginRequiredError, ParseError } from "../core/errors.js";

const BASE = "https://info.hansung.ac.kr";
const TIMETABLE_PAGE = `${BASE}/jsp_21/student/kyomu/dae_h_siganpyo.jsp`;
const TIMETABLE_DATA = `${BASE}/jsp_21/student/kyomu/dae_sigan_main_data.jsp`;
const SITE_NAME = "종합정보시스템";

async function decode(res) {
  const buf = await res.arrayBuffer();
  const charset = /charset=([\w-]+)/i.exec(res.headers.get("content-type") || "")?.[1] || "euc-kr";
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return new TextDecoder("euc-kr").decode(buf);
  }
}

/** 시간표 화면 HTML에서, 화면 스크립트가 데이터 요청에 쓰는 학생 식별값을 꺼낸다 */
export function extractRequestKey(html) {
  const direct = /as_hakbun\s*:\s*["']([^"']+)["']/.exec(html) || /as_hakbun\s*:\s*(\d+)/.exec(html);
  if (direct) return direct[1];
  // as_hakbun: someVar 형태라면 그 변수의 값을 찾는다
  const ref = /as_hakbun\s*:\s*([A-Za-z_$][\w$]*)/.exec(html);
  if (ref) {
    const v = new RegExp(`${ref[1]}\\s*=\\s*["']([^"']+)["']`).exec(html);
    if (v) return v[1];
  }
  return null;
}

/** "과목\n교수\n강의실" / "과목<br>교수<br>강의실" / "과목 / 교수 / 강의실" 모두 처리 */
export function splitTitle(raw) {
  const parts = String(raw || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .split(/\n|\s\/\s|\//)
    .map((s) => s.trim())
    .filter(Boolean);
  return { course: parts[0] || String(raw || "").trim(), professor: parts[1] || null, place: parts[2] || null };
}

/** 데이터 요청의 응답(JSON 배열)을 공통 형식으로 바꾼다 */
export function parseTimetable(json) {
  const list = Array.isArray(json) ? json : Array.isArray(json?.events) ? json.events : null;
  if (!list) throw new ParseError("시간표 응답 형식이 예상과 다릅니다");
  return list
    .filter((e) => e && e.start)
    .map((e) => {
      const { course, professor, place } = splitTitle(e.title);
      return makeItem({
        source: SOURCE.INFO,
        type: TYPE.CLASS,
        title: course,
        course,
        professor,
        place,
        start: e.start,
        end: e.end || e.start,
        url: TIMETABLE_PAGE,
      });
    });
}

function looksLoggedOut(res, html) {
  const redirected = new URL(res.url).pathname !== new URL(TIMETABLE_PAGE).pathname;
  const hasPassword = /<input[^>]*type\s*=\s*["']?password/i.test(html);
  return !res.ok || redirected || hasPassword;
}

/** 이번 주 시간표를 가져온다. 로그인이 안 돼 있으면 LoginRequiredError */
export async function fetchTimetable() {
  const pageRes = await fetch(TIMETABLE_PAGE, { credentials: "include", cache: "no-store" });
  const html = await decode(pageRes);
  if (looksLoggedOut(pageRes, html)) throw new LoginRequiredError(SITE_NAME);

  const key = extractRequestKey(html);
  if (!key) throw new LoginRequiredError(SITE_NAME); // 식별값이 없으면 학생 화면이 아님

  const dataRes = await fetch(TIMETABLE_DATA, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" },
    body: new URLSearchParams({ as_hakbun: key }),
  });
  if (!dataRes.ok) throw new Error(`시간표 요청 실패 (${dataRes.status})`);
  const text = await decode(dataRes);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ParseError("시간표 응답을 읽을 수 없습니다");
  }
  return parseTimetable(json);
}
