// ON-Track service worker
// 화면(content script)은 다른 사이트에 직접 요청할 수 없어서,
// 비교과 사이트·종합정보시스템 요청은 여기서 대신 보낸다.

const SITES = {
  hsportal: {
    name: "비교과 (스마트자기관리시스템)",
    // 마이페이지는 로그인해야만 열린다. 로그인이 풀려 있으면 로그인 화면으로 넘어간다.
    url: "https://hsportal.hansung.ac.kr/ko/mypage",
    loginUrl: "https://hsportal.hansung.ac.kr/",
    encoding: "utf-8",
  },
  info: {
    name: "종합정보시스템",
    url: "https://info.hansung.ac.kr/jsp_21/index.jsp",
    loginUrl: "https://info.hansung.ac.kr/",
    encoding: "euc-kr", // 종합정보시스템은 옛 한글 인코딩을 쓴다
  },
};

// 한 사이트의 로그인 상태를 확인한다. 페이지를 "읽기만" 한다.
async function checkSite(key) {
  const site = SITES[key];
  try {
    const res = await fetch(site.url, { credentials: "include" });
    const buf = await res.arrayBuffer();
    const html = new TextDecoder(site.encoding).decode(buf);
    const loggedIn = res.ok && html.includes("로그아웃");
    return {
      key,
      name: site.name,
      loggedIn,
      status: res.status,
      finalUrl: res.url,
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
