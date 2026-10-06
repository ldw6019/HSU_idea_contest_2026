// ON-Track service worker
// 화면(content script)은 다른 사이트에 직접 요청할 수 없어서,
// 비교과 사이트·종합정보시스템 요청은 여기서 대신 보낸다.

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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "checkLogin") {
    Promise.all(Object.keys(SITES).map(checkSite)).then(sendResponse);
    return true; // 비동기 응답
  }
  return false;
});
