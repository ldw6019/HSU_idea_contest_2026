// ON-Track content script (e클래스 화면 담당)
// 1단계: e클래스 메인 화면에 패널을 띄우고, 세 사이트 로그인 연결 상태를 진단한다.

(() => {
  // 메인 화면(강좌 전체보기)에서만 동작
  const isMainPage = document.body?.id === "page-site-index";
  if (!isMainPage) return;
  if (document.getElementById("on-track-root")) return; // 중복 실행 방지

  // ---------- 화면 뼈대 (Shadow DOM: e클래스 CSS와 서로 간섭하지 않게) ----------
  const host = document.createElement("div");
  host.id = "on-track-root";
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: "open" });

  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = chrome.runtime.getURL("content/panel.css");
  root.appendChild(css);

  const el = (tag, attrs = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else node.setAttribute(k, v);
    }
    for (const c of children) node.appendChild(c);
    return node;
  };

  const launcher = el("button", { class: "launcher", text: "ON", title: "ON-Track 열기" });
  const panel = el("section", { class: "panel hidden", "aria-label": "ON-Track" });

  const TABS = [
    { id: "week", label: "이번 주" },
    { id: "calendar", label: "캘린더" },
    { id: "programs", label: "비교과" },
    { id: "alerts", label: "알림" },
  ];

  const header = el("header", {}, [
    el("strong", { text: "ON-Track" }),
    el("button", { class: "close", text: "×", title: "닫기" }),
  ]);
  const tabBar = el("nav", { class: "tabs" });
  const body = el("div", { class: "body" });
  panel.append(header, tabBar, body);
  root.append(launcher, panel);

  // ---------- 탭 ----------
  let current = "week";
  function renderTabs() {
    tabBar.replaceChildren(
      ...TABS.map((t) => {
        const b = el("button", { class: t.id === current ? "tab active" : "tab", text: t.label });
        b.addEventListener("click", () => {
          current = t.id;
          renderTabs();
          renderBody();
        });
        return b;
      })
    );
  }

  // ---------- 본문 ----------
  function renderBody() {
    body.replaceChildren(
      el("p", { class: "placeholder", text: `"${TABS.find((t) => t.id === current).label}" 화면은 다음 단계에서 만들어요.` }),
      statusSection
    );
  }

  // 연결 상태 진단 (1단계 기술 검증)
  const statusList = el("ul", { class: "status" });
  const refreshBtn = el("button", { class: "small", text: "다시 확인" });
  const statusSection = el("div", { class: "status-box" }, [
    el("div", { class: "status-head" }, [el("span", { text: "연결 상태" }), refreshBtn]),
    statusList,
  ]);

  function statusRow(name, ok, detail, loginUrl) {
    const li = el("li", { class: ok ? "ok" : "ng" }, [
      el("span", { class: "dot" }),
      el("span", { class: "name", text: name }),
      el("span", { class: "detail", text: detail }),
    ]);
    if (!ok && loginUrl) {
      const a = el("a", { href: loginUrl, target: "_blank", rel: "noopener", text: "로그인" });
      li.appendChild(a);
    }
    return li;
  }

  async function checkStatus() {
    statusList.replaceChildren(el("li", { class: "loading", text: "확인 중…" }));
    const eclassOk = document.body.innerText.includes("로그아웃");
    const rows = [statusRow("e클래스", eclassOk, eclassOk ? "연결됨" : "로그인 필요")];
    try {
      const results = await chrome.runtime.sendMessage({ type: "checkLogin" });
      for (const r of results) {
        const detail = r.loggedIn ? "연결됨" : r.error ? "요청 실패" : "로그인 필요";
        rows.push(statusRow(r.name, r.loggedIn, detail, r.loginUrl));
      }
      console.log("[ON-Track] 연결 진단 결과", results);
    } catch (err) {
      rows.push(statusRow("백그라운드", false, "통신 실패: " + err.message));
    }
    statusList.replaceChildren(...rows);
  }
  refreshBtn.addEventListener("click", checkStatus);

  // ---------- 열고 닫기 ----------
  const toggle = (open) => {
    panel.classList.toggle("hidden", !open);
    launcher.classList.toggle("hidden", open);
    if (open) checkStatus();
  };
  launcher.addEventListener("click", () => toggle(true));
  header.querySelector(".close").addEventListener("click", () => toggle(false));

  renderTabs();
  renderBody();
})();
