// ON-Track content script (e클래스 화면 담당)
// e클래스 메인 화면에 패널을 띄우고, 다른 사이트 데이터는 service worker(background.js)에 요청한다.
// 데이터를 가져오는 코드는 adapters/에, 여기는 "그리기"만 담당한다.

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

  // 요소 만들기 도우미. 학교 페이지에서 온 글자는 항상 textContent로만 넣는다 (코드 끼워넣기 방지).
  const el = (tag, attrs = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of children) if (c) node.appendChild(c);
    return node;
  };

  const send = (msg) => chrome.runtime.sendMessage(msg);

  const LOGIN_URL = {
    종합정보시스템: "https://info.hansung.ac.kr/",
    "비교과 (스마트자기관리시스템)": "https://hsportal.hansung.ac.kr/",
  };

  // ---------- 날짜 도우미 ----------
  const DAY = ["일", "월", "화", "수", "목", "금", "토"];
  const pad = (n) => String(n).padStart(2, "0");
  const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const md = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  function weekRange(now = new Date()) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // 월요일
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start, end };
  }
  function ago(ts) {
    if (!ts) return "";
    const min = Math.round((Date.now() - ts) / 60000);
    if (min < 1) return "방금 전 기준";
    if (min < 60) return `${min}분 전 기준`;
    const h = Math.round(min / 60);
    if (h < 24) return `${h}시간 전 기준`;
    return `${Math.round(h / 24)}일 전 기준`;
  }

  // ---------- 공통 화면 조각 ----------
  function loginCard(site) {
    return el("div", { class: "notice" }, [
      el("p", { text: `${site}에 로그인되어 있지 않아요.` }),
      el("p", { class: "sub", text: "로그인한 뒤 다시 시도해 주세요." }),
      el("div", { class: "row" }, [
        el("a", { class: "btn", href: LOGIN_URL[site] || "#", target: "_blank", rel: "noopener", text: "로그인하러 가기" }),
        el("button", { class: "btn ghost", text: "다시 시도", onclick: () => loadWeek({ force: true }) }),
      ]),
    ]);
  }

  function failCard(message) {
    return el("div", { class: "notice warn" }, [
      el("p", { text: "불러오기에 실패했어요." }),
      el("p", { class: "sub", text: message || "" }),
      el("button", { class: "btn ghost", text: "다시 시도", onclick: () => loadWeek({ force: true }) }),
    ]);
  }

  // ---------- 탭 ----------
  const TABS = [
    { id: "week", label: "이번 주" },
    { id: "calendar", label: "캘린더" },
    { id: "programs", label: "비교과" },
    { id: "alerts", label: "알림" },
  ];

  const launcher = el("button", { class: "launcher", text: "ON", title: "ON-Track 열기" });
  const panel = el("section", { class: "panel hidden", "aria-label": "ON-Track" });
  const header = el("header", {}, [
    el("strong", { text: "ON-Track" }),
    el("button", { class: "close", text: "×", title: "닫기", onclick: () => toggle(false) }),
  ]);
  const tabBar = el("nav", { class: "tabs" });
  const body = el("div", { class: "body" });
  const content = el("div", { class: "content" });
  panel.append(header, tabBar, body);
  root.append(launcher, panel);

  let current = "week";
  function renderTabs() {
    tabBar.replaceChildren(
      ...TABS.map((t) =>
        el("button", {
          class: t.id === current ? "tab active" : "tab",
          text: t.label,
          onclick: () => {
            current = t.id;
            renderTabs();
            renderBody();
          },
        })
      )
    );
  }

  function renderBody() {
    body.replaceChildren(content, statusSection);
    if (current === "week") return renderWeek();
    const label = TABS.find((t) => t.id === current).label;
    content.replaceChildren(el("p", { class: "placeholder", text: `"${label}" 화면은 다음 단계에서 만들어요.` }));
  }

  // ---------- 이번 주 탭 ----------
  let week = null; // 마지막으로 받은 응답 { ok, items, fetchedAt, fromCache, error }
  let loading = false;

  async function loadWeek({ force = false } = {}) {
    loading = true;
    if (current === "week") renderWeek();
    try {
      week = await send({ type: "getTimetable", force });
    } catch (err) {
      week = { ok: false, items: [], error: { kind: "network", message: "백그라운드와 통신하지 못했어요: " + err.message } };
    }
    loading = false;
    if (current === "week") renderWeek();
  }

  function renderWeek() {
    const head = el("div", { class: "section-head" }, [
      el("span", { class: "title", text: "이번 주 수업" }),
      el("span", { class: "meta", text: loading ? "불러오는 중…" : ago(week?.fetchedAt) }),
      el("button", { class: "small", text: "새로고침", disabled: loading ? "" : null, onclick: () => loadWeek({ force: true }) }),
    ]);

    if (!week) {
      content.replaceChildren(head, el("p", { class: "placeholder", text: "불러오는 중…" }));
      return;
    }
    if (!week.ok) {
      const e = week.error || {};
      content.replaceChildren(head, e.kind === "login" ? loginCard(e.site) : failCard(e.message));
      return;
    }

    const parts = [head];
    // 새로 받기는 실패했지만 예전 데이터가 있는 경우
    if (week.error) {
      parts.push(
        el("p", { class: "stale", text: week.error.kind === "login" ? `${week.error.site} 로그인이 풀려 예전 데이터를 보여주고 있어요.` : "새로 불러오지 못해 예전 데이터를 보여주고 있어요." })
      );
    }

    const { start, end } = weekRange();
    const now = new Date();
    const items = (week.items || [])
      .filter((it) => {
        const t = new Date(it.start);
        return t >= start && t < end;
      })
      .sort((a, b) => new Date(a.start) - new Date(b.start));

    if (!items.length) {
      parts.push(el("p", { class: "placeholder", text: "이번 주 수업이 없어요." }));
      content.replaceChildren(...parts);
      return;
    }

    // 요일별로 묶기
    const days = new Map();
    for (const it of items) {
      const d = new Date(it.start);
      const key = d.toDateString();
      if (!days.has(key)) days.set(key, { date: d, items: [] });
      days.get(key).items.push(it);
    }

    const list = el("div", { class: "days" });
    for (const { date, items: dayItems } of days.values()) {
      const isToday = sameDay(date, now);
      const dayEl = el("div", { class: isToday ? "day today" : "day" }, [
        el("div", { class: "day-label", text: `${DAY[date.getDay()]} ${md(date)}${isToday ? " · 오늘" : ""}` }),
      ]);
      for (const it of dayItems) {
        const s = new Date(it.start);
        const e = new Date(it.end || it.start);
        const past = e < now;
        const sub = [it.place, it.professor].filter(Boolean).join(" · ");
        dayEl.appendChild(
          el("div", { class: past ? "item past" : "item" }, [
            el("span", { class: "time", text: `${hm(s)}–${hm(e)}` }),
            el("div", { class: "info" }, [el("div", { class: "name", text: it.course || it.title }), sub ? el("div", { class: "sub", text: sub }) : null]),
          ])
        );
      }
      list.appendChild(dayEl);
    }
    parts.push(list);
    content.replaceChildren(...parts);
  }

  // ---------- 연결 상태 (접어 두는 진단 칸) ----------
  const statusList = el("ul", { class: "status" });
  const statusSection = el("details", { class: "status-box" }, [
    el("summary", {}, [el("span", { text: "연결 상태" })]),
    el("div", { class: "status-actions" }, [el("button", { class: "small", text: "다시 확인", onclick: () => checkStatus() })]),
    statusList,
  ]);

  function statusRow(name, ok, detail, loginUrl) {
    return el("li", { class: ok ? "ok" : "ng" }, [
      el("span", { class: "dot" }),
      el("span", { class: "name", text: name }),
      el("span", { class: "detail", text: detail }),
      !ok && loginUrl ? el("a", { href: loginUrl, target: "_blank", rel: "noopener", text: "로그인" }) : null,
    ]);
  }

  async function checkStatus() {
    statusList.replaceChildren(el("li", { class: "loading", text: "확인 중…" }));
    const eclassOk = document.body.innerText.includes("로그아웃");
    const rows = [statusRow("e클래스", eclassOk, eclassOk ? "연결됨" : "로그인 필요")];
    try {
      const results = await send({ type: "checkLogin" });
      for (const r of results) {
        const detail = r.loggedIn ? "연결됨" : r.error ? "요청 실패" : "로그인 필요";
        rows.push(statusRow(r.name, r.loggedIn, detail, r.loginUrl));
      }
      // 판정 근거를 표로 출력 (모두 true여야 "연결됨")
      console.table(
        Object.fromEntries(results.map((r) => [r.name, { 최종판정: r.loggedIn, ...(r.checks || {}), 이동경로: r.finalPath, 오류: r.error }]))
      );
    } catch (err) {
      rows.push(statusRow("백그라운드", false, "통신 실패: " + err.message));
    }
    statusList.replaceChildren(...rows);
  }

  // ---------- 열고 닫기 ----------
  function toggle(open) {
    panel.classList.toggle("hidden", !open);
    launcher.classList.toggle("hidden", open);
    if (open) {
      loadWeek(); // 캐시가 유효하면 바로 뜨고, 아니면 새로 받아 온다
      checkStatus();
    }
  }
  launcher.addEventListener("click", () => toggle(true));

  renderTabs();
  renderBody();
})();
