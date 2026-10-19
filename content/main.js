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

  // 디자인: 10/20 시안 A(또렷하게) 선택 — 지금 구조 그대로, 머리줄 로고·그라데이션, 둥근 탭 밑줄, e클래스 바탕 회색
  const launcher = el("button", { class: "launcher", title: "HSU PLUS 열기" }, [el("span", { class: "logo", text: "+" })]);
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
    el("div", { class: "brand" }, [el("span", { class: "logo", "aria-hidden": "true", text: "+" }), el("strong", { text: "HSU PLUS" }), el("span", { class: "brand-sub", text: "e클래스 도우미" })]),
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

  /**
   * 시간표를 보여줄 주(월요일 시작)에 맞춰 놓는다.
   * 종합정보 시간표는 학교 화면처럼 "일요일 시작" 주를 돌려줘서, 일요일에 받으면 다음 주 날짜가 온다(10/18 확인).
   * 그래서 날짜 대신 "요일 + 시각"으로 보여줄 주에 다시 놓는다 (수업은 매주 같은 시간이라 가능).
   */
  function weekItems(monday = weekRange().start) {
    return (week?.items || [])
      .map((it) => {
        const s = new Date(it.start);
        const e = new Date(it.end || it.start);
        const off = (s.getDay() + 6) % 7; // 월=0 … 일=6
        const start = new Date(monday);
        start.setDate(start.getDate() + off);
        start.setHours(s.getHours(), s.getMinutes(), 0, 0);
        const end = new Date(start.getTime() + (e - s));
        return { ...it, start: start.toISOString(), end: end.toISOString() };
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
  // ---------- 내 설정 저장: 같은 구글 계정으로 로그인한 크롬끼리 똑같이 보이게 (10/18) ----------
  // 과목 색·숨긴 항목·(나중에) 직접 넣은 일정처럼 "내가 정한 것"은 chrome.storage.sync에 둔다.
  // 학교에서 불러온 데이터(캐시)는 기기마다 다시 불러오면 되니 local 그대로.
  // 항목 하나 = sync 키 하나 ("hide|항목id": 숨긴 시각). 두 기기에서 따로 바꿔도 키마다 합쳐져서 서로 덮어쓰지 않는다.
  // sync 한도: 키 512개, 전체 100KB, 분당 쓰기 120회 → 바뀐 것을 모아 0.5초 뒤 한 번에 쓴다.
  // 크롬에 로그인 안 했거나 동기화를 꺼 두면 sync도 이 브라우저에만 남는다(나중에 켜면 그때 합쳐짐).
  const pending = { set: {}, remove: new Set() };
  let flushTimer = null;
  function flushUser() {
    flushTimer = null;
    const set = pending.set;
    const remove = [...pending.remove];
    pending.set = {};
    pending.remove = new Set();
    try {
      if (Object.keys(set).length) chrome.storage.sync.set(set).catch((e) => console.warn("[HSU PLUS] 설정 저장 실패", e));
      if (remove.length) chrome.storage.sync.remove(remove).catch(() => {});
    } catch {} // 확장 연결이 끊긴 탭이면 저장만 건너뜀
  }
  /** 내 설정 묶음(ns) 전체 읽기 → { id: 값 }. legacyKey: 예전 버전이 이 브라우저에만 저장하던 키 (한 번 옮기고 지움) */
  async function userMap(ns, legacyKey) {
    const out = {};
    try {
      const all = await chrome.storage.sync.get(null);
      for (const [k, v] of Object.entries(all)) if (k.startsWith(`${ns}|`)) out[k.slice(ns.length + 1)] = v;
    } catch {}
    if (legacyKey) {
      try {
        const old = (await chrome.storage.local.get(legacyKey))[legacyKey];
        if (old && typeof old === "object") {
          for (const [id, v] of Object.entries(old)) if (!(id in out)) userPut(ns, id, (out[id] = v));
          chrome.storage.local.remove(legacyKey).catch(() => {});
        }
      } catch {}
    }
    return out;
  }
  /** 항목 하나 저장 (value가 null이면 지움) */
  function userPut(ns, id, value) {
    const k = `${ns}|${id}`;
    if (value == null) {
      delete pending.set[k];
      pending.remove.add(k);
    } else {
      pending.remove.delete(k);
      pending.set[k] = value;
    }
    if (!flushTimer) flushTimer = setTimeout(flushUser, 500);
  }
  /** 다른 기기에서 바꾼 것이 도착하면 열린 화면도 맞춘다: fn(id, 새 값 | undefined) */
  function onUserChange(ns, fn) {
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "sync") return;
        let hit = false;
        for (const [k, c] of Object.entries(changes)) {
          if (!k.startsWith(`${ns}|`)) continue;
          fn(k.slice(ns.length + 1), c.newValue);
          hit = true;
        }
        if (hit) rerender();
      });
    } catch {}
  }

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
  const colorsReady = userMap("color", COLOR_KEY).then((v) => (courseColors = v));
  onUserChange("color", (id, v) => {
    if (!courseColors) return;
    if (v == null) delete courseColors[id];
    else courseColors[id] = v;
  });
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
      userPut("color", key, courseColors[key]);
    }
    return colorToken(courseColors[key]);
  }
  colorsReady.then(() => rerender());
  const minutesOf = (d) => d.getHours() * 60 + d.getMinutes();

  // ================= 캘린더 탭 (10/19): 주간·월간, 과제·퀴즈·강의 마감, 직접 넣은 일정, 내보내기 =================
  // 주간: 수업 + 날짜·시각이 정해진 내 비교과(매주 회차 포함) + 직접 넣은 일정이 시간 칸에, 마감·날짜만 일정은 요일 아래 "종일" 줄에.
  // 월간: 수업은 빼고(매주 같아서) 비교과·마감·직접 넣은 일정만.
  // 날짜를 누르면 그날 목록이 아래에 열리고, 일정마다 "구글 캘린더에 추가"가 있다.
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  /**
   * 캘린더 칸에 넣을 짧은 이름 (10/20 사용자: "10:00 2026-…"처럼 잘려서 뭔지 모름)
   * "2026-2학기 집단상담 프로그램" → "집단상담", "[재맞고]26-2학기 AI 실무…" → "AI 실무…", "2026학년도 2학기 학습법 워크숍" → "학습법 워크숍"
   * 학기·연도 머리말, 맨 앞 [머리표], 끝의 "프로그램"만 뗀다. 원래 이름은 마우스를 올리거나 그날 목록에서 보인다.
   */
  // 동그라미 i: 마우스를 올리거나(키보드로 가면) 설명이 뜬다. 맨 아래 안내문은 아무도 안 봐서 위쪽에 둠 (10/20 사용자)
  function infoTip(text, label = "안내") {
    return el("span", { class: "info-tip" }, [
      el("button", { type: "button", class: "info-btn", "aria-label": label, text: "i" }),
      el("span", { class: "tip", role: "tooltip", text }),
    ]);
  }
  const SCHEDULE_NOTE_APPLY = "일정 분류(날짜·시각 확정, 매주, 온라인 등)는 안내문과 회차 시각으로 자동으로 정한 것이라 틀릴 수 있어요. 정확한 일정은 카드의 '상세 일정 확인 ↗'에서 학교 화면을 꼭 확인하세요.";
  const SCHEDULE_NOTE_MINE = "일정(매주·기간 등)은 자동으로 정리한 것이라 틀릴 수 있어요. 카드를 누르면 학교 상세 화면이 열리니 정확한 일정은 거기서 확인하세요.";
  // 비교과 일정은 자동 분류라 완벽하지 않음 → 학교 상세 화면 바로가기 (10/20 사용자)
  const detailLink = (url) =>
    url ? el("a", { class: "detail-link", href: url, target: "_blank", rel: "noopener", title: "일정 분류는 자동이라 틀릴 수 있어요. 정확한 일정은 학교 상세 화면에서 확인하세요.", text: "상세 일정 확인 ↗" }) : null;
  function shortTitle(t) {
    const orig = String(t || "").trim();
    let s = orig.replace(/^(\[[^\]]{1,12}\]\s*)+/, "");
    s = s.replace(/^(20)?\d{2}\s*(학년도|년도|년)?\s*(\s*[-–.]\s*[12]|\s*(제)?\s*[12]\s*학기|\s*(하계|동계)(\s*방중)?)?\s*(학기)?\s*\)?\s*/, (m) => (/\d{2}/.test(m) ? "" : m));
    s = s.replace(/^[12]\s*학기\s*/, "");
    s = s.replace(/\s*프로그램$/, "");
    return s.length >= 2 ? s : orig;
  }
  const fromYmd = (s, t = "00:00") => {
    const [y, m, dd] = s.split("-").map(Number);
    const [h, mi] = t.split(":").map(Number);
    return new Date(y, m - 1, dd, h || 0, mi || 0, 0, 0);
  };
  const addDays = (d, n) => {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  };
  const dayStart = (d) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };

  // ---- 직접 넣은 일정: 내 설정(sync)의 "ev" 묶음 ----
  // { t 제목, d "YYYY-MM-DD"|null, m "YYYY-MM"|null(대략: 그 달 중), s "HH:MM"|null, e "HH:MM"|null, p 장소, n 메모, g 연결된 비교과 번호, at 만든 시각 }
  // 톡방으로만 공지되는 비교과, 학교 밖 개인 일정 등. 학교에서 가져온 일정보다 우선해서 보여준다.
  let events = {};
  userMap("ev").then((v) => {
    events = v;
    rerender();
  });
  onUserChange("ev", (id, v) => {
    if (v == null) delete events[id];
    else events[id] = v;
  });
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  function saveEvent(id, ev) {
    events[id] = ev;
    userPut("ev", id, ev);
  }
  function deleteEvent(id) {
    delete events[id];
    userPut("ev", id, null);
  }
  /** 직접 넣은 일정의 시각 { start, end, allDay, rough } (rough = "그 달 중") */
  function evTime(ev) {
    if (ev.d && ev.s) {
      const start = fromYmd(ev.d, ev.s);
      let end = ev.e ? fromYmd(ev.d, ev.e) : new Date(start.getTime() + 3600000);
      if (end <= start) end = new Date(start.getTime() + 3600000);
      return { start, end, allDay: false };
    }
    if (ev.d) return { start: fromYmd(ev.d), end: fromYmd(ev.d), allDay: true };
    if (ev.m) {
      const [y, m] = ev.m.split("-").map(Number);
      return { start: new Date(y, m - 1, 1), end: new Date(y, m, 0), allDay: true, rough: true };
    }
    return null;
  }
  const eventList = () =>
    Object.entries(events)
      .map(([id, ev]) => ({ id, ev, tm: ev.w ? null : evTime(ev) }))
      .filter((x) => x.tm);
  // 매주 반복 일정 (알바·학원 등, 10/20): { t, w: [요일 0=일…6=토], s, e, from, until, p, n }
  const fixedList = () => Object.entries(events).filter(([, ev]) => Array.isArray(ev.w) && ev.w.length && ev.s && ev.e).map(([id, ev]) => ({ id, ev }));
  /** from~to 안의 매주 반복 일정 회차들 */
  function fixedOccurrences(from, to) {
    const out = [];
    for (const { id, ev } of fixedList()) {
      for (let d = dayStart(from); d < to; d = addDays(d, 1)) {
        const key = ymd(d);
        if (!ev.w.includes(d.getDay()) || (ev.from && key < ev.from) || (ev.until && key > ev.until)) continue;
        out.push({ kind: "fix", id, ev, title: ev.t, place: ev.p, start: fromYmd(key, ev.s), end: fromYmd(key, ev.e), allDay: false });
      }
    }
    return out;
  }
  const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  /** 매주 반복 → 캘린더 반복 규칙 (구글 링크·.ics) */
  const fixedRule = (ev) => `FREQ=WEEKLY;BYDAY=${ev.w.map((d) => BYDAY[d]).join(",")}${ev.until ? `;UNTIL=${ev.until.replace(/-/g, "")}T235959` : ""}`;
  /** 지금 이어지고 있는 매주 반복 일정 → 수업처럼 "매주 이 요일 이 시각"으로 (비교과 겹침 확인용) */
  function fixedSlots(now = new Date()) {
    const today = ymd(now);
    const m = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    return fixedList()
      .filter(({ ev }) => !ev.until || ev.until >= today)
      .flatMap(({ ev }) => ev.w.map((day) => ({ day, from: m(ev.s), to: m(ev.e), name: ev.t })));
  }

  // ---- 내 비교과 회차 (날짜·시각이 정해진 것 + 매주 회차 + 며칠짜리) ----
  // 매주 회차(예: 11/3 10:00 ~ 11/24 13:00, "3시간*4회")는 공개 상세 화면 안내문까지 보고 판단한다 (core/classify.js)
  function myShape(p) {
    if (!C) return null;
    const key = `mine:${p.id}`;
    if (!classified.has(key)) classified.set(key, C.classifyProgram({ title: p.title, text: details[p.id]?.d?.text || "", sessions: p.sessions, pick: null }));
    return classified.get(key);
  }
  /** from~to 안의 내 비교과 회차. 시간 칸에 놓을 것(allDay: false)과 종일 줄에 놓을 것(allDay: true) */
  function mySessions(from, to) {
    if (!mine?.ok) return [];
    const out = [];
    for (const p of mine.data.programs) {
      const ss = myShape(p)?.sessions || p.sessions;
      for (const s of ss) {
        const st = new Date(s.start);
        const en = new Date(s.end || s.start);
        const base = { kind: "prog", p, s, title: p.title, session: s.name && s.name !== p.title ? s.name : null, place: p.place, url: p.url };
        if (s.kind === "exact") {
          if (st >= from && st < to) out.push({ ...base, start: st, end: en, uid: `mine-${p.id}-${st.getTime()}` });
        } else if (s.kind === "recurring") {
          // 매주 같은 요일: 첫 회 시작 시각 ~ 마지막 회 끝 시각
          for (let d = new Date(st); d <= en; d = addDays(d, 7)) {
            const e2 = new Date(d);
            e2.setHours(en.getHours(), en.getMinutes(), 0, 0);
            if (d >= from && d < to) out.push({ ...base, start: new Date(d), end: e2, weekly: true, uid: `mine-${p.id}-${d.getTime()}` });
          }
        } else if (s.kind === "multi_day" || s.kind === "date_only") {
          if (st < to && en >= from) out.push({ ...base, start: st, end: en, allDay: true, uid: `mine-${p.id}-${st.getTime()}` });
        }
      }
    }
    return out;
  }
  /** 기간형 내 비교과(온라인·제출형·장기처럼 시각이 정해진 회차가 없는 것)의 끝나는 때 (10/20) */
  function programEnds() {
    if (!mine?.ok) return [];
    const out = [];
    for (const p of mine.data.programs) {
      const ss = myShape(p)?.sessions || p.sessions;
      for (const s of ss) if (["long", "period", "online", "open"].includes(s.kind) && s.end) out.push({ p, s, due: new Date(s.end).toISOString() });
    }
    return out;
  }
  // 예전 이름 (AI 탭 등에서 씀): 시간 칸에 놓을 회차만
  function programSessionsIn(start, end) {
    return mySessions(start, end)
      .filter((x) => !x.allDay)
      .map((x) => ({ start: x.start.toISOString(), end: x.end.toISOString(), title: x.title, session: x.session, place: x.place, url: x.url, isProgram: true, weekly: x.weekly }));
  }

  // ---- e클래스 마감 (과제·퀴즈·강의, 아직 안 한 것, 숨긴 것 제외) ----
  const deadlines = () => (eclass?.ok ? eclass.data.items.filter((it) => it.due && it.status === "todo" && ["assignment", "quiz", "video"].includes(it.type) && !isHidden(it.id)) : []);
  const DUE_NOUN = { assignment: "과제", quiz: "퀴즈", video: "강의" };

  /** 하루(date)에 걸친 종일 항목: 마감 + 며칠짜리 비교과 + 날짜만 일정 */
  function allDayOf(date, list) {
    const a = dayStart(date);
    const b = addDays(a, 1);
    return list.filter((x) => x.start < b && dayStart(x.end) >= a);
  }

  /** from~to의 캘린더 항목. kind: prog / ev / due (수업은 주간에서 따로) */
  function calItems(from, to) {
    const out = [...mySessions(from, to), ...fixedOccurrences(from, to)];
    for (const it of deadlines()) {
      const day = dueDay(it.due); // 0시 마감은 전날 24:00
      if (day >= from && day < to) out.push({ kind: "due", it, title: it.title, sub: [DUE_NOUN[it.type], it.course].filter(Boolean).join(" · "), start: dayStart(day), end: dayStart(day), allDay: true, url: it.url, due: it.due });
    }
    for (const { id, ev, tm } of eventList()) {
      if (tm.rough) continue;
      if (tm.start < to && tm.end >= from) out.push({ kind: "ev", id, ev, title: ev.t, place: ev.p, start: tm.start, end: tm.end, allDay: tm.allDay });
    }
    // 기간형 내 비교과(온라인·제출형·장기)의 끝나는 날 = 마감 (10/20)
    for (const x of programEnds()) {
      const day = dueDay(x.due);
      if (day >= from && day < to) out.push({ kind: "due", title: x.p.title, sub: "비교과 기간 끝", start: dayStart(day), end: dayStart(day), allDay: true, url: x.p.url, due: x.due });
    }
    // 학교 학사일정 (신청 기간·시험·개강/종강), 숨긴 것 제외
    for (const a of academicList()) {
      const st = fromYmd(a.start);
      const en = fromYmd(a.end);
      if (st < to && en >= from) out.push({ kind: "acad", acad: a, title: a.title, start: st, end: en, allDay: true, url: ACADEMIC_URL });
    }
    return out;
  }

  // ---------- 처음 열었을 때 안내 (10/20) ----------
  // 설명 없이 써볼 수 있게: 세 사이트 연결 확인 + 탭 한 줄 소개 + 원칙. "시작하기"를 누르면 이 기기에서는 다시 안 뜸(설정에서 다시 보기)
  const WELCOME_KEY = "ui:welcomed";
  let welcomeOpen = false;
  try {
    chrome.storage.local
      .get(WELCOME_KEY)
      .then((r) => {
        welcomeOpen = !r[WELCOME_KEY];
        if (welcomeOpen) rerender();
      })
      .catch(() => {});
  } catch {}
  function showWelcome(on = true) {
    welcomeOpen = on;
    if (!on) {
      try {
        chrome.storage.local.set({ [WELCOME_KEY]: Date.now() }).catch(() => {});
      } catch {}
    }
    if (on && current !== "week") {
      current = "week";
      renderTabs();
    }
    if (on) statusSection.open = false;
    renderBody();
    if (on) body.scrollTop = 0;
  }
  function welcomeCard() {
    const siteRow = (name, ok, loginUrl) =>
      el("div", { class: `wl-site ${ok == null ? "wait" : ok ? "ok" : "ng"}` }, [
        el("span", { class: "dot" }),
        el("span", { class: "nm", text: name }),
        ok == null ? el("span", { class: "st", text: "확인 중…" }) : ok ? el("span", { class: "st", text: "연결됨" }) : el("a", { class: "st", href: loginUrl || "#", target: "_blank", rel: "noopener", text: "로그인하러 가기" }),
      ]);
    const sites = [siteRow("e클래스", conn ? conn.eclass : null, "https://learn.hansung.ac.kr/")];
    const known = conn?.sites || [
      { name: "비교과 (스마트자기관리시스템)", loggedIn: null },
      { name: "종합정보시스템", loggedIn: null },
    ];
    for (const r of known) sites.push(siteRow(r.name, r.loggedIn, r.loginUrl));
    const missing = known.filter((r) => r.loggedIn === false).length + (conn && !conn.eclass ? 1 : 0);
    const tip = (t, d) => el("li", {}, [el("b", { text: t }), el("span", { text: d })]);
    return el("div", { class: "welcome" }, [
      el("div", { class: "wl-head" }, [el("span", { class: "logo", text: "+" }), el("div", {}, [el("b", { text: "HSU PLUS를 시작해요" }), el("p", { text: "e클래스·비교과·종합정보에 흩어진 할 일과 일정을 여기서 한 번에 봐요." })])]),
      el("div", { class: "wl-sec", text: "1. 세 사이트에 로그인돼 있는지 확인" }),
      el("div", { class: "wl-sites" }, sites),
      missing
        ? el("div", { class: "wl-hint" }, [
            el("span", { text: "다른 탭에서 로그인한 뒤 눌러 주세요. 로그인 정보는 저장하지 않아요." }),
            el("button", {
              class: "small refresh",
              text: "다시 확인",
              onclick: () => {
                checkStatus();
                loadWeek({ force: true });
                loadEclass({ force: true });
                loadMine({ force: true });
              },
            }),
          ])
        : null,
      el("div", { class: "wl-sec", text: "2. 탭 소개" }),
      el("ul", { class: "wl-tabs" }, [
        tip("이번 주", "남은 강의·과제·퀴즈·비교과를 마감 순으로. 출석이 어려운 강의도 미리 알려줘요"),
        tip("캘린더", "시간표 + 비교과 + 마감을 주간·월간으로. 톡방 공지 일정은 직접 넣기"),
        tip("비교과", "신청할 만한 것(수업·알바와 안 겹치는 것만 보기), 졸업 포인트, 안 낸 설문"),
        tip("AI", "\"오늘 뭐 해야 돼?\"처럼 물어보면 실제 항목으로 답해요"),
      ]),
      el("p", { class: "wl-note", text: "학생이 만든 프로토타입이에요(학교 공식 서비스 아님). 학교 사이트는 읽기만 하고 신청·제출은 하지 않아요. 성적·연락처는 읽지 않아요." }),
      el("div", { class: "wl-actions" }, [el("button", { class: "btn", text: "시작하기", onclick: () => showWelcome(false) })]),
    ]);
  }

  // ---------- 화면 옵션 (기기 사이 동기화, opt|이름) ----------
  //  acad: 0이면 학사일정 끔 (10/20 사용자: 안 궁금할 수도 있으니 켜고 끄기). 값이 없으면 켬
  let opts = {};
  userMap("opt").then((v) => {
    opts = v;
    rerender();
  });
  onUserChange("opt", (id, v) => {
    if (v == null) delete opts[id];
    else opts[id] = v;
    if (id === "acad" && acadOn()) loadAcademic();
  });
  const acadOn = () => opts.acad !== 0;
  function setAcad(on) {
    if (on) delete opts.acad;
    else opts.acad = 0;
    userPut("opt", "acad", on ? null : 0);
    if (on) loadAcademic();
    rerender();
  }
  /** 학사일정 켜고 끄는 스위치 (이번 주 탭 학사 칸, 캘린더 아래, 설정에 같은 것) */
  function acadSwitch(label = "학사일정") {
    const on = acadOn();
    return el("button", {
      type: "button",
      class: `sw${on ? " on" : ""}`,
      role: "switch",
      "aria-checked": on ? "true" : "false",
      title: on ? "학교 학사일정(신청 기간·시험)을 이번 주 탭과 캘린더에 보여줘요. 누르면 꺼요." : "학사일정이 꺼져 있어요. 누르면 이번 주 탭과 캘린더에 다시 보여줘요.",
      onclick: (e) => {
        e.stopPropagation();
        setAcad(!acadOn());
      },
    }, [el("span", { class: "sw-label", text: label }), el("span", { class: "sw-track" }, [el("span", { class: "sw-knob" })])]);
  }

  // ---------- 학사일정 (학교 홈페이지 공개 화면, #19, 10/20) ----------
  const ACADEMIC_URL = "https://www.hansung.ac.kr/hansung/6096/subview.do";
  let academic = null; // { ok, data: [{id,title,start,end,kind}], fetchedAt, error }
  async function loadAcademic({ force = false } = {}) {
    if (!acadOn()) return; // 꺼 두면 학교 홈페이지에 요청도 하지 않음
    try {
      const { cache, hansung } = await mods;
      const r = await cache.getOrFetch("academic", cache.TTL.TIMETABLE, () => hansung.fetchAcademicCalendar(getText), { force });
      academic = { ok: true, data: r.data, fetchedAt: r.fetchedAt };
    } catch (err) {
      if (isDeadContext(err)) return onDeadContext();
      console.warn("[HSU PLUS] 학사일정 불러오기 실패:", err);
      academic = { ok: false, error: plainErr(err) };
    }
    rerender();
  }
  /** 화면에 올릴 학사일정: 신청·시험·학기 흐름 (수업일수 N일 같은 건 뺌), 숨긴 것 제외 */
  const academicList = () => (acadOn() && academic?.ok ? academic.data.filter((a) => a.kind !== "other" && !isHidden(a.id)) : []);
  /** 이번 주 탭 위쪽: 진행 중이거나 14일 안에 시작하는 신청·시험 */
  function academicSoon(now = new Date()) {
    const today = ymd(now);
    const until = ymd(addDays(now, 14));
    return academicList()
      .filter((a) => (a.kind === "apply" || a.kind === "exam") && a.end >= today && a.start <= until)
      .sort((a, b) => {
        const ga = a.start <= today;
        const gb = b.start <= today;
        if (ga !== gb) return ga ? -1 : 1; // 진행 중 먼저
        return ga ? a.end.localeCompare(b.end) : a.start.localeCompare(b.start);
      });
  }
  function academicStrip(now = new Date()) {
    if (!acadOn()) return null;
    const list = academicSoon(now);
    const today = ymd(now);
    const until = ymd(addDays(now, 14));
    const hiddenSoon = academic?.ok ? academic.data.filter((a) => isHidden(a.id) && (a.kind === "apply" || a.kind === "exam") && a.end >= today && a.start <= until) : [];
    const unhide = hiddenSoon.length
      ? el("button", {
          class: "linkish ac-unhide",
          text: `숨긴 학사일정 ${hiddenSoon.length}개 다시 보기`,
          onclick: () => hiddenSoon.forEach((a) => setHidden(a.id, false)),
        })
      : null;
    if (!list.length) return unhide ? el("div", { class: "ac-box empty" }, [unhide]) : null;
    const row = (a) => {
      const st = fromYmd(a.start);
      const en = fromYmd(a.end);
      const going = a.start <= today;
      const left = Math.round((dayStart(going ? en : st) - dayStart(now)) / 86400000);
      const when = a.start === a.end ? dayLabel(st) : `${dayLabel(st)} ~ ${dayLabel(en)}`;
      const chip = going ? (left === 0 ? "오늘까지" : `D-${left} 마감`) : left === 0 ? "오늘" : `D-${left} 시작`;
      return el("div", { class: `ac-row${going ? " going" : ""}` }, [
        el("span", { class: `ac-kind k-${a.kind}`, text: a.kind === "exam" ? "시험" : "신청" }),
        el("div", { class: "info" }, [el("div", { class: "name", text: a.title }), el("div", { class: "sub", text: when })]),
        el("span", { class: going ? "dchip r2" : "dchip", text: chip }),
        hideBtn(a.id),
      ]);
    };
    return el("div", { class: "ac-box" }, [
      el("div", { class: "ac-head" }, [el("span", { text: "학사 일정" }), el("span", { class: "grow" }), el("a", { href: ACADEMIC_URL, target: "_blank", rel: "noopener", text: "전체 보기" }), acadSwitch("")]),
      ...list.slice(0, 2).map(row), // 아래 할 일 목록을 너무 밀어내지 않게 2개까지 (나와 상관없는 건 ×로 숨김)
      list.length > 2 ? el("div", { class: "ac-more", text: `그 밖에 ${list.length - 2}개는 캘린더에서` }) : null,
      unhide,
    ]);
  }

  // 며칠씩 이어지는 학사일정(신청 기간 등)은 매일 칸을 채우면 정신없어서 첫날·끝날에만 표시 (그날 목록에는 매일 나옴)
  // 월간: 며칠 이어지는 종일 일정 중 3주(21일) 이하는 막대, 그보다 긴 것은 시작·끝 날에만 (10/20 사용자)
  const BAR_MAX_DAYS = 21;
  const BAR_LANES = 2; // 한 주에 막대 줄은 2줄까지, 넘치면 그 날짜 칸에 +N
  const spanDays = (x) => Math.round((dayStart(x.end) - dayStart(x.start)) / 864e5) + 1;
  const isBar = (x) => x.allDay && x.kind !== "due" && !x.rough && spanDays(x) > 1 && spanDays(x) <= BAR_MAX_DAYS;
  const isLong = (x) => x.allDay && spanDays(x) > BAR_MAX_DAYS;
  // 주간 종일 줄은 학사일정만 시작·끝 날에(예전대로), 월간은 긴 일정만 시작·끝 날에
  const pillOn = (x, d) => (x.kind !== "acad" && !isLong(x)) || sameDay(x.start, x.end) || sameDay(d, x.start) || sameDay(d, x.end);
  const pillName = (x, d) => (!sameDay(x.start, x.end) && (x.kind === "acad" || isLong(x)) && sameDay(d, x.end) ? `${shortTitle(x.title)} 끝` : shortTitle(x.title));

  // ---- 화면 상태 ----
  let calMode = "week"; // week | month
  let calWeek = null; // 0 = 이번 주, 1 = 다음 주 (null이면 요일에 따라 자동: 토·일엔 다음 주)
  let calWeekendOpen = null; // null이면 주말에 일정이 있을 때만 펼침
  let calMonth = null; // "YYYY-MM" (null이면 이번 달)
  let calDay = null; // 아래에 목록을 열어 둔 날 "YYYY-MM-DD"
  let calNote = ""; // 내보내기·가져오기 결과 한 줄
  let evDraft = null; // 일정 넣기/고치기 칸 (입력 중인 값)

  function openEventForm(init = {}) {
    const today = ymd(new Date());
    evDraft = { mode: "time", t: "", d: calDay || today, m: (calDay || today).slice(0, 7), s: "10:00", e: "11:00", p: "", n: "", g: null, w: [], from: today, until: "", ...init };
    if (current !== "calendar") {
      current = "calendar";
      renderTabs();
    }
    renderCalendar();
    content.querySelector(".ev-title")?.focus();
  }
  function editEvent(id) {
    const ev = events[id];
    if (!ev) return;
    const today = ymd(new Date());
    openEventForm({ id, mode: ev.w ? "weekly" : ev.s ? "time" : ev.d ? "date" : "month", t: ev.t, d: ev.d || today, m: ev.m || (ev.d || today).slice(0, 7), s: ev.s || "10:00", e: ev.e || "", p: ev.p || "", n: ev.n || "", g: ev.g || null, w: ev.w ? [...ev.w] : [], from: ev.from || today, until: ev.until || "" });
  }

  function eventForm() {
    const f = evDraft;
    const field = (label, input) => el("label", { class: "ev-field" }, [el("span", { text: label }), input]);
    const inp = (key, attrs = {}) => {
      const node = el("input", { class: "ev-input", ...attrs, oninput: (e) => (f[key] = e.target.value) });
      node.value = f[key] ?? "";
      return node;
    };
    const modeBtn = (id, label) =>
      el("button", {
        type: "button",
        class: f.mode === id ? "seg-mini active" : "seg-mini",
        text: label,
        onclick: () => {
          f.mode = id;
          renderCalendar();
        },
      });
    const err = el("p", { class: "ev-err" });
    const save = () => {
      const t = (f.t || "").trim().slice(0, 60);
      if (!t) return (err.textContent = "제목을 적어 주세요.");
      if (f.mode === "weekly") {
        // 매주 반복 (알바·학원 등 고정 일정)
        if (!f.w.length) return (err.textContent = "요일을 하나 이상 골라 주세요.");
        if (!/^\d{2}:\d{2}$/.test(f.s || "") || !/^\d{2}:\d{2}$/.test(f.e || "")) return (err.textContent = "시작·끝 시각을 골라 주세요.");
        if (f.e <= f.s) return (err.textContent = "끝 시각이 시작보다 늦어야 해요.");
        if (f.until && f.until < (f.from || "")) return (err.textContent = "끝나는 날이 시작하는 날보다 늦어야 해요.");
        saveEvent(f.id || newId(), {
          t,
          w: [...f.w].sort(),
          s: f.s,
          e: f.e,
          from: /^\d{4}-\d{2}-\d{2}$/.test(f.from || "") ? f.from : null,
          until: /^\d{4}-\d{2}-\d{2}$/.test(f.until || "") ? f.until : null,
          p: (f.p || "").trim().slice(0, 40) || null,
          n: (f.n || "").trim().slice(0, 120) || null,
          at: events[f.id]?.at || Date.now(),
        });
        evDraft = null;
        if (f.w.some((d) => d === 0 || d === 6)) calWeekendOpen = null; // 주말 고정 일정이면 자동 펼침이 다시 판단하게
        calMode = "week";
        return renderCalendar();
      }
      if (f.mode !== "month" && !/^\d{4}-\d{2}-\d{2}$/.test(f.d || "")) return (err.textContent = "날짜를 골라 주세요.");
      if (f.mode === "month" && !/^\d{4}-\d{2}$/.test(f.m || "")) return (err.textContent = "달을 골라 주세요.");
      if (f.mode === "time" && !/^\d{2}:\d{2}$/.test(f.s || "")) return (err.textContent = "시작 시각을 골라 주세요.");
      const ev = {
        t,
        d: f.mode === "month" ? null : f.d,
        m: f.mode === "month" ? f.m : null,
        s: f.mode === "time" ? f.s : null,
        e: f.mode === "time" && /^\d{2}:\d{2}$/.test(f.e || "") ? f.e : null,
        p: (f.p || "").trim().slice(0, 40) || null,
        n: (f.n || "").trim().slice(0, 120) || null,
        g: f.g || null,
        at: events[f.id]?.at || Date.now(),
      };
      saveEvent(f.id || newId(), ev);
      if (ev.d) calDay = ev.d;
      if (calMode === "month") calMonth = (ev.d || ev.m).slice(0, 7);
      evDraft = null;
      renderCalendar();
    };
    return el("div", { class: "ev-form" }, [
      el("div", { class: "ev-head" }, [el("b", { text: f.id ? "일정 고치기" : "일정 직접 넣기" }), el("span", { class: "ev-hint", text: "이 계정의 크롬 어디서나 보여요" })]),
      field("제목", inp("t", { class: "ev-input ev-title", maxlength: "60", placeholder: f.mode === "weekly" ? "예: 카페 알바, 영어 학원" : "예: 진로멘토링 2회차" })),
      el("div", { class: "ev-modes" }, [el("div", { class: "seg-mini-wrap" }, [modeBtn("time", "날짜·시각"), modeBtn("date", "날짜만"), modeBtn("month", "대략 (그 달 중)"), modeBtn("weekly", "매주 반복")])]),
      ...(f.mode === "weekly"
        ? [
            el("p", { class: "ev-sub", text: "알바·학원처럼 매주 같은 시간에 있는 일정. 주간 캘린더에 수업처럼 보이고, 비교과를 고를 때 겹치는지도 함께 봐요." }),
            el("div", { class: "ev-field" }, [
              el("span", { text: "요일" }),
              el(
                "div",
                { class: "wd-pick" },
                [1, 2, 3, 4, 5, 6, 0].map((d) =>
                  el("button", {
                    type: "button",
                    class: f.w.includes(d) ? "wd on" : "wd",
                    "aria-pressed": String(f.w.includes(d)),
                    text: DAY[d],
                    onclick: () => {
                      f.w = f.w.includes(d) ? f.w.filter((x) => x !== d) : [...f.w, d];
                      renderCalendar();
                    },
                  })
                )
              ),
            ]),
            el("div", { class: "ev-row" }, [field("시작", inp("s", { type: "time" })), field("끝", inp("e", { type: "time" }))]),
            el("div", { class: "ev-row" }, [field("언제부터", inp("from", { type: "date" })), field("언제까지 (선택)", inp("until", { type: "date" }))]),
          ]
        : [
            f.mode === "month" ? field("달", inp("m", { type: "month" })) : field("날짜", inp("d", { type: "date" })),
            f.mode === "time" ? el("div", { class: "ev-row" }, [field("시작", inp("s", { type: "time" })), field("끝 (선택)", inp("e", { type: "time" }))]) : null,
          ]),
      field("장소 (선택)", inp("p", { maxlength: "40", placeholder: "예: 상상관 B101, 온라인" })),
      field("메모 (선택)", inp("n", { maxlength: "120", placeholder: "예: 톡방 공지, 준비물" })),
      err,
      el("div", { class: "ev-actions" }, [
        f.id
          ? el("button", {
              type: "button",
              class: "btn ghost danger",
              text: "지우기",
              onclick: () => {
                deleteEvent(f.id);
                evDraft = null;
                renderCalendar();
              },
            })
          : null,
        el("span", { class: "grow" }),
        el("button", {
          type: "button",
          class: "btn ghost",
          text: "취소",
          onclick: () => {
            evDraft = null;
            renderCalendar();
          },
        }),
        el("button", { type: "button", class: "btn", text: "저장", onclick: save }),
      ]),
    ]);
  }

  // ---- 그날 목록 (날짜를 누르면 아래에 열림) ----
  function gcalFor(x) {
    if (!CAL) return null;
    const title = x.kind === "due" ? `[마감] ${x.title}` : x.kind === "prog" ? `${x.title}${x.session ? ` - ${x.session}` : ""}` : x.title;
    const ev = x.kind === "due" ? { title, start: new Date(new Date(x.due).getTime() - 30 * 60000), end: new Date(x.due), url: x.url } : { title, start: x.start, end: x.end, allDay: x.allDay, place: x.place, url: x.url, memo: x.ev?.n };
    if (x.kind === "fix") ev.rrule = fixedRule(x.ev);
    return el("a", { class: "gcal", href: CAL.googleLink(ev), target: "_blank", rel: "noopener", title: "구글 캘린더에 이 일정을 미리 채운 화면이 열려요 (저장은 직접)", text: "구글 캘린더에 추가" });
  }
  function dayRow(x) {
    const when = x.allDay ? (sameDay(x.start, x.end) ? "종일" : `${dayLabel(x.start)}~${dayLabel(x.end)}`) : `${hm(x.start)}–${hm(x.end)}`;
    const kindLabel = { prog: x.weekly ? "비교과 · 매주" : "비교과", ev: "내 일정", fix: "매주", due: "마감", class: "수업", acad: "학사" }[x.kind];
    const sub = x.kind === "due" ? `${x.sub} · ${dueText(x.due)}` : [x.session, x.place, x.kind === "ev" ? x.ev?.n : null].filter(Boolean).join(" · ");
    return el("div", { class: `day-row k-${x.kind}` }, [
      el("span", { class: "dr-when", text: x.kind === "due" ? endLabel(x.due).replace(/^.*\) /, "") : when }),
      el("div", { class: "info" }, [
        el("div", { class: "name" }, [el("span", { class: `dr-kind k-${x.kind}`, text: kindLabel }), x.url ? el("a", { href: x.url, target: "_blank", rel: "noopener", text: x.title }) : el("span", { text: x.title })]),
        sub ? el("div", { class: "sub", text: sub }) : null,
        el("div", { class: "dr-acts" }, [
          gcalFor(x),
          x.kind === "ev" || x.kind === "fix" ? el("button", { class: "linkish", text: "고치기", onclick: () => editEvent(x.id) }) : null,
          x.kind === "prog" ? detailLink(x.url) : null,
        ]),
      ]),
    ]);
  }
  function dayDetail(dateStr, list) {
    const d = fromYmd(dateStr);
    const items = list.sort((a, b) => (a.allDay === b.allDay ? a.start - b.start : a.allDay ? -1 : 1));
    return el("div", { class: "day-detail" }, [
      el("div", { class: "dd-head" }, [
        el("b", { text: `${dayLabel(d)}${sameDay(d, new Date()) ? " · 오늘" : ""}` }),
        el("span", { class: "grow" }),
        el("button", { class: "small", text: "+ 이날 일정", onclick: () => openEventForm({ d: dateStr, m: dateStr.slice(0, 7) }) }),
        el("button", {
          class: "small",
          text: "닫기",
          onclick: () => {
            calDay = null;
            renderCalendar();
          },
        }),
      ]),
      items.length ? el("div", { class: "dd-list" }, items.map(dayRow)) : el("p", { class: "placeholder dd-empty", text: "이날은 비교과·마감·직접 넣은 일정이 없어요." }),
    ]);
  }

  // ---- 내보내기 · 백업 ----
  function download(name, textBody, type) {
    const url = URL.createObjectURL(new Blob([textBody], { type }));
    const a = el("a", { href: url, download: name });
    root.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  function exportIcs() {
    if (!CAL) return;
    const from = addDays(dayStart(new Date()), -14);
    const to = addDays(from, 200);
    const list = [];
    for (const x of mySessions(from, to)) list.push({ uid: x.uid, title: `[비교과] ${x.title}${x.session ? ` - ${x.session}` : ""}`, start: x.start, end: x.end, allDay: x.allDay, place: x.place, url: x.url });
    for (const it of deadlines()) {
      const d = new Date(it.due);
      if (d < from) continue;
      list.push({ uid: `due-${String(it.id).replace(/[^\w-]/g, "").slice(-40)}`, title: `[마감] ${it.title}${it.course ? ` (${it.course})` : ""}`, start: new Date(d.getTime() - 30 * 60000), end: d, url: it.url });
    }
    for (const { id, ev, tm } of eventList()) if (!tm.rough) list.push({ uid: `ev-${id}`, title: ev.t, start: tm.start, end: tm.end, allDay: tm.allDay, place: ev.p, memo: ev.n });
    // 매주 반복 일정: 반복 규칙 하나로 (첫 회 = 시작일 이후 첫 해당 요일)
    for (const { id, ev } of fixedList()) {
      let d = ev.from ? fromYmd(ev.from) : dayStart(new Date());
      for (let i = 0; i < 7 && !ev.w.includes(d.getDay()); i++) d = addDays(d, 1);
      if (ev.until && ymd(d) > ev.until) continue;
      list.push({ uid: `fix-${id}`, title: ev.t, start: fromYmd(ymd(d), ev.s), end: fromYmd(ymd(d), ev.e), place: ev.p, memo: ev.n, rrule: fixedRule(ev) });
    }
    if (!list.length) {
      calNote = "내보낼 일정이 없어요.";
      return renderCalendar();
    }
    download(`hsuplus-${ymd(new Date()).replace(/-/g, "")}.ics`, CAL.buildIcs(list), "text/calendar");
    calNote = `일정 ${list.length}개를 .ics 파일로 저장했어요. 구글·삼성·아이폰 캘린더의 "가져오기"로 넣을 수 있어요. 다시 가져와도 같은 일정은 겹치지 않고 바뀌어요.`;
    renderCalendar();
  }
  async function exportBackup() {
    const [hide, color, ev] = await Promise.all([userMap("hide"), userMap("color"), userMap("ev")]);
    download(`hsuplus-backup-${ymd(new Date())}.json`, JSON.stringify({ app: "HSU PLUS", v: 1, at: new Date().toISOString(), hide, color, ev }, null, 1), "application/json");
    calNote = `백업 파일을 저장했어요 (직접 넣은 일정 ${Object.keys(ev).length}개, 숨긴 항목 ${Object.keys(hide).length}개, 과목 색). 개인 일정이 들어 있으니 다른 사람에게 보내지 마세요.`;
    settingsNote.textContent = calNote;
    renderCalendar();
  }
  function importBackup() {
    const input = el("input", { type: "file", accept: ".json,application/json" });
    input.addEventListener("change", async () => {
      try {
        const b = JSON.parse(await input.files[0].text());
        if (b?.app !== "HSU PLUS") throw new Error("HSU PLUS 백업 파일이 아니에요.");
        const obj = (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});
        let n = 0;
        for (const [id, v] of Object.entries(obj(b.ev))) if (v && typeof v.t === "string" && !events[id]) saveEvent(id, { ...v, t: v.t.slice(0, 60) }), n++;
        let h = 0;
        for (const [id, t] of Object.entries(obj(b.hide))) if (typeof t === "number" && !hidden[id]) (hidden[id] = t), userPut("hide", id, t), h++;
        for (const [k, slot] of Object.entries(obj(b.color))) if (Number.isInteger(slot) && courseColors && courseColors[k] == null) (courseColors[k] = slot), userPut("color", k, slot);
        calNote = `가져왔어요: 일정 ${n}개, 숨긴 항목 ${h}개 (이미 있는 것은 그대로 두었어요).`;
      } catch (e) {
        calNote = `가져오지 못했어요: ${e.message}`;
      }
      settingsNote.textContent = calNote;
      renderCalendar();
    });
    input.click();
  }
  function calTools() {
    return el("div", { class: "cal-tools" }, [
      el("div", { class: "ct-row" }, [
        el("button", { class: "small", text: "캘린더 파일(.ics) 내보내기", title: "내 비교과 회차·마감·직접 넣은 일정 (수업 시간표는 빼요)", onclick: exportIcs }),
        el("button", { class: "small", text: "백업 저장", onclick: exportBackup }),
        el("button", { class: "small", text: "백업 불러오기", onclick: importBackup }),
        el("span", { class: "grow" }),
        acadSwitch(),
      ]),
      calNote ? el("p", { class: "ct-note", text: calNote }) : null,
    ]);
  }

  // ---- 머리줄 ----
  // 머리줄: 이번 주·비교과 탭과 같은 모양 (위 "n분 전 기준 · + 일정 · 새로고침", 아래 액자의 넓은 주간 | 월간 선택) (10/19 사용자)
  function calHead() {
    return el("div", { class: "section-head" }, [
      el("span", { class: "meta", text: loading ? "불러오는 중…" : week?.fetchedAt ? `시간표 ${ago(week.fetchedAt)}` : "" }),
      infoTip("비교과 일정(매주 회차·기간 등)은 학교 안내문을 자동으로 정리한 것이라 틀릴 수 있어요. 날짜를 누르면 나오는 목록의 '상세 일정 확인 ↗'에서 학교 화면을 확인하세요.", "캘린더 안내"),
      el("button", { class: "small", text: "+ 일정", onclick: () => openEventForm() }),
      el("button", {
        class: "small refresh",
        text: "새로고침",
        disabled: loading ? "" : null,
        onclick: () => {
          loadWeek({ force: true });
          loadEclass({ force: true });
          loadMine({ force: true });
        },
      }),
    ]);
  }
  const CAL_MODES = [
    { id: "week", label: "주간" },
    { id: "month", label: "월간" },
  ];

  function renderCalendar() {
    if (current !== "calendar") return;
    const seg = el(
      "div",
      { class: "seg", role: "tablist" },
      CAL_MODES.map((m) =>
        el("button", {
          class: m.id === calMode ? "seg-btn active" : "seg-btn",
          role: "tab",
          "aria-selected": String(m.id === calMode),
          text: m.label,
          onclick: () => {
            calMode = m.id;
            calDay = null;
            renderCalendar();
          },
        })
      )
    );
    const inner = [];
    if (evDraft) inner.push(eventForm());
    inner.push(...(calMode === "month" ? monthView() : weekView()));
    inner.push(calTools());
    content.replaceChildren(calHead(), el("div", { class: "frame cal" }, [seg, el("div", { class: "frame-body" }, inner)]));
  }

  // ---- 주간 ----
  function weekView() {
    const today = new Date();
    const offset = calWeek ?? (today.getDay() === 0 || today.getDay() === 6 ? 1 : 0);
    const weekBtn = (n, label) =>
      el("button", {
        class: offset === n ? "seg-mini active" : "seg-mini",
        text: label,
        onclick: () => {
          calWeek = n;
          calWeekendOpen = null;
          calDay = null;
          renderCalendar();
        },
      });
    const monday = weekRange().start;
    monday.setDate(monday.getDate() + 7 * offset);
    const sunday = addDays(monday, 7);
    const sub = el("div", { class: "cal-sub" }, [el("span", { class: "title", text: `${offset ? "다음 주" : "이번 주"} · ${md(monday)}–${md(addDays(monday, 6))}` }), el("div", { class: "seg-mini-wrap" }, [weekBtn(0, "이번 주"), weekBtn(1, "다음 주")])]);

    if (!week) return [sub, el("p", { class: "placeholder", text: "불러오는 중…" })];
    const parts = [sub];
    if (!week.ok) {
      const e = week.error || {};
      parts.push(e.kind === "login" ? loginCard(e.site) : failCard(e.message));
    } else if (week.error) parts.push(el("p", { class: "stale", text: "새로 불러오지 못해 예전 데이터를 보여주고 있어요." }));

    const classes = week.ok ? weekItems(monday).map((it) => ({ kind: "class", title: it.course || it.title, place: it.place, professor: it.professor, start: new Date(it.start), end: new Date(it.end || it.start) })) : [];
    const extra = calItems(monday, sunday);
    const timed = [...classes, ...extra.filter((x) => !x.allDay)];
    const allDay = extra.filter((x) => x.allDay);
    const now = new Date();

    const dayIdx = (d) => (d.getDay() + 6) % 7; // 월=0 … 일=6
    // 주말 자동 펼침은 비교과·직접 넣은 일정만 센다 (일요일 23:59 강의 마감이 흔해서 마감까지 세면 늘 펼쳐짐)
    const weekendAllDay = [5, 6].flatMap((c) => allDayOf(addDays(monday, c), allDay));
    // 학사일정(신청 기간)도 주말에 걸치기만 하는 경우가 많아 세지 않음. 매주 반복 일정(알바·학원)이 주말에 있으면 펼침 (10/20)
    const weekendCount = timed.filter((x) => x.kind !== "class" && dayIdx(x.start) >= 5).length + weekendAllDay.filter((x) => x.kind !== "due" && x.kind !== "acad").length;
    const weekendDues = weekendAllDay.filter((x) => x.kind === "due").length;
    const weekendOpen = calWeekendOpen ?? weekendCount > 0;
    const cols = [0, 1, 2, 3, 4].concat(weekendOpen ? [5, 6] : []);

    // 시간 범위: 기본 9~18시, 일정이 더 이르거나 늦으면 넓힌다
    let minH = 9;
    let maxH = 18;
    for (const x of timed) {
      if (!cols.includes(dayIdx(x.start))) continue;
      minH = Math.min(minH, x.start.getHours());
      maxH = Math.max(maxH, x.end.getMinutes() ? x.end.getHours() + 1 : x.end.getHours());
    }
    maxH = Math.min(24, Math.max(maxH, minH + 1));
    const totalPx = (maxH - minH) * HOUR_PX;

    const grid = el("div", { class: "tt" });
    grid.style.setProperty("--tt-cols", cols.length);
    // 머리줄: 요일 (누르면 그날 목록)
    grid.appendChild(el("div", { class: "tt-corner" }));
    for (const c of cols) {
      const d = addDays(monday, c);
      grid.appendChild(
        el("button", {
          class: ["tt-day", sameDay(d, now) ? "today" : "", calDay === ymd(d) ? "picked" : ""].filter(Boolean).join(" "),
          text: `${DAY[d.getDay()]} ${d.getDate()}`,
          onclick: () => {
            calDay = calDay === ymd(d) ? null : ymd(d);
            renderCalendar();
          },
        })
      );
    }
    // 종일 줄: 마감 개수 + 며칠짜리·날짜만 일정
    grid.appendChild(el("div", { class: "tt-adlabel", text: "종일" }));
    for (const c of cols) {
      const d = addDays(monday, c);
      const list = allDayOf(d, allDay);
      const dues = list.filter((x) => x.kind === "due");
      const others = list.filter((x) => x.kind !== "due" && pillOn(x, d));
      const pills = [];
      if (dues.length) {
        const first = dues.map((x) => x.due).sort()[0];
        pills.push(el("span", { class: `ad-pill due r${riskTier(first)}${dayStart(d) < dayStart(now) ? " past" : ""}`, title: dues.map((x) => `${x.title} (${x.sub})`).join("\n"), text: `마감 ${dues.length}` }));
      }
      for (const x of others.slice(0, dues.length ? 1 : 2)) pills.push(el("span", { class: `ad-pill k-${x.kind}`, title: x.title, text: pillName(x, d) }));
      const more = others.length - (dues.length ? 1 : 2);
      if (more > 0) pills.push(el("span", { class: "ad-more", text: `+${more}` }));
      grid.appendChild(
        el(
          "button",
          {
            class: calDay === ymd(d) ? "tt-ad picked" : "tt-ad",
            title: list.length ? "눌러서 그날 목록 보기" : null,
            onclick: () => {
              calDay = calDay === ymd(d) ? null : ymd(d);
              renderCalendar();
            },
          },
          pills
        )
      );
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
      const d = addDays(monday, c);
      const col = el("div", { class: sameDay(d, now) ? "tt-col today" : "tt-col" });
      col.style.height = totalPx + "px";
      col.style.backgroundSize = `100% ${HOUR_PX}px`;
      for (const x of timed.filter((t) => sameDay(t.start, d))) {
        const s = x.start;
        const e = x.end > s ? x.end : new Date(s.getTime() + 3600000);
        const endMin = sameDay(s, e) ? minutesOf(e) : maxH * 60;
        const top = ((minutesOf(s) - minH * 60) / 60) * HOUR_PX;
        const height = Math.max(((endMin - minutesOf(s)) / 60) * HOUR_PX, 18);
        const tag = x.kind === "prog" ? (x.weekly ? "비교과 · 매주" : "비교과") : x.kind === "ev" ? "내 일정" : x.kind === "fix" ? "매주" : null;
        const tip = `${tag ? `[${tag}] ` : ""}${x.title}${x.session ? `\n${x.session}` : ""}\n${hm(s)}–${hm(e)}\n${[x.place, x.professor].filter(Boolean).join(" · ")}`;
        const isLink = x.kind === "prog" && x.url;
        const block = el(
          isLink ? "a" : x.kind === "ev" || x.kind === "fix" ? "button" : "div",
          {
            class: ["tt-block", x.kind === "class" ? "" : x.kind, e < now ? "past" : ""].filter(Boolean).join(" "),
            title: tip,
            href: isLink ? x.url : null,
            target: isLink ? "_blank" : null,
            rel: isLink ? "noopener" : null,
            onclick: x.kind === "ev" || x.kind === "fix" ? () => editEvent(x.id) : null,
          },
          [tag ? el("div", { class: "tt-tag", text: tag }) : null, el("div", { class: "tt-name", text: x.kind === "class" ? x.title : shortTitle(x.title) }), x.place ? el("div", { class: "tt-place", text: x.place }) : null]
        );
        block.style.top = top + "px";
        block.style.height = height - 2 + "px";
        if (x.kind === "class") block.style.background = courseColor(x.title)?.c || "var(--ot-muted)";
        col.appendChild(block);
      }
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

    if (week.ok && !classes.length && !extra.length) parts.push(el("p", { class: "placeholder", text: offset ? "다음 주 수업·일정이 없어요." : "이번 주 수업·일정이 없어요." }));
    parts.push(grid);
    parts.push(
      el("div", { class: "cal-foot" }, [
        el("span", { class: "tt-legend", text: "흰 칸 내 비교과 · 보라 직접 넣은 일정·매주 반복(알바 등) · 요일을 누르면 그날 목록" }),
        el("button", {
        class: "weekend-toggle",
        text: weekendOpen ? "토·일 접기" : `토·일 펼치기${weekendCount || weekendDues ? ` (${[weekendCount ? `일정 ${weekendCount}` : "", weekendDues ? `마감 ${weekendDues}` : ""].filter(Boolean).join(" · ")})` : ""}`,
        onclick: () => {
          calWeekendOpen = !weekendOpen;
          renderCalendar();
        },
        }),
      ])
    );
    if (calDay) {
      const d = fromYmd(calDay);
      if (d >= monday && d < sunday) parts.push(dayDetail(calDay, [...allDayOf(d, allDay), ...timed.filter((x) => x.kind !== "class" && sameDay(x.start, d))]));
    }
    return parts;
  }

  // ---- 월간 (수업 제외) ----
  function monthView() {
    const now = new Date();
    const key = calMonth || ymd(now).slice(0, 7);
    const [y, m] = key.split("-").map(Number);
    const first = new Date(y, m - 1, 1);
    const last = new Date(y, m, 0);
    const gridStart = addDays(first, -((first.getDay() + 6) % 7)); // 그 주 월요일
    const gridEnd = addDays(last, 7 - ((last.getDay() + 6) % 7)); // 마지막 주 다음 월요일
    const go = (n) => {
      const d = new Date(y, m - 1 + n, 1);
      calMonth = ymd(d).slice(0, 7);
      calDay = null;
      renderCalendar();
    };
    const sub = el("div", { class: "cal-sub" }, [
      el("button", { class: "small nav", text: "‹", title: "지난달", onclick: () => go(-1) }),
      el("span", { class: "title", text: `${y}년 ${m}월` }),
      el("button", { class: "small nav", text: "›", title: "다음 달", onclick: () => go(1) }),
      el("span", { class: "grow" }),
      key !== ymd(now).slice(0, 7)
        ? el("button", {
            class: "small",
            text: "이번 달",
            onclick: () => {
              calMonth = null;
              calDay = null;
              renderCalendar();
            },
          })
        : null,
    ]);
    const items = calItems(gridStart, gridEnd).filter((x) => x.kind !== "fix"); // 매주 반복 일정은 수업처럼 주간에서만
    const parts = [sub];
    // 대략 일정 ("11월 중")
    const rough = eventList().filter((x) => x.tm.rough && x.ev.m === key);
    if (rough.length)
      parts.push(
        el(
          "div",
          { class: "rough" },
          [el("span", { class: "rough-label", text: `${m}월 중` })].concat(rough.map((x) => el("button", { class: "ad-pill k-ev", title: "눌러서 고치기", text: x.ev.t, onclick: () => editEvent(x.id) })))
        )
      );
    if (!mine?.ok && !eclass?.ok) parts.push(el("p", { class: "placeholder", text: "비교과·e클래스를 불러오는 중이거나 로그인이 필요해요." }));

    const grid = el("div", { class: "mon" });
    for (const w of ["월", "화", "수", "목", "금", "토", "일"]) grid.appendChild(el("div", { class: "mon-wd", text: w }));
    // 며칠 이어지는 일정(3주 이하)은 칸을 가로지르는 막대 하나로 (10/20 사용자). 주가 바뀌면 다음 줄에서 이어짐.
    //  3주 넘는 긴 일정(방학 등)은 막대 대신 시작·끝 날에만 "이름" / "이름 끝" (pillOn)
    const barItems = items.filter((x) => isBar(x)).sort((a, b) => a.start - b.start || b.end - a.end);
    for (let ws = new Date(gridStart); ws < gridEnd; ws = addDays(ws, 7)) {
      const we = addDays(ws, 6);
      // 이 주에 걸친 막대 → 줄(lane) 나누기: 겹치지 않으면 같은 줄
      const lanes = [];
      const hidden = []; // 줄이 모자라 못 그린 막대 (그 날짜 칸의 +N에 셈)
      for (const x of barItems) {
        if (!(x.start <= we && dayStart(x.end) >= ws)) continue;
        const a = Math.max(0, Math.round((dayStart(x.start) - ws) / 864e5));
        const b = Math.min(6, Math.round((dayStart(x.end) - ws) / 864e5));
        const seg = { x, a, b, contL: dayStart(x.start) < ws, contR: dayStart(x.end) > we };
        const lane = lanes.findIndex((L) => L.every((o) => o.b < a || o.a > b));
        if (lane >= 0) lanes[lane].push(seg);
        else if (lanes.length < BAR_LANES) lanes.push([seg]);
        else hidden.push(seg);
      }
      const nL = lanes.length;
      const week = el("div", { class: "mon-week", style: `grid-template-rows: 20px${nL ? ` repeat(${nL}, 17px)` : ""} minmax(0, 1fr)` });
      for (let i = 0; i < 7; i++) {
        const dd = addDays(ws, i);
        const list = [...allDayOf(dd, items.filter((x) => x.allDay)), ...items.filter((x) => !x.allDay && sameDay(x.start, dd))];
        const dues = list.filter((x) => x.kind === "due");
        const others = list.filter((x) => x.kind !== "due" && !isBar(x) && pillOn(x, dd)).sort((a, b) => a.start - b.start);
        const cap = Math.max(1, (dues.length ? 2 : 3) - nL);
        const out = dd.getMonth() !== m - 1;
        const past = dayStart(dd) < dayStart(now);
        // 칸이 좁아서 이름은 짧게(학기·연도 머리말 뗌), 시각은 넓게 보기에서만. 원래 이름·시각은 마우스 올리기와 그날 목록에서
        const pills = others.slice(0, cap).map((x) =>
          el("span", { class: `mon-pill k-${x.kind}` }, [x.allDay ? null : el("span", { class: "tm", text: hm(x.start) }), el("span", { class: "nm", text: pillName(x, dd) })])
        );
        if (dues.length) pills.push(el("span", { class: `mon-pill due r${riskTier(dues.map((x) => x.due).sort()[0])}` }, [el("span", { class: "nm", text: `마감 ${dues.length}` })]));
        const more = others.length - cap + hidden.filter((g) => g.a <= i && i <= g.b).length;
        if (more > 0) pills.push(el("span", { class: "ad-more", text: `+${more}` }));
        week.appendChild(
          el("button", {
            class: ["mon-cell", out ? "out" : "", sameDay(dd, now) ? "today" : "", past ? "past" : "", calDay === ymd(dd) ? "picked" : "", dd.getDay() === 0 || dd.getDay() === 6 ? "wkend" : ""].filter(Boolean).join(" "),
            style: `grid-column: ${i + 1}`,
            title: list.length ? list.map((x) => `${x.kind === "due" ? "[마감] " : x.allDay ? "" : hm(x.start) + " "}${x.title}`).join("\n") : null,
            onclick: () => {
              calDay = calDay === ymd(dd) ? null : ymd(dd);
              renderCalendar();
            },
          }, [el("span", { class: "mon-num", text: String(dd.getDate()) })])
        );
        if (pills.length) week.appendChild(el("div", { class: ["mon-items", out ? "out" : "", past ? "past" : ""].filter(Boolean).join(" "), style: `grid-column: ${i + 1}; grid-row: ${nL + 2}` }, pills));
      }
      lanes.forEach((L, li) => {
        for (const g of L) {
          const ended = dayStart(g.x.end) < dayStart(now);
          week.appendChild(
            el("span", {
              class: ["mon-bar", `k-${g.x.kind}`, g.contL ? "cont-l" : "", g.contR ? "cont-r" : "", ended ? "past" : ""].filter(Boolean).join(" "),
              style: `grid-column: ${g.a + 1} / ${g.b + 2}; grid-row: ${li + 2}`,
              title: `${g.x.title}\n${dayLabel(g.x.start)} ~ ${dayLabel(g.x.end)}`,
              text: shortTitle(g.x.title),
            })
          );
        }
      });
      grid.appendChild(week);
    }
    parts.push(grid);
    parts.push(
      el("div", { class: "cal-foot" }, [
        el("span", { class: "tt-legend", text: `수업은 주간에서 · 파랑 내 비교과 · 보라 직접 넣은 일정 · 마감 = 과제·퀴즈·강의${panel.classList.contains("wide") ? "" : " · 이름이 잘리면 날짜를 누르거나 '넓게 보기'"}` }),
      ])
    );
    if (calDay) {
      const d = fromYmd(calDay);
      parts.push(dayDetail(calDay, [...allDayOf(d, items.filter((x) => x.allDay)), ...items.filter((x) => !x.allDay && sameDay(x.start, d))]));
    }
    return parts;
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
  // 선택 과제·오프라인으로 낸 과제처럼 계속 남아 거슬리는 항목을 숨긴다. 내 설정(sync)에 저장 { 항목 id: 숨긴 시각 }
  // 숨긴 항목은 개수·빨간 점·AI 답에서도 빠진다. 칸 맨 아래 "숨긴 항목 N개"에서 되돌릴 수 있다.
  const HIDE_KEY = "ui:hidden";
  let hidden = {};
  userMap("hide", HIDE_KEY).then((v) => {
    // 오래된 기록 정리 (120일). 키 수 한도(512)를 생각해 많아도 최근 300개만 남긴다
    const old = Date.now() - 120 * 86400000;
    const keep = Object.entries(v).filter(([, t]) => t >= old).sort((a, b) => b[1] - a[1]).slice(0, 300);
    for (const id of Object.keys(v)) if (!keep.some(([k]) => k === id)) userPut("hide", id, null);
    hidden = Object.fromEntries(keep);
    rerender();
  });
  onUserChange("hide", (id, v) => {
    if (v == null) delete hidden[id];
    else hidden[id] = v;
  });
  const isHidden = (id) => !!hidden[id];
  function setHidden(id, on) {
    if (on) hidden[id] = Date.now();
    else delete hidden[id];
    userPut("hide", id, on ? hidden[id] : null);
    renderWeek();
  }
  const hideBtn = (id) =>
    el("button", {
      class: "hide-btn",
      title: "숨기기 (내 크롬 계정에서 모두 적용)",
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
    // 날짜·시각이 정해진 회차 + 매주 회차(이번 주 것) (10/19: 캘린더와 같은 계산을 씀)
    for (const x of mySessions(dayStart(now), new Date(until))) {
      if (x.allDay || x.end < now) continue;
      out.push({ id: `mine:${x.p.id}:${x.start.toISOString()}`, kind: "session", p: x.p, s: { name: x.session ? x.s.name : null, start: x.start.toISOString(), end: x.end.toISOString() }, weekly: x.weekly, at: x.start.toISOString() });
    }
    // 기간형 내 비교과가 7일 안에 끝나면 (온라인 수강·제출 마감 등)
    for (const x of programEnds()) {
      const t = new Date(x.due).getTime();
      if (t < now.getTime() || t > until) continue;
      out.push({ id: `pend:${x.p.id}:${x.due}`, kind: "pend", p: x.p, due: x.due, at: x.due });
    }
    // 비교과 카드에서 "일정 직접 넣기"로 넣은 일정도 여기 보여준다
    for (const { id, ev, tm } of eventList()) {
      if (!ev.g || tm.rough || tm.end < dayStart(now) || tm.start.getTime() > until) continue;
      out.push({ id: `ev:${id}`, kind: "event", ev, evId: id, tm, at: tm.start.toISOString() });
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
        el("span", { class: "tc-status plain", text: x.weekly ? "매주 · 참여 예정" : "참여 예정" }),
      ]),
    ]);
  }
  // 직접 넣은 일정 카드 (누르면 고치기)
  function eventCard(x) {
    const { ev, tm } = x;
    const days = daysLeft(tm.start.toISOString());
    return el("div", { class: `tcard r${riskTier(tm.start.toISOString())}` }, [
      el("button", { class: "tc-main tc-toggle", onclick: () => editEvent(x.evId) }, [
        el("div", { class: "info" }, [el("div", { class: "tc-title", text: ev.t }), el("div", { class: "tc-sub", text: [ev.p, ev.n].filter(Boolean).join(" · ") || "직접 넣은 일정" })]),
        hideBtn(x.id),
      ]),
      el("div", { class: "tc-foot" }, [
        el("span", { class: "dline" }, [
          icon("clock"),
          el("span", { class: days <= 0 ? "dchip today" : `dchip r${riskTier(tm.start.toISOString())}`, text: days <= 0 ? "오늘" : `D-${days}` }),
          el("span", { class: "when", text: tm.allDay ? dayLabel(tm.start) : `${dayLabel(tm.start)} ${hm(tm.start)}–${hm(tm.end)}` }),
        ]),
        el("span", { class: "tc-status plain", text: "내 일정" }),
      ]),
    ]);
  }
  // 기간형 내 비교과의 끝 (온라인 수강·제출 등)
  function programEndCard(x) {
    const days = daysLeft(x.due);
    return el("a", { class: `tcard r${riskTier(x.due)}`, href: x.p.url, target: "_blank", rel: "noopener" }, [
      el("div", { class: "tc-main" }, [
        el("div", { class: "info" }, [el("div", { class: "tc-title", text: x.p.title }), el("div", { class: "tc-sub", text: [x.p.category, x.p.place].filter(Boolean).join(" · ") })]),
        hideBtn(x.id),
      ]),
      el("div", { class: "tc-foot" }, [
        el("span", { class: "dline" }, [icon("clock"), el("span", { class: days <= 0 ? "dchip today" : `dchip r${riskTier(x.due)}`, text: days <= 0 ? "오늘" : `D-${days}` }), el("span", { class: "when", text: `${endLabel(x.due)}까지` })]),
        el("span", { class: "tc-status" }, [icon("warn"), el("span", { text: "기간 안에 참여·제출" })]),
      ]),
    ]);
  }
  const programTodoCard = (x) => (x.kind === "survey" ? surveyCard(x.p, x.id) : x.kind === "event" ? eventCard(x) : x.kind === "pend" ? programEndCard(x) : sessionCard(x));

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
        class: "small refresh",
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
        bodyParts.push(lists.program.length ? rows(lists.program.map(programTodoCard)) : donePlaceholder(kind.empty));
        bodyParts.push(hiddenSection(progAll.filter((x) => isHidden(x.id)), (x) => (x.kind === "event" ? x.ev.t : x.p.title)));
      }
    } else if (!eclass) bodyParts = [placeholder("과목별 과제와 강의를 확인하고 있어요…")];
    else if (!eclass.ok) bodyParts = [failCard(eclass.error?.message, () => loadEclass({ force: true }))];
    else {
      const items = lists[weekKind];
      bodyParts = [];
      if (eclass.error) bodyParts.push(el("p", { class: "stale", text: "e클래스를 새로 불러오지 못해 예전 데이터를 보여주고 있어요." }));
      if (eclass.data.noCourses) bodyParts.push(el("p", { class: "stale info", text: "e클래스에 이번 학기 교과 과목이 아직 없어요 (방학·학기 초). 비교과·학사일정·캘린더는 그대로 볼 수 있어요." }));
      if (weekKind === "video" && items.length) bodyParts.push(watchSummary(items));
      bodyParts.push(items.length ? rows(grouped(weekKind, items, kind.label)) : donePlaceholder(kind.empty));
      bodyParts.push(hiddenSection(all[weekKind].filter((it) => isHidden(it.id)), (it) => `${it.title} · ${it.course || ""}`));
    }

    const frame = el("div", { class: "frame" }, [seg, el("div", { class: "frame-body" }, bodyParts)]);
    content.replaceChildren(...[head, welcomeOpen ? welcomeCard() : null, academicStrip(now), frame].filter(Boolean));
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
    refresh: ["M20 11a8 8 0 1 0-2.3 5.7", "M20 4v7h-7"],
    check: ["M5 12.5l4.5 4.5L19 7.5"],
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
  // "남은 게 없어요" = 다 끝냄 → 초록 체크 (초록은 완료에만)
  const donePlaceholder = (text) => el("div", { class: "empty-done" }, [el("span", { class: "ok" }, [icon("check")]), el("p", { text })]);
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
    import(chrome.runtime.getURL("core/classify.js")),
    import(chrome.runtime.getURL("core/calendar.js")),
    import(chrome.runtime.getURL("core/points.js")),
    import(chrome.runtime.getURL("adapters/hansung.js")),
  ]).then(([cache, eclass, hsportal, ai, classify, calendar, points, hansung]) => ({ cache, eclass, hsportal, ai, classify, calendar, points, hansung }));

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
      ensureDetails(r.data.map((it) => it.meta?.programId), { force });
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
      let r = await cache.getOrFetch("programs-mine", cache.TTL.MYPROGRAMS, () => hsportal.fetchMyPrograms(getText), { force });
      // 10/20: 포인트 내역(history)이 없는 예전 캐시면 바로 새로 받는다 (안 그러면 1시간 동안 "지난 학기 모은 점수 -")
      if (r.fromCache && !Array.isArray(r.data?.points?.history)) r = await cache.getOrFetch("programs-mine", cache.TTL.MYPROGRAMS, () => hsportal.fetchMyPrograms(getText), { force: true });
      mine = { ok: true, data: r.data, fetchedAt: r.fetchedAt, error: r.error ? plainErr(r.error) : null };
      classified.clear();
      ensureDetails(r.data.programs.map((p) => p.id)); // 매주 회차 판단용 안내문
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
    renderSetOpts();
    if (current === "week") renderWeek();
    else if (current === "calendar" && !evDraft) renderCalendar(); // 일정 입력 중이면 다시 그리지 않음
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
  const PKINDS = [
    { id: "apply", label: "신청" },
    { id: "mine", label: "내 비교과" },
  ];
  let progKind = "apply";

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

  // 내 비교과 포인트: 마이페이지 목록의 포인트 칸은 시작 대기·진행 중일 때 0으로 나옴(이수 뒤에 들어가는 듯, 10/20 확인)
  //  → 공개 상세 화면의 회차 마일리지를 쓴다(내가 신청한 회차가 표시되면 그 회차만). 실제 확인한 9건은 회차끼리 점수가 모두 같았음
  function minePoint(p) {
    const ss = details[p.id]?.d?.sessions || [];
    const pick = ss.some((s) => s.mine) ? ss.filter((s) => s.mine) : ss;
    const pts = [...new Set(pick.map((s) => s.point).filter((n) => n > 0))].sort((a, b) => a - b);
    if (pts.length === 1) return `${pts[0]}p`;
    if (pts.length > 1) return `${pts[0]}~${pts[pts.length - 1]}p`;
    return p.mileage > 0 ? `${p.mileage}p` : null;
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
        minePoint(p) ? el("span", { class: "badge program", title: "이수하면 받는 포인트 (학교 상세 화면 기준)", text: minePoint(p) }) : null,
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
      el("div", { class: "info" }, [el("div", { class: "name", text: p.title }), el("div", { class: "sub", text: [periodText(s), p.phase === "wait" ? "시작 대기" : "", minePoint(p) || ""].filter(Boolean).join(" · ") })]),
    ]);
  }

  // ---------- 비교과 포인트 (10/19 사용자: 학기 200점 한도, 이월 200점, 800점 넘으면 따로) ----------
  // 계산은 core/points.js. 학교 화면 6칸 + 포인트 내역(학기별로 실제 모은 점수)
  const fmt = (n) => Number(n || 0).toLocaleString("ko-KR");
  function pointHistory(rows, title) {
    if (!rows.length) return null;
    return el("details", { class: "pt-hist" }, [
      el("summary", { text: title }),
      el(
        "div",
        { class: "pt-hist-list" },
        rows.map((r) => el("div", { class: "pt-hrow" }, [el("span", { class: "d", text: r.date.slice(5).replace("-", "/") }), el("span", { class: "t", text: r.title }), el("b", { text: `+${r.change}` })]))
      ),
    ]);
  }
  function pointCard(pt) {
    if (!PT) return el("div", { class: "pt-card" }, [el("p", { class: "placeholder", text: "포인트를 계산하는 중…" })]);
    const S = PT.pointSummary(pt);
    if (S.done) return eliteCard(S, pt);
    const have = S.graduation;
    const bar = el("div", { class: "pt-bar" }, [el("div", { class: "pt-fill" })]);
    bar.firstChild.style.width = `${Math.min(100, (have / PT.GRAD_POINTS) * 100)}%`;

    // 이번 학기 200점 칸: 이월(연한 남색) + 이번 학기 모은 점수(남색)
    const semBar = el("div", { class: "pt-sembar", title: `한 학기 인정 한도 ${PT.SEM_CAP}점` }, [el("div", { class: "seg carry" }), el("div", { class: "seg earned" })]);
    semBar.children[0].style.width = `${(S.fromCarry / PT.SEM_CAP) * 100}%`;
    semBar.children[1].style.width = `${(S.fromEarned / PT.SEM_CAP) * 100}%`;
    const note =
      S.room > 0
        ? `${S.room}점 더 모으면 이번 학기에 바로 인정돼요. 그 뒤로 모은 점수는 다음 학기로 넘어가요(최대 ${PT.CARRY_CAP}점).`
        : S.lost > 0
          ? `이번 학기 칸이 다 찼고, 다음 학기 이월도 ${PT.CARRY_CAP}점이 다 찼어요. 넘친 ${S.lost}점은 사라져요.`
          : `이번 학기 칸은 다 찼어요. 지금부터 모으는 점수는 다음 학기로 넘어가요 (${S.carryRoom}점까지).`;
    const stat = (label, value, sub, cls = "") => el("div", { class: `pt-stat ${cls}` }, [el("span", { class: "l", text: label }), el("b", { text: value }), sub ? el("span", { class: "s", text: sub }) : null]);
    const stats = [
      stat("지난 학기 모은 점수", S.prevEarned == null ? "-" : `${fmt(S.prevEarned)}점`, S.prev.label),
      stat("지난 학기에서 이월", `${fmt(S.carryIn)}점`, "이번 학기 칸에 먼저 들어감"),
      stat("이번 학기 모은 점수", `${fmt(S.earned)}점`, S.sem.label),
      stat("다음 학기로 이월", `${fmt(S.carryOut)}점`, S.carryOut ? "학기가 끝나면 넘어가요 (예상)" : `최대 ${PT.CARRY_CAP}점`),
    ];
    if (S.lost || S.schoolExpired) stats.push(stat("소멸", `${fmt(Math.max(S.lost, S.schoolExpired || 0))}점`, "이월 한도를 넘은 점수", "warn"));
    if (S.total != null) stats.push(stat("전체 누적", `${fmt(S.total)}점`, "지금까지 모은 점수 전부"));
    return el("div", { class: "pt-card" }, [
      el("div", { class: "pt-top" }, [
        el("div", {}, [
          el("div", { class: "pt-label", text: "졸업 인정 비교과 포인트" }),
          el("div", { class: "pt-num" }, [el("b", { text: fmt(have) }), el("span", { text: ` / ${PT.GRAD_POINTS}점` })]),
        ]),
        el("div", { class: "pt-left" }, [el("span", { text: "졸업까지" }), el("b", { text: `${fmt(S.toGraduate)}점` })]),
      ]),
      bar,
      el("div", { class: "pt-sem" }, [
        el("div", { class: "pt-sem-head" }, [el("span", { text: `이번 학기 인정 · ${S.sem.label}` }), el("b", { text: `${S.recognized} / ${PT.SEM_CAP}` })]),
        semBar,
        el("div", { class: "pt-legend" }, [
          el("span", { class: "k carry" }), el("span", { text: `이월 ${S.fromCarry}` }),
          el("span", { class: "k earned" }), el("span", { text: `이번 학기 ${S.fromEarned}` }),
          S.overflow ? el("span", { class: "over", text: `+ 넘친 ${S.overflow}` }) : null,
        ]),
        el("p", { class: "pt-note", text: note }),
      ]),
      el("div", { class: "pt-stats" }, stats),
      pointHistory(S.recent, "최근 포인트 내역"),
    ]);
  }
  // 졸업 요건(800점)을 이미 채운 사람: 게이지 없이 점수와 이번 학기 모은 점수만 (장학금 경쟁 등)
  function eliteCard(S, pt) {
    const thisSem = (pt.history || []).filter((r) => r.date >= S.sem.from && r.date < S.sem.to).sort((a, b) => b.date.localeCompare(a.date));
    return el("div", { class: "pt-elite" }, [
      el("div", { class: "pe-top" }, [el("span", { class: "pe-label", text: "내 비교과 점수" }), el("span", { class: "pe-badge", text: "✓ 졸업 요건 달성" })]),
      el("div", { class: "pe-num" }, [el("b", { text: fmt(S.total ?? S.graduation) }), el("span", { text: "점" })]),
      el("div", { class: "pe-sem" }, [
        el("span", { class: "l", text: `${S.sem.label}에 모은 점수` }),
        el("b", { text: `+${fmt(S.earned)}점` }),
      ]),
      el("p", { class: "pe-note", text: `학기 인정 한도(${PT.SEM_CAP}점)와 상관없이 이번 학기에 실제로 모은 점수예요.` }),
      pointHistory(thisSem.slice(0, 20), `이번 학기 내역 ${thisSem.length}건${thisSem.length > 20 ? " (최근 20건)" : ""}`),
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
      infoTip(progKind === "mine" ? SCHEDULE_NOTE_MINE : SCHEDULE_NOTE_APPLY, "일정 분류 안내"),
      el("button", {
        class: "small refresh",
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

    const bodyParts = progKind === "mine" ? renderMine() : renderApply();
    content.replaceChildren(head, el("div", { class: "frame prog" }, [seg, el("div", { class: "frame-body" }, bodyParts)]));
  }

  // ---------- 비교과 상세(공개 화면) + 규칙 분류 (10/19) ----------
  // 신청 탭의 분류·회차·시간표 겹침, 캘린더의 "매주" 회차에 쓴다. 상세는 프로그램마다 12시간 보관(학교 서버 부담).
  const DETAIL_TTL = 12 * 3600000;
  let details = {}; // 비교과 번호 → { d: {typeLabel, pick, sessions, text}, at }
  let detailProgress = null; // { done, total } 받는 중이면
  const classified = new Map(); // 분류 결과 (상세가 바뀌면 비움)
  let C = null; // core/classify.js
  let CAL = null; // core/calendar.js
  let PT = null; // core/points.js
  mods.then((m) => {
    C = m.classify;
    CAL = m.calendar;
    PT = m.points;
    rerender();
  });
  const detailsReady = mods
    .then(({ cache }) => cache.read("program-details"))
    .then((r) => (details = r?.data || {}))
    .catch(() => {});
  let detailQueue = Promise.resolve();
  function ensureDetails(ids, { force = false } = {}) {
    detailQueue = detailQueue
      .then(async () => {
        await detailsReady;
        const { cache, hsportal } = await mods;
        const now = Date.now();
        const need = [...new Set(ids)].filter((id) => /^\d+$/.test(String(id || "")) && (force || !details[id] || now - details[id].at > DETAIL_TTL));
        if (!need.length) return;
        detailProgress = { done: 0, total: need.length };
        if (current === "programs") renderPrograms();
        const got = await hsportal.fetchProgramDetails(getText, need, (done, total) => {
          detailProgress = { done, total };
          if (current === "programs" && (done % 6 === 0 || done === total)) renderPrograms();
        });
        // 못 받은 것(d: null)도 적어 둔다 → 12시간 안에는 다시 요청하지 않음 (지난 프로그램은 상세가 없을 수 있음)
        for (const [id, d] of Object.entries(got)) details[id] = { d, at: Date.now() };
        for (const [id, v] of Object.entries(details)) if (now - v.at > 30 * 86400000) delete details[id]; // 30일 지난 것 정리
        classified.clear();
        detailProgress = null;
        try {
          await cache.write("program-details", details);
        } catch {}
        rerender();
      })
      .catch((err) => {
        if (isDeadContext(err)) return onDeadContext();
        console.warn("[HSU PLUS] 비교과 상세 불러오기 실패:", err);
        detailProgress = null;
        rerender();
      });
    return detailQueue;
  }
  /** 접수 중 비교과 하나의 분류 (상세를 아직 못 받았으면 null) */
  function classOf(it) {
    const id = it.meta?.programId;
    const det = details[id]?.d;
    if (!det || !C) return null;
    if (!classified.has(id)) classified.set(id, C.classifyProgram({ title: it.title, text: det.text, sessions: det.sessions, pick: det.pick }));
    return classified.get(id);
  }

  // ---------- 신청 탭 ----------
  // 위: 분류 고르기(전체 / 일정 확정 / 온라인 / 제출형 / 상담·개별 / 장기·기타) + "수업과 안 겹치는 것만" + 정렬
  // 카드: 분류 칩, 일정 한 줄, 신청 마감. 회차가 여러 개면 "회차 보기"로 회차마다 시각·포인트·정원·수업 겹침
  const PGROUPS = [
    { id: "all", label: "전체" },
    { id: "fixed", label: "일정 확정", cats: ["exact", "recurring", "date_only"] },
    { id: "online", label: "온라인", cats: ["online"] },
    { id: "submission", label: "제출형", cats: ["submission"] },
    { id: "consult", label: "상담·개별", cats: ["consult"] },
    { id: "etc", label: "장기·기타", cats: ["long_term", "open"] },
  ];
  let progGroup = "all";
  let progFree = false; // 수업과 안 겹치는 것만
  let progSort = "due"; // due | point
  const progOpen = new Set(); // 회차를 펼친 비교과 번호
  const WD = ["일", "월", "화", "수", "목", "금", "토"];

  // 내 시간표 = 수업 + 매주 반복 일정(알바·학원 등, 10/20)
  const slotsNow = () => (CAL ? [...(week?.ok ? CAL.weeklySlots(week.items) : []), ...fixedSlots()] : []);
  /** 회차 하나의 수업 겹침: 겹치는 수업 이름들 */
  function sessionClash(s, slots) {
    if (!CAL || !slots.length) return [];
    if (s.kind === "exact") return CAL.clashes(slots, s.start, s.end);
    if (s.kind === "recurring") {
      const a = new Date(s.start);
      const b = new Date(s.end);
      return CAL.weeklyClashes(slots, a.getDay(), hm(a), hm(b));
    }
    return [];
  }
  /** 분류 결과 → 신청할 수 있는 회차들 + 겹침 */
  function applyInfo(it, now = new Date()) {
    const r = classOf(it);
    if (!r) return null;
    const slots = slotsNow();
    const sessions = r.sessions
      .filter((s) => !s.end || new Date(s.end) >= now)
      .map((s) => ({
        ...s,
        clash: sessionClash(s, slots),
        closed: !!s.applyTo && new Date(s.applyTo) < now,
        full: s.capacity != null && s.applied != null && s.applied >= s.capacity,
      }));
    const open = sessions.filter((s) => !s.closed && !s.full);
    // 겹치지 않고 신청할 수 있는 회차가 하나라도 있으면 "안 겹침" (온라인·제출형처럼 시각이 없으면 겹침 없음)
    const free = open.some((s) => !s.clash.length);
    return { r, sessions, open, free, clashN: open.filter((s) => s.clash.length).length, minePicked: sessions.some((s) => s.mine) };
  }

  /** 일정 한 줄 */
  function scheduleSummary(info, it) {
    if (!info) return it.start ? `운영 ${dayLabel(new Date(it.start))}${it.end && !sameDay(new Date(it.start), new Date(it.end)) ? ` ~ ${dayLabel(new Date(it.end))}` : ""}` : "운영 일정은 상세 화면에서";
    const { r } = info;
    const ss = info.open.length ? info.open : info.sessions;
    const s = ss[0];
    if (!s) return "남은 회차 없음";
    const st = new Date(s.start);
    const en = new Date(s.end || s.start);
    const more = ss.length - 1;
    const tail = more > 0 ? ` 외 ${more}회차` : "";
    if (s.kind === "exact") return `${dayLabel(st)} ${hm(st)}–${hm(en)}${tail}`;
    if (s.kind === "multi_day") return `${dayLabel(st)} ${hm(st)} ~ ${dayLabel(en)} ${hm(en)}${tail}`;
    if (s.kind === "recurring") return `매주 ${WD[st.getDay()]} ${hm(st)}–${hm(en)} · ${r.recurring?.times || ""}회 (${md(st)}~)${tail}`;
    if (s.kind === "date_only") return `${dayLabel(st)}${sameDay(st, en) ? "" : ` ~ ${dayLabel(en)}`}${tail}`;
    return `${dayLabel(st)} ~ ${dayLabel(en)} 사이${tail}`;
  }
  function sessionWhen(s) {
    const st = new Date(s.start);
    const en = new Date(s.end || s.start);
    if (s.kind === "exact") return `${dayLabel(st)} ${hm(st)}–${hm(en)}`;
    if (s.kind === "recurring") return `매주 ${WD[st.getDay()]} ${hm(st)}–${hm(en)} (${md(st)}~${md(en)})`;
    if (s.kind === "multi_day") return `${dayLabel(st)} ${hm(st)} ~ ${dayLabel(en)} ${hm(en)}`;
    return `${dayLabel(st)} ~ ${dayLabel(en)}`;
  }
  function pickNote(info) {
    const { r, sessions } = info;
    if (sessions.length < 2) return null;
    if (r.chooseOne) return `회차 ${sessions.length}개 중 하나`;
    if (r.multi) return `회차 ${sessions.length}개 · 여러 개 신청 가능`;
    return `회차 ${sessions.length}개 중 골라 신청`;
  }

  function applyCard(it) {
    const m = it.meta || {};
    const info = applyInfo(it);
    const cat = info?.r.category;
    const seats = m.capacity ? `${m.applied ?? "?"}/${m.capacity}명${m.full ? " · 정원 마감" : ""}` : m.applied != null ? `${m.applied}명 신청` : "";
    const days = it.due ? daysLeft(it.due) : null;
    const tier = it.due ? riskTier(it.due) : 5;
    const tags = [];
    if (cat && C) tags.push(el("span", { class: `ap-cat c-${cat}`, title: info.r.evidence.join("\n") || null, text: C.CATEGORY_LABEL[cat] }));
    else if (!info) tags.push(el("span", { class: "ap-cat", text: detailProgress ? "확인 중" : "분류 전" }));
    if (info?.r.online && cat !== "online") tags.push(el("span", { class: "ap-tag", text: "온라인" }));
    const pn = info && pickNote(info);
    if (pn) tags.push(el("span", { class: "ap-tag", text: pn }));
    if (info?.clashN) tags.push(el("span", { class: "ap-tag clash", title: "내 시간표 = 수업 + 매주 반복 일정(알바·학원 등)", text: info.free ? `내 시간표와 겹치는 회차 ${info.clashN}` : "내 시간표와 겹침" }));
    if (info?.minePicked) tags.push(el("span", { class: "ap-tag mine", text: "신청함" }));

    const opened = progOpen.has(m.programId);
    const card = el("div", { class: `tcard ap r${tier}${m.full ? " full" : ""}` }, [
      el("a", { class: "tc-main", href: it.url, target: "_blank", rel: "noopener" }, [
        el("div", { class: "info" }, [el("div", { class: "tc-title", text: it.title }), el("div", { class: "tc-sub", text: [m.department, seats].filter(Boolean).join(" · ") })]),
        m.point ? el("span", { class: "badge program", text: `${m.point}p` }) : null,
      ]),
      tags.length ? el("div", { class: "ap-tags" }, tags) : null,
      el("div", { class: "tc-foot" }, [
        el("span", { class: "dline" }, [icon("clock"), el("span", { class: "when", text: scheduleSummary(info, it) })]),
        it.due ? el("span", { class: `dchip r${tier}`, title: `신청 마감 ${endLabel(it.due)}`, text: days <= 0 ? "오늘 신청 마감" : `신청 D-${days}` }) : null,
      ]),
    ]);
    const canAdd = info && ["open", "long_term", "consult"].includes(cat);
    {
      const row = el("div", { class: "ap-actions" }, [
        info && info.sessions.length > 1
          ? el("button", {
              class: "linkish",
              text: opened ? "회차 접기" : `회차 ${info.sessions.length}개 보기`,
              onclick: () => {
                opened ? progOpen.delete(m.programId) : progOpen.add(m.programId);
                renderPrograms();
              },
            })
          : null,
        canAdd ? el("button", { class: "linkish", title: "톡방·문자로 안내받은 일정을 직접 넣어 두면 캘린더에 보여요", text: "일정 직접 넣기", onclick: () => openEventForm({ t: it.title.slice(0, 60), g: m.programId }) }) : null,
        el("span", { class: "grow" }),
        detailLink(it.url),
      ]);
      card.appendChild(row);
    }
    if (opened && info) {
      card.appendChild(
        el(
          "div",
          { class: "ap-sessions" },
          info.sessions.map((s) =>
            el("div", { class: `ap-srow${s.closed || s.full ? " off" : ""}` }, [
              el("div", { class: "info" }, [
                el("div", { class: "name", text: s.name || it.title }),
                el("div", { class: "sub", text: [sessionWhen(s), s.point ? `${s.point}p` : null, s.capacity ? `${s.applied ?? "?"}/${s.capacity}명` : s.applied != null ? `${s.applied}명 신청` : null].filter(Boolean).join(" · ") }),
              ]),
              el("div", { class: "ap-stags" }, [
                s.mine ? el("span", { class: "ap-tag mine", text: "신청함" }) : null,
                s.closed ? el("span", { class: "ap-tag", text: "신청 끝" }) : s.full ? el("span", { class: "ap-tag", text: "정원 마감" }) : null,
                s.clash.length ? el("span", { class: "ap-tag clash", title: s.clash.map((c) => c.name).join(", "), text: `겹침: ${s.clash[0].name.replace(/\(.*$/, "")}` }) : null,
              ]),
            ])
          )
        )
      );
    }
    return card;
  }

  function renderApply() {
    if (!programs) return [placeholder("불러오는 중…")];
    if (!programs.ok) return [failCard(programs.error?.message, () => loadPrograms({ force: true }))];
    const now = Date.now();
    const all = programs.data.filter((it) => !it.due || new Date(it.due).getTime() >= now);
    const groupOf = (it) => {
      const cat = classOf(it)?.category;
      return cat ? PGROUPS.find((g) => g.cats?.includes(cat))?.id : null;
    };
    const counts = Object.fromEntries(PGROUPS.map((g) => [g.id, g.id === "all" ? all.length : all.filter((it) => groupOf(it) === g.id).length]));
    let list = progGroup === "all" ? all : all.filter((it) => groupOf(it) === progGroup);
    if (progFree) list = list.filter((it) => applyInfo(it)?.free !== false);
    if (progSort === "point") list = [...list].sort((a, b) => (b.meta?.point || 0) - (a.meta?.point || 0) || byDue(a, b));

    const chips = el(
      "div",
      { class: "ap-filter" },
      PGROUPS.map((g) =>
        el("button", {
          class: g.id === progGroup ? "fchip active" : "fchip",
          text: `${g.label} ${counts[g.id]}`,
          onclick: () => {
            progGroup = g.id;
            renderPrograms();
          },
        })
      )
    );
    const opts = el("div", { class: "ap-opts" }, [
      el("label", { class: "ap-check", title: "신청할 수 있는 회차 중 내 시간표(수업 + 매주 반복 일정)와 안 겹치는 게 하나라도 있는 것만" }, [
        (() => {
          const c = el("input", {
            type: "checkbox",
            disabled: week?.ok || fixedList().length ? null : "",
            onchange: (e) => {
              progFree = e.target.checked;
              renderPrograms();
            },
          });
          c.checked = progFree;
          return c;
        })(),
        el("span", { text: "내 시간표와 안 겹치는 것만" }),
      ]),
      el("span", { class: "grow" }),
      el("div", { class: "seg-mini-wrap" }, [
        ["due", "마감순"],
        ["point", "포인트순"],
      ].map(([id, label]) =>
        el("button", {
          class: progSort === id ? "seg-mini active" : "seg-mini",
          text: label,
          onclick: () => {
            progSort = id;
            renderPrograms();
          },
        })
      )),
    ]);
    const parts = [chips, opts];
    if (detailProgress) parts.push(el("p", { class: "ap-progress", text: `회차·안내문 확인 중 ${detailProgress.done}/${detailProgress.total} (처음 한 번만 조금 걸려요)` }));
    if (programs.error) parts.push(el("p", { class: "stale", text: "새로 불러오지 못해 예전 데이터를 보여주고 있어요." }));
    if (!list.length) {
      parts.push(placeholder(progFree ? "조건에 맞는 비교과가 없어요. '내 시간표와 안 겹치는 것만'을 꺼 보세요." : "이 분류의 접수 중 비교과가 없어요."));
      return parts;
    }
    if (progSort === "due") {
      const soon = list.filter((it) => it.due && new Date(it.due).getTime() <= now + 7 * 86400000);
      const later = list.filter((it) => !soon.includes(it));
      if (soon.length) parts.push(secTitle("1주일 안에 신청 마감", soon.length), rows(soon.map(applyCard)));
      if (later.length) parts.push(secTitle("그 뒤 마감", later.length), rows(later.map(applyCard)));
    } else parts.push(secTitle("포인트 높은 순", list.length), rows(list.map(applyCard)));
    return parts;
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
      ...aiExtras(),
    };
  }
  // 10/20: 화면이 계산해 둔 것도 같이 (매주 회차의 다음 회, 기간형 비교과의 끝, 직접 넣은 일정, 학사일정, 이번 학기 포인트, 신청 탭 분류)
  function aiExtras(now = new Date()) {
    const myNext = {};
    for (const x of mySessions(now, addDays(now, 60)).filter((x) => !x.allDay && x.end >= now).sort((a, b) => a.start - b.start)) {
      if (!myNext[x.p.id]) myNext[x.p.id] = { start: x.start.toISOString(), end: x.end.toISOString(), weekly: !!x.weekly };
    }
    const myEnds = {};
    for (const x of programEnds()) if (new Date(x.due) >= now && (!myEnds[x.p.id] || x.due < myEnds[x.p.id])) myEnds[x.p.id] = x.due;
    const events = eventList()
      .filter((x) => !x.tm.rough && !isHidden(`ev:${x.id}`))
      .map((x) => ({ id: x.id, title: x.ev.t, start: x.tm.start.toISOString(), end: x.tm.end.toISOString(), allDay: x.tm.allDay }));
    const pointSum = PT && mine?.ok && mine.data.points ? PT.pointSummary(mine.data.points, now) : null;
    const openInfo = {};
    if (programs?.ok)
      for (const it of programs.data) {
        const info = applyInfo(it, now);
        if (!info) continue;
        const ex = info.open.find((s) => s.kind === "exact");
        // 수업과 안 겹치는 회차(매주 회차 포함)가 있으면 그 시각을 문장으로
        const freeS = info.open.find((s) => !s.clash.length && ["exact", "recurring", "multi_day"].includes(s.kind));
        openInfo[it.meta?.programId] = { category: info.r.category, exact: ex ? { start: ex.start, end: ex.end } : null, when: freeS ? sessionWhen(freeS) : null, free: info.free };
      }
    return { myNext, myEnds, events, academic: academicList(), pointSum, openInfo };
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
    const a =
      intent === "academic" && !acadOn()
        ? { text: "학사일정 보기를 꺼 두었어요. 캘린더 탭 아래나 '연결 상태 · 설정'의 학사일정 스위치를 켜면 알려 드릴게요.", picks: [] }
        : ai.localAnswer(intent, built, new Date(), { kinds: presetId ? [] : ai.detectKinds(q) });
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
    if (r.kind === "event") {
      const st = new Date(it.start);
      return el("button", { class: "ai-pick", onclick: () => editEvent(it.id) }, [
        el("span", { class: "badge ev", text: "내 일정" }),
        el("div", { class: "info" }, [el("div", { class: "name", text: it.title }), el("div", { class: "sub", text: p.reason || (it.allDay ? dayLabel(st) : `${dayLabel(st)} ${hm(st)}`) })]),
      ]);
    }
    if (r.kind === "acad") {
      return el("a", { class: "ai-pick", href: ACADEMIC_URL, target: "_blank", rel: "noopener" }, [
        el("span", { class: "badge acad", text: it.kind === "exam" ? "시험" : "학사" }),
        el("div", { class: "info" }, [el("div", { class: "name", text: it.title }), el("div", { class: "sub", text: p.reason || `${it.start.slice(5)} ~ ${it.end.slice(5)}` })]),
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
    { id: "academic", label: "학교 신청 기간 알려줘" },
  ];

  // ---------- 연결 상태 (접어 두는 진단 칸) ----------
  const statusList = el("ul", { class: "status" });
  // ---------- 연결 상태 · 설정 (10/20: 백업, 내 데이터 지우기, 처음 안내 다시 보기, 버전) ----------
  let wipeArmed = false;
  const settingsNote = el("p", { class: "set-note" });
  const setOpts = el("div", { class: "set-opts" }); // 켜고 끄는 것들 (rerender 때 다시 그림)
  const renderSetOpts = () => setOpts.replaceChildren(el("span", { class: "set-opt-label", text: "보이기" }), acadSwitch("학사일정 (신청 기간·시험)"));
  const wipeBtn = el("button", {
    class: "small danger",
    text: "내 데이터 모두 지우기",
    onclick: async () => {
      if (!wipeArmed) {
        wipeArmed = true;
        wipeBtn.textContent = "한 번 더 누르면 지워요";
        settingsNote.textContent = "불러온 학교 데이터(캐시), 숨긴 항목, 과목 색, 직접 넣은 일정이 지워져요. 숨긴 항목·과목 색·직접 넣은 일정은 같은 구글 계정의 다른 크롬에서도 지워져요.";
        return;
      }
      await wipeAll();
    },
  });
  async function wipeAll() {
    try {
      await send({ type: "clearCache" });
      const local = await chrome.storage.local.get(null);
      await chrome.storage.local.remove(Object.keys(local));
      const sync = await chrome.storage.sync.get(null);
      await chrome.storage.sync.remove(Object.keys(sync).filter((k) => /^(hide|color|ev|opt)\|/.test(k)));
      hidden = {};
      opts = {};
      events = {};
      courseColors = {};
      details = {};
      classified.clear();
      week = eclass = programs = mine = academic = null;
      settingsNote.textContent = "지웠어요. 패널을 다시 열면 학교 사이트에서 새로 불러와요.";
    } catch (err) {
      if (isDeadContext(err)) return onDeadContext();
      settingsNote.textContent = `지우지 못했어요: ${err.message}`;
    }
    wipeArmed = false;
    wipeBtn.textContent = "내 데이터 모두 지우기";
    rerender();
  }
  const statusSection = el("details", { class: "status-box" }, [
    el("summary", {}, [el("span", { text: "연결 상태 · 설정" })]),
    el("div", { class: "status-actions" }, [el("button", { class: "small", text: "다시 확인", onclick: () => checkStatus() })]),
    statusList,
    el("div", { class: "set-box" }, [
      setOpts,
      el("div", { class: "set-row" }, [
        el("button", { class: "small", text: "처음 안내 다시 보기", onclick: () => showWelcome(true) }),
        el("button", { class: "small", text: "백업 저장", onclick: () => exportBackup() }),
        el("button", { class: "small", text: "백업 불러오기", onclick: () => importBackup() }),
        wipeBtn,
      ]),
      settingsNote,
      el("p", { class: "set-ver", text: `HSU PLUS ${chrome.runtime.getManifest?.().version || ""} · 학생 제작 프로토타입, 학교 공식 서비스가 아니에요 · 학교 사이트는 읽기만 하고 비밀번호는 저장하지 않아요` }),
    ]),
  ]);

  renderSetOpts();

  function statusRow(name, ok, detail, loginUrl) {
    return el("li", { class: ok ? "ok" : "ng" }, [
      el("span", { class: "dot" }),
      el("span", { class: "name", text: name }),
      el("span", { class: "detail", text: detail }),
      !ok && loginUrl ? el("a", { href: loginUrl, target: "_blank", rel: "noopener", text: "로그인" }) : null,
    ]);
  }

  let conn = null; // 처음 안내에 쓰는 연결 결과 { eclass: bool, sites: [{name, loggedIn, loginUrl}] }
  async function checkStatus() {
    statusList.replaceChildren(el("li", { class: "loading", text: "확인 중…" }));
    const eclassOk = document.body.innerText.includes("로그아웃");
    conn = { eclass: eclassOk, sites: null };
    const rows = [statusRow("e클래스", eclassOk, eclassOk ? "연결됨" : "로그인 필요")];
    try {
      const results = await send({ type: "checkLogin" });
      conn = { eclass: eclassOk, sites: results.map((r) => ({ name: r.name, loggedIn: r.loggedIn, loginUrl: r.loginUrl })) };
      if (welcomeOpen && current === "week") renderWeek();
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
      loadAcademic();
      checkStatus();
    }
  }
  launcher.addEventListener("click", () => toggle(true));

  renderTabs();
  renderBody();
})();
