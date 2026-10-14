// HSU PLUS content script (e클래스 화면 담당). 팀명은 ON-Track, 작품명은 HSU PLUS
// e클래스 메인 화면에 패널을 띄우고, 다른 사이트 데이터는 service worker(background.js)에 요청한다.
// 데이터를 가져오는 코드는 adapters/에, 여기는 "그리기"만 담당한다.

(() => {
  // 메인 화면(강좌 전체보기)에서만 동작
  const isMainPage = document.body?.id === "page-site-index";

  if (!isMainPage) return; // 과목 페이지 꾸미기·강의 위치로 이동은 content/course.js
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

  // 확장을 새로고침(업데이트)하면, 그 전에 열려 있던 e클래스 탭의 옛 코드는 확장과 연결이 끊긴다
  // ("Extension context invalidated"). 오류로 남기지 않고, 패널에 "페이지 새로고침" 안내만 띄운다.
  let deadContext = false;
  const isDeadContext = (err) => {
    try {
      if (!chrome.runtime?.id) return true;
    } catch {
      return true;
    }
    return /Extension context invalidated/i.test(String(err?.message || err || ""));
  };
  function onDeadContext() {
    if (deadContext) return;
    deadContext = true;
    renderDeadNotice();
  }
  function renderDeadNotice() {
    body.replaceChildren(
      el("div", { class: "notice" }, [
        el("p", { text: "HSU PLUS가 업데이트됐어요." }),
        el("p", { class: "sub", text: "이 페이지를 새로고침하면 다시 동작해요." }),
        el("button", { class: "btn", text: "페이지 새로고침", onclick: () => location.reload() }),
      ])
    );
  }

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
  function loginCard(site, retry = () => loadWeek({ force: true })) {
    return el("div", { class: "notice" }, [
      el("p", { text: `${site}에 로그인되어 있지 않아요.` }),
      el("p", { class: "sub", text: "로그인한 뒤 다시 시도해 주세요." }),
      el("div", { class: "row" }, [
        el("a", { class: "btn", href: LOGIN_URL[site] || "#", target: "_blank", rel: "noopener", text: "로그인하러 가기" }),
        el("button", { class: "btn ghost", text: "다시 시도", onclick: retry }),
      ]),
    ]);
  }

  function failCard(message, retry = () => loadWeek({ force: true })) {
    return el("div", { class: "notice warn" }, [
      el("p", { text: "불러오기에 실패했어요." }),
      el("p", { class: "sub", text: message || "" }),
      el("button", { class: "btn ghost", text: "다시 시도", onclick: retry }),
    ]);
  }

  // ---------- 탭 ----------
  const TABS = [
    { id: "week", label: "이번 주" },
    { id: "calendar", label: "캘린더" },
    { id: "programs", label: "비교과" },
    { id: "ai", label: "AI" }, // 예전 "알림" 탭. 알림은 각 탭의 빨간 점·색으로 충분해서 AI 탭으로 바꿈 (10/14)
  ];

  const launcher = el("button", { class: "launcher", text: "+", title: "HSU PLUS 열기" });
  const panel = el("section", { class: "panel hidden", "aria-label": "HSU PLUS" });
  // 넓게 보기: 어느 탭에서든 쓸 수 있게 파란 머리줄에 둔다
  const wideBtn = el("button", {
    class: "wide-toggle",
    text: "넓게 보기",
    onclick: () => {
      const on = panel.classList.toggle("wide");
      wideBtn.textContent = on ? "좁게 보기" : "넓게 보기";
      rerender();
    },
  });
  const header = el("header", {}, [
    el("strong", { text: "HSU PLUS" }),
    el("div", { class: "head-actions" }, [wideBtn, el("button", { class: "close", text: "×", title: "닫기", onclick: () => toggle(false) })]),
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
    if (deadContext) return renderDeadNotice();
    body.replaceChildren(content, statusSection);
    if (current === "week") return renderWeek();
    if (current === "calendar") return renderCalendar();
    if (current === "programs") return renderPrograms();
    if (current === "ai") return renderAI();
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
      if (isDeadContext(err)) return onDeadContext();
      week = { ok: false, items: [], error: { kind: "network", message: "백그라운드와 통신하지 못했어요: " + err.message } };
    }
    loading = false;
    if (current === "week") renderWeek();
    if (current === "calendar") renderCalendar();
  }

  /** 이번 주 범위 안의 항목만 시간순으로 */
  function weekItems() {
    const { start, end } = weekRange();
    return (week?.items || [])
      .filter((it) => {
        const t = new Date(it.start);
        return t >= start && t < end;
      })
      .sort((a, b) => new Date(a.start) - new Date(b.start));
  }

  // ---------- 캘린더 탭: 요일 × 시간 격자 ----------
  const HOUR_PX = 44; // 1시간 높이
  // ---------- 과목 색 토큰 ----------
  // 색상환을 18칸으로 나눠 과목마다 한 칸씩 준다 (한 학기 최대 18과목 가정).
  // 처음 보는 과목은 이미 쓴 색과 가장 먼 칸 중에서 무작위로 고르고, 저장해 두어 다음에도 같은 색이 나온다.
  // 과목 색은 캘린더 블록에만 쓴다 (할 일 카드에 배경색을 넣어 봤더니 정신없어서 뺐음, 10/10)
  const COLOR_SLOTS = 18;
  const COLOR_KEY = "ui:courseColors";
  // 마감 임박 빨강(약 358°)과 헷갈리지 않게 빨강 근처(338°~22°)는 비우고, 나머지에 18칸을 고르게 놓는다
  const slotHue = (slot) => Math.round(22 + (slot * 316) / (COLOR_SLOTS - 1));
  function colorToken(slot) {
    const h = slotHue(slot);
    const dark = h >= 40 && h <= 170 ? 38 : 47; // 노랑·초록 계열은 흰 글자가 보이게 더 어둡게
    return { c: `hsl(${h} 58% ${dark}%)` };
  }
  // 같은 과목이 사이트마다 이름이 조금씩 다르다: 시간표 "운영체제(N)" / e클래스 "운영체제[A,N]" → 괄호 부분과 공백을 빼고 비교
  const courseKey = (name) => String(name || "").normalize("NFC").replace(/[[(][^\])]*[\])]/g, "").replace(/\s+/g, "").toLowerCase();

  let courseColors = null; // { 과목키: 칸 번호 }
  const colorsReady = chrome.storage.local
    .get(COLOR_KEY)
    .then((r) => (courseColors = r[COLOR_KEY] || {}))
    .catch(() => (courseColors = {}));
  function pickSlot() {
    const used = Object.values(courseColors);
    if (!used.length) return Math.floor(Math.random() * COLOR_SLOTS);
    const dist = (a, b) => Math.min(Math.abs(a - b), COLOR_SLOTS - Math.abs(a - b));
    const score = (s) => Math.min(...used.map((u) => dist(s, u)));
    const free = [...Array(COLOR_SLOTS).keys()].filter((s) => !used.includes(s));
    const pool = free.length ? free : [...Array(COLOR_SLOTS).keys()]; // 18개를 넘으면 겹칠 수밖에 없음
    const best = Math.max(...pool.map(score));
    const top = pool.filter((s) => score(s) === best);
    return top[Math.floor(Math.random() * top.length)];
  }
  /** 과목 이름 → 색 토큰 (색을 아직 못 불러왔으면 null) */
  function courseColor(name) {
    const key = courseKey(name);
    if (!key || !courseColors) return null;
    if (courseColors[key] == null) {
      courseColors[key] = pickSlot();
      try {
        chrome.storage.local.set({ [COLOR_KEY]: courseColors }).catch(() => {});
      } catch {} // 확장 연결이 끊긴 탭이면 저장만 건너뜀
    }
    return colorToken(courseColors[key]);
  }
  colorsReady.then(() => rerender());
  const minutesOf = (d) => d.getHours() * 60 + d.getMinutes();

  function renderCalendar() {
    const head = el("div", { class: "section-head" }, [
      el("span", { class: "title", text: "이번 주 시간표" }),
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

    const { start: monday, end: sunday } = weekRange();
    // 수업 + 날짜·시각이 정해진 내 비교과 회차 (기간만 있는 비교과는 올리지 않는다)
    const items = [...weekItems(), ...programSessionsIn(monday, sunday)];
    const now = new Date();

    // 보여줄 요일: 월~금 기본, 토·일은 수업이 있을 때만
    const dayIdx = (d) => (d.getDay() + 6) % 7; // 월=0 … 일=6
    const used = new Set(items.map((it) => dayIdx(new Date(it.start))));
    const cols = [0, 1, 2, 3, 4].concat([5, 6].filter((i) => used.has(i)));

    // 보여줄 시간 범위: 기본 9~18시, 수업이 더 이르거나 늦으면 넓힌다
    let minH = 9;
    let maxH = 18;
    for (const it of items) {
      minH = Math.min(minH, new Date(it.start).getHours());
      const e = new Date(it.end || it.start);
      maxH = Math.max(maxH, e.getMinutes() ? e.getHours() + 1 : e.getHours());
    }
    const totalPx = (maxH - minH) * HOUR_PX;

    const grid = el("div", { class: "tt" });
    grid.style.setProperty("--tt-cols", cols.length);

    // 머리줄: 빈칸 + 요일
    grid.appendChild(el("div", { class: "tt-corner" }));
    for (const c of cols) {
      const d = new Date(monday);
      d.setDate(d.getDate() + c);
      grid.appendChild(el("div", { class: sameDay(d, now) ? "tt-day today" : "tt-day", text: `${DAY[d.getDay()]} ${d.getDate()}` }));
    }

    // 시간 눈금
    const hours = el("div", { class: "tt-hours" });
    hours.style.height = totalPx + "px";
    for (let h = minH; h < maxH; h++) {
      const lab = el("div", { class: "tt-hour", text: String(h) });
      lab.style.top = (h - minH) * HOUR_PX + "px";
      hours.appendChild(lab);
    }
    grid.appendChild(hours);

    // 요일 칸
    for (const c of cols) {
      const d = new Date(monday);
      d.setDate(d.getDate() + c);
      const col = el("div", { class: sameDay(d, now) ? "tt-col today" : "tt-col" });
      col.style.height = totalPx + "px";
      col.style.backgroundSize = `100% ${HOUR_PX}px`;

      for (const it of items.filter((x) => dayIdx(new Date(x.start)) === c)) {
        const s = new Date(it.start);
        const e = new Date(it.end || it.start);
        const top = ((minutesOf(s) - minH * 60) / 60) * HOUR_PX;
        const height = Math.max(((minutesOf(e) - minutesOf(s)) / 60) * HOUR_PX, 18);
        const tip = `${it.isProgram ? "[비교과] " : ""}${it.course || it.title}${it.session && it.session !== it.title ? `\n${it.session}` : ""}\n${hm(s)}–${hm(e)}\n${[it.place, it.professor].filter(Boolean).join(" · ")}`;
        const block = el(it.isProgram ? "a" : "div", { class: ["tt-block", it.isProgram ? "prog" : "", e < now ? "past" : ""].filter(Boolean).join(" "), title: tip, href: it.isProgram ? it.url : null, target: it.isProgram ? "_blank" : null, rel: it.isProgram ? "noopener" : null }, [
          it.isProgram ? el("div", { class: "tt-tag", text: "비교과" }) : null,
          el("div", { class: "tt-name", text: it.course || it.title }),
          it.place ? el("div", { class: "tt-place", text: it.place }) : null,
        ]);
        block.style.top = top + "px";
        block.style.height = height - 2 + "px";
        if (!it.isProgram) block.style.background = courseColor(it.course || it.title)?.c || "var(--ot-muted)";
        col.appendChild(block);
      }

      // 지금 시각 선
      if (sameDay(d, now)) {
        const m = minutesOf(now);
        if (m >= minH * 60 && m <= maxH * 60) {
          const line = el("div", { class: "tt-now" });
          line.style.top = ((m - minH * 60) / 60) * HOUR_PX + "px";
          col.appendChild(line);
        }
      }
      grid.appendChild(col);
    }

    const parts = [head];
    if (week.error) parts.push(el("p", { class: "stale", text: "새로 불러오지 못해 예전 데이터를 보여주고 있어요." }));
    if (!items.length) parts.push(el("p", { class: "placeholder", text: "이번 주 수업이 없어요." }));
    else if (items.some((it) => it.isProgram)) parts.push(el("p", { class: "tt-legend", text: "흰 칸 = 날짜·시각이 정해진 내 비교과 (기간만 있는 비교과는 비교과 탭에서)" }));
    parts.push(grid);
    content.replaceChildren(...parts);
  }

  // ---------- 이번 주 탭: 액자 하나 + 위쪽 선택(강의 / 과제 / 퀴즈) ----------
  // 수업 목록은 넣지 않는다 (본인이 이미 아는 정보이고, 캘린더 탭에 있다).
  // 신청 가능한 비교과도 넣지 않는다 (비교과 탭에서 본다). 내가 신청한 비교과(#9)는 나중에 여기 들어올 수 있음.
  // 남은 것을 "이번 주"로 자르지 않고 전부 마감 순으로 보여준다.
  //  → 일요일에 "이번 주 할 일 없네" 했는데 월요일 마감이 숨어 있는 경우를 막는다.
  // 전부 늘어놓으면 길어서, 액자 위쪽에서 강의·과제·퀴즈 중 하나를 골라 본다.
  // 각 종류에 마감 이틀 이내가 하나라도 있으면 그 이름 옆에 빨간 점.
  // 한 과목에 2개 이상이면 과목 줄 하나로 묶어 접어 둔다 (누르면 펼침).
  // 줄은 흰 바탕, 마감 이틀 이내만 왼쪽 빨간 줄 (돋부기 방식).
  const KINDS = [
    { id: "video", label: "강의", empty: "지금 들어야 할 강의가 없어요." },
    { id: "assignment", label: "과제", empty: "남은 과제가 없어요." },
    { id: "quiz", label: "퀴즈", empty: "남은 퀴즈가 없어요." },
    { id: "program", label: "비교과", empty: "7일 안에 있는 내 비교과 일정이나 남은 설문이 없어요." },
  ];
  let weekKind = "video"; // 지금 고른 칸 (다시 그려도 유지)

  // ---------- 숨기기 (10/14) ----------
  // 선택 과제·오프라인으로 낸 과제처럼 계속 남아 거슬리는 항목을 숨긴다. 이 브라우저에만 저장 { 항목 id: 숨긴 시각 }
  // 숨긴 항목은 개수·빨간 점·AI 답에서도 빠진다. 칸 맨 아래 "숨긴 항목 N개"에서 되돌릴 수 있다.
  const HIDE_KEY = "ui:hidden";
  let hidden = {};
  chrome.storage.local
    .get(HIDE_KEY)
    .then((r) => {
      hidden = r[HIDE_KEY] || {};
      // 오래된 기록 정리 (120일)
      const old = Date.now() - 120 * 86400000;
      for (const [k, t] of Object.entries(hidden)) if (t < old) delete hidden[k];
      rerender();
    })
    .catch(() => {});
  const isHidden = (id) => !!hidden[id];
  function setHidden(id, on) {
    if (on) hidden[id] = Date.now();
    else delete hidden[id];
    try {
      chrome.storage.local.set({ [HIDE_KEY]: hidden }).catch(() => {});
    } catch {} // 확장 연결이 끊긴 탭이면 저장만 건너뜀
    renderWeek();
  }
  const hideBtn = (id) =>
    el("button", {
      class: "hide-btn",
      title: "숨기기 (이 브라우저에서만)",
      "aria-label": "숨기기",
      text: "×",
      onclick: (e) => {
        e.preventDefault();
        e.stopPropagation();
        setHidden(id, true);
      },
    });
  let showHiddenList = false;

  // ---------- 이번 주 탭: 비교과 칸 ----------
  // 오늘부터 7일 안의 내 비교과 회차(날짜·시각이 정해진 것) + 설문 필요. 신청 가능한 비교과는 비교과 탭에서.
  const PROGRAM_DAYS = 7;
  function programTodos(now = new Date()) {
    if (!mine?.ok) return [];
    const until = now.getTime() + PROGRAM_DAYS * 86400000;
    const out = mine.data.surveys.map((p) => ({ id: `survey:${p.id}`, kind: "survey", p, at: null }));
    for (const p of mine.data.programs) {
      for (const s of p.sessions) {
        if (s.kind !== "exact") continue;
        const t = new Date(s.start).getTime();
        if (new Date(s.end).getTime() < now.getTime() || t > until) continue;
        out.push({ id: `mine:${p.id}:${s.start}`, kind: "session", p, s, at: s.start });
      }
    }
    // 설문 먼저(지금 할 수 있는 일), 그다음 회차 시작 순
    return out.sort((a, b) => (a.at ? new Date(a.at).getTime() : 0) - (b.at ? new Date(b.at).getTime() : 0));
  }
  function sessionCard(x) {
    const { p, s } = x;
    const st = new Date(s.start);
    const days = daysLeft(s.start);
    return el("a", { class: `tcard r${riskTier(s.start)}`, href: p.url, target: "_blank", rel: "noopener" }, [
      el("div", { class: "tc-main" }, [
        el("div", { class: "info" }, [el("div", { class: "tc-title", text: p.title }), el("div", { class: "tc-sub", text: [s.name && s.name !== p.title ? s.name : null, p.place || p.department].filter(Boolean).join(" · ") })]),
        hideBtn(x.id),
      ]),
      el("div", { class: "tc-foot" }, [
        el("span", { class: "dline" }, [
          icon("clock"),
          el("span", { class: days <= 0 ? "dchip today" : `dchip r${riskTier(s.start)}`, text: days <= 0 ? "오늘" : `D-${days}` }),
          el("span", { class: "when", text: `${dayLabel(st)} ${hm(st)}–${hm(new Date(s.end))}` }),
        ]),
        el("span", { class: "tc-status plain", text: "참여 예정" }),
      ]),
    ]);
  }
  const programTodoCard = (x) => (x.kind === "survey" ? surveyCard(x.p, x.id) : sessionCard(x));

  // 강의 칸 맨 위: 출석까지 남은 시청 시간 합계 (강의마다 영상 길이의 90% − 들은 시간)
  function watchSummary(items) {
    let sec = 0;
    let unknown = 0;
    for (const it of items) {
      if (!it.meta?.lengthSec) {
        unknown++;
        continue;
      }
      sec += Math.max(0, ATTEND_RATIO * it.meta.lengthSec - (it.meta.learnedSec || 0));
    }
    const doomed = items.filter((it) => absenceCertain(it)).length;
    const parts = [`출석까지 남은 시청 ${mmss(sec)}`, `${items.length}개`];
    return el("div", { class: "sum-line", title: "강의마다 출석 기준(영상 길이의 90%)까지 남은 시간을 더했어요." }, [
      icon("clock"),
      el("span", { text: parts.join(" · ") }),
      unknown ? el("span", { class: "muted", text: ` (길이 모르는 강의 ${unknown}개 제외)` }) : null,
      doomed ? el("span", { class: "warn", text: ` · 출석 어려움 ${doomed}` }) : null,
    ]);
  }

  // 숨긴 항목 되돌리기 (지금 고른 칸의 것만)
  function hiddenSection(items, nameOf) {
    if (!items.length) return null;
    const btn = el("button", {
      class: "hidden-toggle",
      text: showHiddenList ? `숨긴 항목 ${items.length}개 접기` : `숨긴 항목 ${items.length}개 보기`,
      onclick: () => {
        showHiddenList = !showHiddenList;
        renderWeek();
      },
    });
    return el("div", { class: "hidden-box" }, [
      btn,
      showHiddenList
        ? el(
            "div",
            { class: "hidden-list" },
            items.map((x) => el("div", { class: "hidden-row" }, [el("span", { class: "name", text: nameOf(x) }), el("button", { class: "small", text: "다시 보이기", onclick: () => setHidden(x.id, false) })]))
          )
        : null,
    ]);
  }

  function renderWeek() {
    if (current !== "week") return;
    const now = new Date();
    const head = el("div", { class: "section-head" }, [
      el("span", { class: "meta", text: eclassLoading ? "불러오는 중…" : eclass?.fetchedAt ? `e클래스 ${ago(eclass.fetchedAt)}` : "" }),
      el("button", {
        class: "small",
        text: "새로고침",
        disabled: eclassLoading ? "" : null,
        onclick: () => {
          loadEclass({ force: true });
          loadMine({ force: true });
        },
      }),
    ]);

    // 종류별 남은 항목 (숨긴 것 빼고). all = 숨긴 것 포함 (되돌리기 목록용)
    let all = null;
    if (eclass?.ok) {
      const pending = eclass.data.items.filter((it) => it.status === "todo" && (!it.due || new Date(it.due) >= now)).sort(byDue);
      all = {
        // 강의: 수강 기간이 시작된 것만 (기간 없는 보충 영상은 출석과 무관해서 뺀다)
        video: pending.filter((it) => it.type === "video" && it.due && (!it.start || new Date(it.start) <= now)),
        assignment: pending.filter((it) => it.type === "assignment"),
        quiz: pending.filter((it) => it.type === "quiz"),
      };
    }
    const progAll = programTodos(now);
    const lists = {
      video: all ? all.video.filter((it) => !isHidden(it.id)) : null,
      assignment: all ? all.assignment.filter((it) => !isHidden(it.id)) : null,
      quiz: all ? all.quiz.filter((it) => !isHidden(it.id)) : null,
      program: mine?.ok ? progAll.filter((x) => !isHidden(x.id)) : null,
    };
    const hotOf = (k) => (k === "program" ? (lists.program || []).some((x) => x.kind === "survey" || isUrgent(x.at)) : (lists[k] || []).some((it) => isUrgent(it.due)));

    const seg = el(
      "div",
      { class: "seg", role: "tablist" },
      KINDS.map((k) => {
        const items = lists[k.id];
        const hot = hotOf(k.id);
        return el(
          "button",
          {
            class: k.id === weekKind ? "seg-btn active" : "seg-btn",
            role: "tab",
            "aria-selected": String(k.id === weekKind),
            title: hot ? (k.id === "program" ? "설문이 남았거나 이틀 안에 일정이 있어요" : "마감 이틀 이내 항목이 있어요") : null,
            onclick: () => {
              weekKind = k.id;
              showHiddenList = false;
              renderWeek();
            },
          },
          [
            el("span", { class: "lbl" }, [el("span", { text: k.label }), hot ? el("span", { class: "dot", "aria-label": "확인 필요" }) : null]),
            items ? el("span", { class: "n", text: String(items.length) }) : null,
          ]
        );
      })
    );

    const kind = KINDS.find((k) => k.id === weekKind);
    let bodyParts;
    if (weekKind === "program") {
      if (!mine) bodyParts = [placeholder("내 비교과를 확인하고 있어요…")];
      else if (!mine.ok) {
        const e = mine.error || {};
        bodyParts = [e.kind === "login" ? loginCard(e.site || "비교과 (스마트자기관리시스템)", () => loadMine({ force: true })) : failCard(e.message, () => loadMine({ force: true }))];
      } else {
        bodyParts = [];
        if (mine.error) bodyParts.push(el("p", { class: "stale", text: "비교과를 새로 불러오지 못해 예전 데이터를 보여주고 있어요." }));
        bodyParts.push(lists.program.length ? rows(lists.program.map(programTodoCard)) : placeholder(kind.empty));
        bodyParts.push(hiddenSection(progAll.filter((x) => isHidden(x.id)), (x) => x.p.title));
      }
    } else if (!eclass) bodyParts = [placeholder("과목별 과제와 강의를 확인하고 있어요…")];
    else if (!eclass.ok) bodyParts = [failCard(eclass.error?.message, () => loadEclass({ force: true }))];
    else {
      const items = lists[weekKind];
      bodyParts = [];
      if (eclass.error) bodyParts.push(el("p", { class: "stale", text: "e클래스를 새로 불러오지 못해 예전 데이터를 보여주고 있어요." }));
      if (weekKind === "video" && items.length) bodyParts.push(watchSummary(items));
      bodyParts.push(items.length ? rows(grouped(weekKind, items, kind.label)) : placeholder(kind.empty));
      bodyParts.push(hiddenSection(all[weekKind].filter((it) => isHidden(it.id)), (it) => `${it.title} · ${it.course || ""}`));
    }

    const frame = el("div", { class: "frame" }, [seg, el("div", { class: "frame-body" }, bodyParts)]);
    content.replaceChildren(head, frame);
  }

  // ---------- 할 일 카드 (돋부기 카드 구조 참고) ----------
  //  ┃ 제목                         (2개 이상 묶음이면 과목명 + "과제 N개" + ▾)
  //  ┃ 과목명 · 수강률
  //  ┃ ⏱ [D-4] 10/16(금) 23:55            ⚠ 제출 필요     ← 연회색 아래 띠
  // 왼쪽 라벨 색 = 마감 위험도 5단계(riskTier). 출석이 어려운 강의는 🚨 안내문 + 필요/남은 시간
  const SVGNS = "http://www.w3.org/2000/svg";
  const ICONS = {
    clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 7.5V12l3 2"],
    warn: ["M10.3 4 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0z", "M12 9.5v4", "M12 17h.01"],
  };
  function icon(name) {
    const svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", "ico");
    svg.setAttribute("aria-hidden", "true");
    for (const d of ICONS[name]) {
      const path = document.createElementNS(SVGNS, "path");
      path.setAttribute("d", d);
      svg.appendChild(path);
    }
    return svg;
  }
  const NEED = { video: "수강 필요", assignment: "제출 필요", quiz: "응시 필요" };

  // 아래 띠 왼쪽: 시계 + D-day 칩 + 요일 붙은 날짜 (한 줄)
  function dueLine(iso) {
    if (!iso) return el("span", { class: "dline" }, [icon("clock"), el("span", { class: "when", text: "기한 없음" })]);
    const d = new Date(iso);
    const e = dueDay(iso);
    const days = daysLeft(iso);
    return el("span", { class: "dline", title: dueText(iso) }, [
      icon("clock"),
      el("span", { class: days <= 0 ? "dchip today" : `dchip r${riskTier(iso)}`, text: days <= 0 ? "오늘" : `D-${days}` }),
      el("span", { class: "when", text: `${md(e)}(${DAY[e.getDay()]}) ${isMidnight(d) ? "24:00" : hm(d)}` }),
    ]);
  }
  const footer = (iso, status, doomed = false) =>
    el("div", { class: "tc-foot" }, [
      dueLine(iso),
      el("span", { class: doomed ? "tc-status doomed" : "tc-status" }, [doomed ? el("span", { class: "siren", text: "🚨" }) : icon("warn"), el("span", { text: status })]),
    ]);

  const pctText = (it) => (it.type === "video" && it.meta?.percent != null ? `${it.meta.percent}% 수강` : "");

  // 강의는 강의 화면 대신 강의실(과목 페이지)의 그 강의 위치로 보낸다 (예전 캐시엔 courseId가 없으면 원래 주소)
  const openUrl = (it) =>
    it.type === "video" && it.meta?.courseId && it.meta?.cmid
      ? `https://learn.hansung.ac.kr/course/view.php?id=${it.meta.courseId}#hsuplus-module-${it.meta.cmid}`
      : it.url;

  function taskCard(it) {
    const doomed = absenceCertain(it);
    const tip = doomed ? `출석 인정 기준(영상 길이의 90%, ${mmss(ATTEND_RATIO * it.meta.lengthSec)})까지 남은 시간으로 계산했어요.` : null;
    return el("a", { class: `tcard r${riskTier(it.due)}${doomed ? " doomed" : ""}`, href: openUrl(it), target: "_blank", rel: "noopener", title: tip }, [
      el("div", { class: "tc-main" }, [
        el("div", { class: "info" }, [
          el("div", { class: "tc-title", text: it.title }),
          el("div", { class: "tc-sub", text: [it.course, pctText(it)].filter(Boolean).join(" · ") }),
          doomed
            ? el("div", { class: "tc-alert" }, [
                el("div", { class: "msg", text: "🚨 지금부터 들어도 출석 인정 시간을 채우기 어려워요" }),
                el("div", { class: "nums", text: absenceNumbers(it) }),
              ])
            : null,
        ]),
        hideBtn(it.id),
      ]),
      footer(it.due, doomed ? "출석 어려움" : NEED[it.type] || "확인 필요", doomed),
    ]);
  }

  // 묶음 카드 안의 한 줄 (제목 + 오른쪽 D-day 칩·날짜)
  function subItem(it) {
    const doomed = absenceCertain(it);
    return el("a", { class: doomed ? "sub-item doomed" : "sub-item", href: openUrl(it), target: "_blank", rel: "noopener" }, [
      el("div", { class: "info" }, [
        el("div", { class: "name", text: it.title }),
        pctText(it) ? el("div", { class: "sub", text: pctText(it) }) : null,
        doomed ? el("div", { class: "sub alert", text: `🚨 출석 어려움 · ${absenceNumbers(it)}` }) : null,
      ]),
      dueEl(it.due),
      hideBtn(it.id),
    ]);
  }

  // 과목별로 묶기: 1개면 카드 하나, 2개 이상이면 접는 과목 카드. 순서는 각 과목의 가장 가까운 마감 순.
  const openGroups = new Set(); // 펼친 카드 (다시 그려도 유지)
  function grouped(sectionId, items, noun) {
    const groups = new Map();
    for (const it of items) {
      const k = courseKey(it.course);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(it); // items가 이미 마감 순이라 각 묶음 안도 마감 순
    }
    return [...groups.entries()].map(([k, list]) => {
      if (list.length === 1) return taskCard(list[0]);
      const id = `${sectionId}:${k}`;
      const open = openGroups.has(id);
      const first = list[0];
      const doomedN = list.filter((it) => absenceCertain(it)).length;
      return el("div", { class: ["tcard", "group", `r${riskTier(first.due)}`, open ? "open" : ""].filter(Boolean).join(" ") }, [
        el(
          "button",
          {
            class: "tc-main tc-toggle",
            "aria-expanded": String(open),
            onclick: () => {
              open ? openGroups.delete(id) : openGroups.add(id);
              renderWeek();
            },
          },
          [
            el("div", { class: "info" }, [el("div", { class: "tc-title", text: first.course }), el("div", { class: "tc-sub", text: `${noun} ${list.length}개` })]),
            el("span", { class: "chev", text: "▾" }),
          ]
        ),
        open ? el("div", { class: "tc-list" }, list.map(subItem)) : null,
        footer(first.due, doomedN ? `출석 어려움 ${doomedN}` : `${NEED[first.type] || "확인 필요"} ${list.length}`, doomedN > 0),
      ]);
    });
  }

  // 화면 조각
  const placeholder = (text) => el("p", { class: "placeholder", text });
  const rows = (children) => el("div", { class: "todos" }, children);
  function section(title, note, children) {
    return el("div", { class: "block" }, [
      el("div", { class: "section-head" }, [el("span", { class: "title", text: title }), el("span", { class: "meta", text: note || "" })]),
      ...children,
    ]);
  }

  // ================================================================ M2: e클래스 과제·영상, 비교과
  // 공용 모듈(공통 형식, 캐시, 어댑터)을 동적으로 불러온다 (content script는 import문을 못 씀)
  const mods = Promise.all([
    import(chrome.runtime.getURL("core/cache.js")),
    import(chrome.runtime.getURL("adapters/eclass.js")),
    import(chrome.runtime.getURL("adapters/hsportal.js")),
    import(chrome.runtime.getURL("core/ai.js")),
  ]).then(([cache, eclass, hsportal, ai]) => ({ cache, eclass, hsportal, ai }));

  // 다른 학교 사이트 페이지 글은 백그라운드가 받아 준다
  async function getText(url) {
    const r = await send({ type: "fetchText", url });
    if (!r || r.ok === false) throw new Error(r?.error?.message || `요청 실패 (${r?.status})`);
    return r.text;
  }

  const plainErr = (err) => ({
    kind: err?.name === "LoginRequiredError" ? "login" : err?.name === "ParseError" ? "parse" : "network",
    site: err?.site || null,
    message: String(err?.message || err),
  });

  let eclass = null; // { ok, data: {courses, items, failed}, fetchedAt, error }
  let eclassLoading = false;
  async function loadEclass({ force = false } = {}) {
    eclassLoading = true;
    rerender();
    try {
      const { cache, eclass: ad } = await mods;
      const r = await cache.getOrFetch("eclass", cache.TTL.ECLASS, () => ad.fetchEclass(document), { force });
      eclass = { ok: true, data: r.data, fetchedAt: r.fetchedAt, error: r.error ? plainErr(r.error) : null };
      logItems("e클래스 과제·영상", r.data.items);
      if (r.data.failed?.length) console.warn("[HSU PLUS] 일부 과목을 읽지 못함", r.data.failed);
    } catch (err) {
      if (isDeadContext(err)) return onDeadContext();
      console.warn("[HSU PLUS] e클래스 불러오기 실패:", err);
      eclass = { ok: false, error: plainErr(err) };
    }
    eclassLoading = false;
    rerender();
  }

  let programs = null; // { ok, data: items[], fetchedAt, error }
  let programsLoading = false;
  async function loadPrograms({ force = false } = {}) {
    programsLoading = true;
    rerender();
    try {
      const { cache, hsportal } = await mods;
      const r = await cache.getOrFetch("programs-open", cache.TTL.PROGRAMS, () => hsportal.fetchOpenPrograms(getText), { force });
      programs = { ok: true, data: r.data, fetchedAt: r.fetchedAt, error: r.error ? plainErr(r.error) : null };
      logItems("접수중 비교과", r.data);
    } catch (err) {
      if (isDeadContext(err)) return onDeadContext();
      console.warn("[HSU PLUS] 비교과 불러오기 실패:", err);
      programs = { ok: false, error: plainErr(err) };
    }
    programsLoading = false;
    rerender();
  }

  // 내 비교과 (마이페이지: 신청 현황·포인트·설문). 비교과 사이트에 로그인해 있어야 한다
  let mine = null; // { ok, data: {points, programs, surveys}, fetchedAt, error }
  let mineLoading = false;
  async function loadMine({ force = false } = {}) {
    mineLoading = true;
    rerender();
    try {
      const { cache, hsportal } = await mods;
      const r = await cache.getOrFetch("programs-mine", cache.TTL.MYPROGRAMS, () => hsportal.fetchMyPrograms(getText), { force });
      mine = { ok: true, data: r.data, fetchedAt: r.fetchedAt, error: r.error ? plainErr(r.error) : null };
    } catch (err) {
      if (isDeadContext(err)) return onDeadContext();
      if (err?.name !== "LoginRequiredError") console.warn("[HSU PLUS] 내 비교과 불러오기 실패:", err);
      mine = { ok: false, error: plainErr(err) };
    }
    mineLoading = false;
    rerender();
  }

  function rerender() {
    if (deadContext) return renderDeadNotice();
    if (current === "week") renderWeek();
    else if (current === "calendar") renderCalendar();
    else if (current === "programs") renderPrograms();
    else if (current === "ai" && !content.querySelector(".ai-input")?.value) renderAI(); // 입력 중이면 다시 그리지 않음
  }

  // 공통 형식으로 잘 바뀌었는지 콘솔에서 확인 (M2 완료 기준)
  function logItems(label, items) {
    console.log(`[HSU PLUS] ${label}: ${items.length}건`);
    console.table(items.map((it) => ({ 종류: it.type, 과목: it.course, 제목: it.title, 마감: it.due, 상태: it.status, ...(it.meta?.percent != null ? { 수강률: it.meta.percent + "%" } : {}), ...(it.meta?.point != null ? { 포인트: it.meta.point } : {}) })));
  }

  const TYPE_LABEL = { assignment: "과제", quiz: "퀴즈", video: "영상", program: "비교과" };
  // 00:00(:59) 마감은 사실상 "전날 밤 12시"다. 10/13 00:00으로 보이면 13일 하루가 더 있는 줄 알기 쉬워서
  // 전날 24:00으로 보여주고, D-day와 이번 주/다음 주 구분도 전날 기준으로 한다.
  const isMidnight = (d) => d.getHours() === 0 && d.getMinutes() === 0;
  function dueDay(iso) {
    const d = new Date(iso);
    return isMidnight(d) ? new Date(d.getTime() - 60 * 1000) : d;
  }
  // 남은 날짜 수. 시각 차이가 아니라 "날짜" 차이로 센다 (10/10 오후에 10/12 마감 → 2)
  function daysLeft(iso) {
    const day0 = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    return Math.round((day0(dueDay(iso)) - day0(new Date())) / 86400000);
  }
  // 오른쪽 마감 표시: 위에 D-day 칩, 아래에 요일 붙은 날짜 (글자가 한 줄로 주룩 늘어지지 않게)
  //  오늘 = 진한 빨강 칩, D-1·D-2 = 연한 빨강 칩, 나머지 = 회색 칩
  function dueEl(iso, prefix = "") {
    if (!iso) return el("span", { class: "due" }, [el("span", { class: "dchip", text: "기한 없음" })]);
    const d = new Date(iso);
    const e = dueDay(iso);
    const days = daysLeft(iso);
    const chipCls = days <= 0 ? "dchip today" : `dchip r${riskTier(iso)}`;
    const when = `${md(e)}(${DAY[e.getDay()]}) ${isMidnight(d) ? "24:00" : hm(d)}`;
    return el("span", { class: "due", title: dueText(iso) }, [
      el("span", { class: chipCls, text: days <= 0 ? "오늘" : `D-${days}` }),
      el("span", { class: "when", text: prefix ? `${prefix} ${when}` : when }),
    ]);
  }
  function dueText(iso) {
    if (!iso) return "기한 없음";
    const d = new Date(iso);
    const days = daysLeft(iso);
    const dd = days <= 0 ? "오늘" : `D-${days}`;
    return `${dd} · ${md(dueDay(iso))} ${isMidnight(d) ? "24:00" : hm(d)}`;
  }
  // 마감 임박(이틀 이내: 오늘·D-1·D-2)이면 빨갛게
  const URGENT_DAYS = 2;
  const isUrgent = (iso) => !!iso && daysLeft(iso) <= URGENT_DAYS;

  // 마감 위험도 5단계 → 카드 왼쪽 라벨·D-day 칩·상태 글자 색 (panel.css의 .r1~.r5)
  //  r1 당일·1일 남음(빨강) / r2 2일(주황빨강) / r3 3~7일(주황) / r4 8~13일(노랑) / r5 14일 이상(회청색, 장기 과제)
  //  초록은 쓰지 않는다: 안전해 보여서 "이미 제출함"으로 오해할 수 있음
  function riskTier(iso) {
    if (!iso) return 5;
    const d = daysLeft(iso);
    if (d <= 1) return 1;
    if (d === 2) return 2;
    if (d <= 7) return 3;
    if (d < 14) return 4;
    return 5;
  }

  // 출석 어려움(결석 불가피): 지금부터 쉬지 않고 들어도 출석인정기간(강의마다의 마감) 안에 출석 기준 시간을 못 채우는 강의.
  //  출석 기준 = 영상 길이의 90% 이상 시청 (예: 53:22 영상 → 약 48분. 사용자 확인, hsu-ecx 표시값과도 일치)
  //  강의마다 따로 판단한다 (일요일 마감이든, "수업 전에 듣고 올 것"처럼 더 이른 마감이든 그 강의 마감 기준).
  //  남은 시간만큼 실제로 재생해야 채워지므로(건너뛰기 불가) 남은 필요 시간과 마감까지 남은 시간을 그대로 비교한다.
  const ATTEND_RATIO = 0.9;
  function absenceCertain(it, now = Date.now()) {
    if (it.type !== "video" || !it.due || !it.meta?.lengthSec) return false;
    const needSec = ATTEND_RATIO * it.meta.lengthSec - (it.meta.learnedSec || 0);
    const leftSec = (new Date(it.due).getTime() - now) / 1000;
    return needSec > 0 && needSec > leftSec;
  }
  function absenceNumbers(it, now = Date.now()) {
    const needSec = ATTEND_RATIO * it.meta.lengthSec - (it.meta.learnedSec || 0);
    const leftSec = (new Date(it.due).getTime() - now) / 1000;
    return `${mmss(needSec)} 더 필요 · 마감까지 ${mmss(leftSec)}`;
  }
  const mmss = (sec) => {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    return h ? `${h}시간 ${m}분` : `${m}분`;
  };

  const byDue = (a, b) => new Date(a.due || 8.64e15) - new Date(b.due || 8.64e15);

  // ---------- 비교과 탭: 액자 하나 + 위쪽 선택(신청 / 내 비교과) ----------
  //  신청      = 1주일 안에 신청 마감인 접수중 비교과 (세부 분류는 나중에)
  //  내 비교과 = 졸업 인정 포인트 / 800, 시작 대기, 진행 중, 설문을 아직 안 낸 종료 프로그램(종료 목록 1쪽),
  //              맨 아래 온라인(LMS에서 기간 안에 듣는 형식)은 기간만
  // 일정 종류(adapters/hsportal.js scheduleKind): exact(며칠 몇 시) / online / open(기간만, 세부 일정 따로)
  //  → exact만 날짜·시각과 D-day를 크게 보여주고 캘린더에 올린다
  const GRAD_POINTS = 800; // 졸업 요건 비교과 포인트 (사용자 확인, 학과·학번마다 다를 수 있음)
  const PKINDS = [
    { id: "apply", label: "신청" },
    { id: "mine", label: "내 비교과" },
  ];
  let progKind = "apply";

  // 비교과 한 줄 (신청)
  function programRow(it) {
    const m = it.meta || {};
    const seats = m.capacity ? `${m.applied ?? "?"}/${m.capacity}명${m.full ? " · 정원 마감" : ""}` : m.applied != null ? `${m.applied}명 신청` : "";
    const runAt = it.start ? `운영 ${md(new Date(it.start))}` : "";
    const cls = ["todo", m.full ? "full" : "", isUrgent(it.due) ? "urgent" : ""].filter(Boolean).join(" ");
    return el("a", { class: cls, href: it.url, target: "_blank", rel: "noopener" }, [
      el("span", { class: "badge program", text: m.point ? `${m.point}p` : "비교과" }),
      el("div", { class: "info" }, [el("div", { class: "name", text: it.title }), el("div", { class: "sub", text: [m.department, runAt, seats].filter(Boolean).join(" · ") })]),
      dueEl(it.due, "신청"),
    ]);
  }

  const dayLabel = (d) => `${md(d)}(${DAY[d.getDay()]})`;
  const endLabel = (iso) => {
    const d = new Date(iso);
    return isMidnight(d) ? `${dayLabel(dueDay(iso))} 24:00` : `${dayLabel(d)} ${hm(d)}`;
  };
  const periodText = (s) => (s.end ? `${dayLabel(new Date(s.start))} ~ ${endLabel(s.end)}` : `${dayLabel(new Date(s.start))}부터`);
  const exactSessions = (p) => p.sessions.filter((s) => s.kind === "exact");
  // 카드 기준 회차: 날짜·시각이 정해진 다음 회차, 없으면 첫 회차
  const nextSession = (p) => exactSessions(p)[0] || p.sessions[0];
  const isOnlineOnly = (p) => p.sessions.every((s) => s.kind === "online");

  // 아래 띠 왼쪽: 일정
  function scheduleLine(p) {
    const s = nextSession(p);
    if (s.kind === "exact") {
      const st = new Date(s.start);
      const days = daysLeft(s.start);
      const more = exactSessions(p).length - 1;
      return el("span", { class: "dline" }, [
        icon("clock"),
        el("span", { class: days <= 0 ? "dchip today" : `dchip r${riskTier(s.start)}`, text: days <= 0 ? "오늘" : `D-${days}` }),
        el("span", { class: "when", text: `${dayLabel(st)} ${hm(st)}–${hm(new Date(s.end))}${more > 0 ? ` 외 ${more}회` : ""}` }),
      ]);
    }
    return el("span", { class: "dline" }, [icon("clock"), el("span", { class: "dchip", text: "일정 미정", title: "기간만 공지돼 있고 세부 일정은 따로 안내돼요 (추후 공지, 회차마다 다름 등)" }), el("span", { class: "when", text: periodText(s) })]);
  }

  function myProgramCard(p) {
    const s = nextSession(p);
    const tier = s.kind === "exact" ? riskTier(s.start) : 5;
    const state = p.phase === "wait" ? (p.status && p.status !== "참여승인" ? p.status : "시작 대기") : "진행 중";
    return el("a", { class: `tcard r${tier}`, href: p.url, target: "_blank", rel: "noopener", title: s.name && s.name !== p.title ? s.name : null }, [
      el("div", { class: "tc-main" }, [
        el("div", { class: "info" }, [
          el("div", { class: "tc-title", text: p.title }),
          el("div", { class: "tc-sub", text: [p.category, p.place || p.department].filter(Boolean).join(" · ") }),
        ]),
      ]),
      el("div", { class: "tc-foot" }, [scheduleLine(p), el("span", { class: "tc-status plain", text: state })]),
    ]);
  }

  function surveyCard(p, hideId = null) {
    const done = /이수\d/.test(p.issuance) ? `이수 ${p.issuance.replace(/^이수\s*\d{4}-0?(\d+)-0?(\d+).*/, "$1/$2")}` : p.issuance;
    return el("a", { class: "tcard r2", href: p.listUrl, target: "_blank", rel: "noopener", title: "종료된 프로그램 목록에서 설문조사 버튼을 눌러 작성해요" }, [
      el("div", { class: "tc-main" }, [
        el("div", { class: "info" }, [el("div", { class: "tc-title", text: p.title }), el("div", { class: "tc-sub", text: [p.category, done].filter(Boolean).join(" · ") })]),
        hideId ? hideBtn(hideId) : null,
      ]),
      el("div", { class: "tc-foot" }, [
        el("span", { class: "dline" }, [el("span", { class: "when", text: p.mileage ? `${p.mileage}점 프로그램` : "종료된 프로그램" })]),
        el("span", { class: "tc-status" }, [icon("warn"), el("span", { text: "설문 필요" })]),
      ]),
    ]);
  }

  // 온라인: 기간만, 작게
  function onlineRow(p) {
    const s = p.sessions[0];
    return el("a", { class: "todo quiet", href: p.url, target: "_blank", rel: "noopener" }, [
      el("div", { class: "info" }, [el("div", { class: "name", text: p.title }), el("div", { class: "sub", text: `${periodText(s)}${p.phase === "wait" ? " · 시작 대기" : ""}` })]),
    ]);
  }

  // 졸업 인정 포인트 / 800
  function pointCard(pt) {
    const have = pt.graduation ?? pt.total ?? 0;
    const left = Math.max(0, GRAD_POINTS - have);
    const done = left === 0;
    const bar = el("div", { class: "pt-bar" }, [el("div", { class: done ? "pt-fill done" : "pt-fill" })]);
    bar.firstChild.style.width = `${Math.min(100, (have / GRAD_POINTS) * 100)}%`;
    return el("div", { class: "pt-card" }, [
      el("div", { class: "pt-top" }, [
        el("div", {}, [
          el("div", { class: "pt-label", text: "졸업 인정 비교과 포인트" }),
          el("div", { class: "pt-num" }, [el("b", { text: String(have) }), el("span", { text: ` / ${GRAD_POINTS}점` })]),
        ]),
        el("div", { class: done ? "pt-left done" : "pt-left" }, done ? [el("b", { text: "졸업 요건 달성" })] : [el("span", { text: "졸업까지" }), el("b", { text: `${left}점` })]),
      ]),
      bar,
      el("div", { class: "pt-foot", text: [pt.semester != null ? `이번 학기 +${pt.semester}점` : "", pt.total != null ? `전체 누적 ${pt.total}점` : ""].filter(Boolean).join(" · ") }),
    ]);
  }

  const secTitle = (title, n, note) => el("div", { class: "sec-title" }, [el("span", { text: title }), n != null ? el("span", { class: "n", text: String(n) }) : null, note ? el("span", { class: "note", text: note }) : null]);
  const byNext = (a, b) => new Date(nextSession(a).start) - new Date(nextSession(b).start);

  function mineGroups() {
    const ps = mine?.ok ? mine.data.programs : [];
    const online = ps.filter(isOnlineOnly);
    const rest = ps.filter((p) => !isOnlineOnly(p));
    return {
      surveys: mine?.ok ? mine.data.surveys : [],
      wait: rest.filter((p) => p.phase === "wait").sort(byNext),
      progress: rest.filter((p) => p.phase === "progress").sort(byNext),
      online: online.sort((a, b) => new Date(a.sessions[0].end || 8.64e15) - new Date(b.sessions[0].end || 8.64e15)),
    };
  }

  function renderMine() {
    if (!mine) return [placeholder("신청한 비교과와 포인트를 확인하고 있어요…")];
    if (!mine.ok) {
      const e = mine.error || {};
      return [e.kind === "login" ? loginCard(e.site || "비교과 (스마트자기관리시스템)", () => loadMine({ force: true })) : failCard(e.message, () => loadMine({ force: true }))];
    }
    const g = mineGroups();
    const parts = [];
    if (mine.error) parts.push(el("p", { class: "stale", text: "새로 불러오지 못해 예전 데이터를 보여주고 있어요." }));
    parts.push(el("div", { class: "pad" }, [pointCard(mine.data.points || {})]));
    if (g.surveys.length) parts.push(secTitle("설문 필요", g.surveys.length, "종료된 프로그램"), rows(g.surveys.map(surveyCard)));
    parts.push(secTitle("시작 대기", g.wait.length), g.wait.length ? rows(g.wait.map(myProgramCard)) : placeholder("시작을 기다리는 비교과가 없어요."));
    parts.push(secTitle("진행 중", g.progress.length), g.progress.length ? rows(g.progress.map(myProgramCard)) : placeholder("진행 중인 비교과가 없어요."));
    if (g.online.length) parts.push(secTitle("온라인", g.online.length, "기간 안에 참여"), rows(g.online.map(onlineRow)));
    return parts;
  }

  function renderPrograms() {
    const loadingAny = programsLoading || mineLoading;
    const fetchedAt = progKind === "mine" ? mine?.fetchedAt : programs?.fetchedAt;
    const head = el("div", { class: "section-head" }, [
      el("span", { class: "meta", text: loadingAny ? "불러오는 중…" : fetchedAt ? `비교과 ${ago(fetchedAt)}` : "" }),
      el("button", {
        class: "small",
        text: "새로고침",
        disabled: loadingAny ? "" : null,
        onclick: () => {
          loadPrograms({ force: true });
          loadMine({ force: true });
        },
      }),
    ]);

    const now = Date.now();
    const soon = programs?.ok ? programs.data.filter((it) => it.due && new Date(it.due).getTime() >= now && new Date(it.due).getTime() <= now + 7 * 86400000) : null;
    const g = mine?.ok ? mineGroups() : null;
    const counts = {
      apply: soon ? soon.length : null,
      mine: g ? g.surveys.length + g.wait.length + g.progress.length + g.online.length : null,
    };
    const hot = {
      apply: !!soon?.some((it) => isUrgent(it.due)),
      // 설문을 안 낸 게 있거나, 날짜가 정해진 회차가 이틀 안이면 빨간 점
      mine: !!g && (g.surveys.length > 0 || [...g.wait, ...g.progress].some((p) => exactSessions(p).some((s) => isUrgent(s.start)))),
    };
    const seg = el(
      "div",
      { class: "seg", role: "tablist" },
      PKINDS.map((k) =>
        el(
          "button",
          {
            class: k.id === progKind ? "seg-btn active" : "seg-btn",
            role: "tab",
            "aria-selected": String(k.id === progKind),
            onclick: () => {
              progKind = k.id;
              renderPrograms();
            },
          },
          [
            el("span", { class: "lbl" }, [el("span", { text: k.label }), hot[k.id] ? el("span", { class: "dot", "aria-label": "확인 필요" }) : null]),
            counts[k.id] != null ? el("span", { class: "n", text: String(counts[k.id]) }) : null,
          ]
        )
      )
    );

    let bodyParts;
    if (progKind === "mine") bodyParts = renderMine();
    else if (!programs) bodyParts = [placeholder("불러오는 중…")];
    else if (!programs.ok) bodyParts = [failCard(programs.error?.message, () => loadPrograms({ force: true }))];
    else {
      bodyParts = [secTitle("1주일 안에 신청 마감", soon.length)];
      if (programs.error) bodyParts.push(el("p", { class: "stale", text: "새로 불러오지 못해 예전 데이터를 보여주고 있어요." }));
      bodyParts.push(soon.length ? rows(soon.map(programRow)) : placeholder("1주일 안에 신청이 마감되는 비교과가 없어요."));
    }
    content.replaceChildren(head, el("div", { class: "frame prog" }, [seg, el("div", { class: "frame-body" }, bodyParts)]));
  }

  // 캘린더에 올릴 내 비교과 회차: 날짜·시각이 정해진 것(exact)만
  function programSessionsIn(start, end) {
    if (!mine?.ok) return [];
    return mine.data.programs.flatMap((p) =>
      exactSessions(p)
        .filter((s) => new Date(s.start) >= start && new Date(s.start) < end)
        .map((s) => ({ start: s.start, end: s.end, title: p.title, session: s.name, place: p.place, url: p.url, isProgram: true }))
    );
  }

  // ---------- AI 탭 (예전 "알림" 탭 자리) ----------
  // 상업 사이트 챗봇처럼: 자주 쓰는 질문은 버튼으로, 직접 입력은 200자까지.
  // 지금은 AI 서버를 아직 연결하지 않아서(결제 전) 브라우저 안에서 정해진 방식으로 답한다.
  //  → 이 "기본 답변"은 AI 연결 뒤에도 하루 한도를 넘었거나 서버가 안 될 때 그대로 쓰인다.
  // 답은 "문장 한 줄 + 실제 항목 카드". 날짜·마감은 항상 학교에서 가져온 값으로 그린다.
  // 질문 판단·보낼 정보 정리는 core/ai.js
  const AI_ENDPOINT = ""; // AI 서버(Cloudflare Worker) 주소. 비어 있으면 기본 답변만
  const chat = []; // { who: "me"|"bot", text, picks?, note? } (이 탭을 연 동안만 기억)
  let aiPreviewOpen = false;

  function aiData() {
    return {
      eclassItems: eclass?.ok ? eclass.data.items.filter((it) => !isHidden(it.id)) : [], // 숨긴 항목은 AI 답에서도 뺀다
      myPrograms: mine?.ok ? { ...mine.data, surveys: mine.data.surveys.filter((p) => !isHidden(`survey:${p.id}`)) } : null,
      openPrograms: programs?.ok ? programs.data : [],
      timetable: week?.ok ? week.items : [],
    };
  }

  async function ask(question, presetId) {
    const { ai } = await mods;
    const q = ai.sanitizeQuestion(question);
    if (!q) return;
    const last = chat[chat.length - 2];
    if (last && last.who === "me" && last.text === q) return; // 같은 질문 연속은 무시
    chat.push({ who: "me", text: q });
    const built = ai.buildContext(aiData());
    const intent = presetId || ai.detectIntent(q);
    const a = ai.localAnswer(intent, built, new Date(), { kinds: presetId ? [] : ai.detectKinds(q) });
    chat.push({ who: "bot", text: a.text, picks: a.picks.map((p) => ({ ...p, ref: built.refs.get(p.id) })).filter((p) => p.ref), note: a.note });
    while (chat.length > 30) chat.shift();
    renderAI({ scroll: true });
  }

  // 답 카드 한 줄: 실제 항목으로 그린다
  function pickRow(p) {
    const r = p.ref;
    const it = r.item;
    if (r.kind === "task") {
      const kind = { video: "강의", assignment: "과제", quiz: "퀴즈" }[it.type];
      return el("a", { class: "ai-pick", href: openUrl(it), target: "_blank", rel: "noopener" }, [
        el("span", { class: `badge ${it.type}`, text: kind }),
        el("div", { class: "info" }, [el("div", { class: "name", text: it.title }), el("div", { class: "sub", text: [it.course, p.reason].filter(Boolean).join(" · ") })]),
        dueEl(it.due),
      ]);
    }
    if (r.kind === "survey") {
      return el("a", { class: "ai-pick", href: it.listUrl, target: "_blank", rel: "noopener" }, [
        el("span", { class: "badge survey", text: "설문" }),
        el("div", { class: "info" }, [el("div", { class: "name", text: it.title }), el("div", { class: "sub", text: p.reason || "종료된 프로그램 · 설문 필요" })]),
      ]);
    }
    const s = r.kind === "mine" ? r.session : null;
    const when = r.kind === "mine" ? (s?.kind === "exact" ? `${dayLabel(new Date(s.start))} ${hm(new Date(s.start))}–${hm(new Date(s.end))}` : s ? periodText(s) : "") : "";
    return el("a", { class: "ai-pick", href: it.url, target: "_blank", rel: "noopener" }, [
      el("span", { class: "badge program", text: r.kind === "open" ? (it.meta?.point ? `${it.meta.point}p` : "신청") : "내 비교과" }),
      el("div", { class: "info" }, [el("div", { class: "name", text: it.title }), el("div", { class: "sub", text: [p.reason || when, r.kind === "open" ? "신청 가능" : null].filter(Boolean).join(" · ") })]),
      r.kind === "open" ? dueEl(it.due, "신청") : null,
    ]);
  }

  function renderAI({ scroll = false } = {}) {
    if (current !== "ai") return;
    const loadingAny = eclassLoading || programsLoading || mineLoading || loading;
    const head = el("div", { class: "ai-head" }, [
      el("div", { class: "ai-title" }, [el("strong", { text: "HSU PLUS AI" }), el("span", { class: "ai-mode", text: AI_ENDPOINT ? "AI 연결됨" : "기본 답변 모드" })]),
      el("div", { class: "ai-sub", text: loadingAny ? "정보를 불러오는 중이에요…" : "수업·과제·비교과 일정만 도와드려요." }),
    ]);

    const log = el("div", { class: "chat" });
    log.appendChild(el("div", { class: "msg bot" }, [el("div", { class: "bubble", text: "무엇을 도와드릴까요? 아래 버튼을 누르거나 직접 물어보세요." })]));
    for (const m of chat) {
      const bubble = el("div", { class: "bubble", text: m.text });
      const parts = [bubble];
      if (m.picks?.length) parts.push(el("div", { class: "ai-picks" }, m.picks.map(pickRow)));
      if (m.note) parts.push(el("div", { class: "ai-note", text: m.note }));
      log.appendChild(el("div", { class: `msg ${m.who}` }, parts));
    }

    const presets = el(
      "div",
      { class: "ai-presets" },
      PRESET_LIST.map((p) => el("button", { class: "chip", text: p.label, onclick: () => ask(p.label, p.id) }))
    );
    const input = el("input", { class: "ai-input", type: "text", maxlength: "200", placeholder: "예: 이번 주 과제 뭐 남았어?" });
    const counter = el("span", { class: "ai-count", text: "0/200" });
    input.addEventListener("input", () => (counter.textContent = `${input.value.length}/200`));
    const send = () => {
      const v = input.value;
      input.value = "";
      ask(v);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) send();
    });
    const form = el("div", { class: "ai-form" }, [input, el("button", { class: "btn", text: "보내기", onclick: send })]);

    // 보낼 내용 보기: AI 연결 뒤 실제로 나가게 될 정보를 그대로 보여 준다 (지금은 아무것도 나가지 않음)
    const preview = el("details", { class: "ai-preview" }, [
      el("summary", { text: "AI에 보낼 내용 보기" }),
      el("p", { class: "ai-note", text: AI_ENDPOINT ? "질문할 때 아래 내용만 보내요. 이름·학번·성적·연락처는 보내지 않아요." : "지금은 AI 연결 전이라 아무것도 밖으로 보내지 않아요. 연결되면 질문할 때 아래 내용만 보내요. 이름·학번·성적·연락처는 보내지 않아요." }),
      el("pre", { class: "ai-json" }),
    ]);
    if (aiPreviewOpen) preview.open = true;
    preview.addEventListener("toggle", async () => {
      aiPreviewOpen = preview.open;
      if (!preview.open) return;
      const { ai } = await mods;
      preview.querySelector("pre").textContent = JSON.stringify(ai.buildContext(aiData()).context, null, 1);
    });
    if (aiPreviewOpen) mods.then(({ ai }) => (preview.querySelector("pre").textContent = JSON.stringify(ai.buildContext(aiData()).context, null, 1)));

    content.replaceChildren(head, el("div", { class: "frame ai-frame" }, [log, el("div", { class: "ai-bottom" }, [presets, form, el("div", { class: "ai-foot" }, [counter, preview])])]));
    if (scroll) log.lastElementChild?.scrollIntoView({ block: "nearest" });
  }
  // core/ai.js의 PRESETS와 같은 내용 (모듈을 불러오기 전에도 버튼을 그리려고 여기 둠)
  const PRESET_LIST = [
    { id: "today", label: "오늘 뭐 해야 돼?" },
    { id: "week", label: "이번 주 일정 요약" },
    { id: "free", label: "비는 시간에 할 비교과" },
    { id: "points", label: "졸업 포인트 얼마 남았어?" },
  ];

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
      if (isDeadContext(err)) return onDeadContext();
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
      loadEclass();
      loadPrograms();
      loadMine();
      checkStatus();
    }
  }
  launcher.addEventListener("click", () => toggle(true));

  renderTabs();
  renderBody();
})();
