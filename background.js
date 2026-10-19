// HSU PLUS service worker
// 화면(content script)은 다른 사이트에 직접 요청할 수 없어서,
// 비교과 사이트·종합정보시스템 요청은 여기서 대신 보낸다.

import { getOrFetch, clearAll, TTL } from "./core/cache.js";
import { toPlainError } from "./core/errors.js";
import { fetchTimetable } from "./adapters/info.js";

const SITES = {
  hsportal: {
    name: "비교과 (스마트자기관리시스템)",
    // 마이페이지는 로그인해야만 열린다.
    url: "https://hsportal.hansung.ac.kr/ko/mypage",
    loginUrl: "https://hsportal.hansung.ac.kr/",
    encoding: "utf-8",
    // 로그인 상태에서만 상단에 "이름 (학번)"이 표시된다.
    loggedInMarker: /\(\s*\d{7,10}\s*\)/,
    markerLabel: "상단의 이름(학번) 표시",
  },
  info: {
    name: "종합정보시스템",
    url: "https://info.hansung.ac.kr/jsp_21/index.jsp",
    loginUrl: "https://info.hansung.ac.kr/",
    encoding: "euc-kr", // 종합정보시스템은 옛 한글 인코딩을 쓴다
    // 로그인한 학생 메뉴에만 개인시간표 링크가 있다.
    loggedInMarker: /dae_h_siganpyo/,
    markerLabel: "개인시간표 메뉴",
  },
};

const PASSWORD_INPUT = /<input[^>]*type\s*=\s*["']?password/i;

// 한 사이트의 로그인 상태를 확인한다. 페이지를 "읽기만" 한다.
// 세 가지를 모두 만족해야 "연결됨"으로 본다.
//  1) 요청한 주소에서 다른 주소(로그인 화면 등)로 넘겨지지 않았다
//  2) 비밀번호 입력칸이 없다
//  3) 로그인했을 때만 보이는 표시가 있다
async function checkSite(key) {
  const site = SITES[key];
  try {
    const res = await fetch(site.url, { credentials: "include", cache: "no-store" });
    const html = new TextDecoder(site.encoding).decode(await res.arrayBuffer());

    const checks = {
      statusOk: res.ok,
      notRedirected: new URL(res.url).pathname === new URL(site.url).pathname,
      noPasswordInput: !PASSWORD_INPUT.test(html),
      hasMarker: site.loggedInMarker.test(html),
    };
    const loggedIn = Object.values(checks).every(Boolean);

    return {
      key,
      name: site.name,
      loggedIn,
      checks, // 어떤 조건 때문에 판정이 났는지 (디버깅용, 개인정보 없음)
      markerLabel: site.markerLabel,
      status: res.status,
      finalPath: new URL(res.url).pathname,
      loginUrl: site.loginUrl,
    };
  } catch (err) {
    return { key, name: site.name, loggedIn: false, error: String(err), loginUrl: site.loginUrl };
  }
}

// 화면이 데이터를 요청하면: 캐시가 유효하면 캐시를, 아니면 어댑터로 새로 받아 준다.
async function getTimetable({ force = false } = {}) {
  try {
    const r = await getOrFetch("timetable", TTL.TIMETABLE, fetchTimetable, { force });
    return { ok: true, items: r.data, fetchedAt: r.fetchedAt, fromCache: r.fromCache, error: toPlainError(r.error) };
  } catch (err) {
    // 로그인 안 된 건 정상 상황(패널이 "로그인 필요" 안내를 띄움) → 경고로 남기지 않는다.
    // 경고는 크롬 확장 관리 화면의 "오류" 목록에 쌓이므로 진짜 실패만 남긴다.
    if (err.name !== "LoginRequiredError") console.warn("[HSU PLUS] 시간표 불러오기 실패:", err.name, err.message);
    return { ok: false, items: [], fetchedAt: null, error: toPlainError(err) };
  }
}

// 화면이 다른 학교 사이트의 페이지 글을 요청할 때 대신 받아 준다.
// 허용된 학교 주소만, GET만 받는다 (확장이 아무 사이트나 부르는 통로가 되지 않게).
const ALLOWED_HOSTS = new Set(["hsportal.hansung.ac.kr", "info.hansung.ac.kr", "learn.hansung.ac.kr", "www.hansung.ac.kr"]);
const PUBLIC_HOSTS = new Set(["www.hansung.ac.kr"]);
async function fetchText({ url }) {
  const u = new URL(url);
  if (u.protocol !== "https:" || !ALLOWED_HOSTS.has(u.host)) throw new Error("허용되지 않은 주소");
  // 학교 홈페이지(학사일정)는 공개 화면이라 로그인 정보(쿠키)를 보내지 않는다 (10/20)
  const res = await fetch(u.href, { credentials: PUBLIC_HOSTS.has(u.host) ? "omit" : "include", cache: "no-store" });
  const buf = await res.arrayBuffer();
  const charset = /charset=([\w-]+)/i.exec(res.headers.get("content-type") || "")?.[1] || (u.host === "info.hansung.ac.kr" ? "euc-kr" : "utf-8");
  let text;
  try {
    text = new TextDecoder(charset).decode(buf);
  } catch {
    text = new TextDecoder("utf-8").decode(buf);
  }
  return { ok: res.ok, status: res.status, finalPath: new URL(res.url).pathname, text };
}

const HANDLERS = {
  fetchText: (msg) => fetchText(msg),
  checkLogin: () => Promise.all(Object.keys(SITES).map(checkSite)),
  getTimetable: (msg) => getTimetable(msg),
  clearCache: () => clearAll(),
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = HANDLERS[msg?.type];
  if (!handler) return false;
  handler(msg).then(sendResponse, (err) => sendResponse({ ok: false, error: toPlainError(err) }));
  return true; // 비동기 응답
});
