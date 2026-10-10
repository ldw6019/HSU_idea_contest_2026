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
    if (current === "calendar") return renderCalendar();
    if (current === "programs") return renderPrograms();
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
  // 과목별 색 (같은 과목은 항상 같은 색). 디자인 단계에서 바꿀 수 있게 여기 모아 둠
  const PALETTE = ["#4f7cff", "#16a394", "#f08a24", "#9b5de5", "#e5484d", "#2a9d8f", "#d4a017", "#5c6ac4"];
  const colorOf = (name) => {
    let h = 0;
    for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return PALETTE[h % PALETTE.length];
  };
  const minutesOf = (d) => d.getHours() * 60 + d.getMinutes();

  function renderCalendar() {
    const wideBtn = el("button", {
      class: "small",
      text: panel.classList.contains("wide") ? "좁게 보기" : "넓게 보기",
      onclick: () => {
        panel.classList.toggle("wide");
        renderCalendar();
      },
    });
    const head = el("div", { class: "section-head" }, [
      el("span", { class: "title", text: "이번 주 시간표" }),
      el("span", { class: "meta", text: loading ? "불러오는 중…" : ago(week?.fetchedAt) }),
      wideBtn,
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

    const items = weekItems();
    const { start: monday } = weekRange();
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
        const block = el("div", { class: e < now ? "tt-block past" : "tt-block", title: `${it.course || it.title}\n${hm(s)}–${hm(e)}\n${[it.place, it.professor].filter(Boolean).join(" · ")}` }, [
          el("div", { class: "tt-name", text: it.course || it.title }),
          it.place ? el("div", { class: "tt-place", text: it.place }) : null,
        ]);
        block.style.top = top + "px";
        block.style.height = height - 2 + "px";
        block.style.background = colorOf(it.course || it.title);
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
    parts.push(grid);
    content.replaceChildren(...parts);
  }

  function renderWeek() {
    const head = el("div", { class: "section-head" }, [
      el("span", { class: "title", text: "이번 주 수업" }),
      el("span", { class: "meta", text: loading ? "불러오는 중…" : ago(week?.fetchedAt) }),
      el("button", { class: "small", text: "새로고침", disabled: loading ? "" : null, onclick: () => loadWeek({ force: true }) }),
    ]);

    if (!week) {
      content.replaceChildren(todoBlock(), head, el("p", { class: "placeholder", text: "불러오는 중…" }));
      return;
    }
    if (!week.ok) {
      const e = week.error || {};
      content.replaceChildren(todoBlock(), head, e.kind === "login" ? loginCard(e.site) : failCard(e.message));
      return;
    }

    const parts = [head];
    // 새로 받기는 실패했지만 예전 데이터가 있는 경우
    if (week.error) {
      parts.push(
        el("p", { class: "stale", text: week.error.kind === "login" ? `${week.error.site} 로그인이 풀려 예전 데이터를 보여주고 있어요.` : "새로 불러오지 못해 예전 데이터를 보여주고 있어요." })
      );
    }

    const now = new Date();
    const items = weekItems();

    if (!items.length) {
      parts.push(el("p", { class: "placeholder", text: "이번 주 수업이 없어요." }));
      content.replaceChildren(todoBlock(), ...parts);
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
    content.replaceChildren(todoBlock(), ...parts);
  }


  // ================================================================ M2: e클래스 과제·영상, 비교과
  // 공용 모듈(공통 형식, 캐시, 어댑터)을 동적으로 불러온다 (content script는 import문을 못 씀)
  const mods = Promise.all([
    import(chrome.runtime.getURL("core/cache.js")),
    import(chrome.runtime.getURL("adapters/eclass.js")),
    import(chrome.runtime.getURL("adapters/hsportal.js")),
  ]).then(([cache, eclass, hsportal]) => ({ cache, eclass, hsportal }));

  // 다른 학교 사이트 페이지 글은 백그라운드가 받아 준다
  async function getText(url) {
    const r = await send({ type: "fetchText", url });
    if (!r || r.ok === false) throw new Error(r?.error?.message || `요청 실패 (${r?.status})`);
    return r.text;
  }

  const plainErr = (err) => ({ kind: err?.name === "ParseError" ? "parse" : "network", message: String(err?.message || err) });

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
      if (r.data.failed?.length) console.warn("[ON-Track] 일부 과목을 읽지 못함", r.data.failed);
    } catch (err) {
      console.warn("[ON-Track] e클래스 불러오기 실패:", err);
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
      const r = await cache.getOrFetch("programs-closing", cache.TTL.PROGRAMS, () => hsportal.fetchClosingPrograms(getText), { force });
      programs = { ok: true, data: r.data, fetchedAt: r.fetchedAt, error: r.error ? plainErr(r.error) : null };
      logItems("마감 임박 비교과", r.data);
    } catch (err) {
      console.warn("[ON-Track] 비교과 불러오기 실패:", err);
      programs = { ok: false, error: plainErr(err) };
    }
    programsLoading = false;
    rerender();
  }

  function rerender() {
    if (current === "week") renderWeek();
    else if (current === "calendar") renderCalendar();
    else if (current === "programs") renderPrograms();
  }

  // 공통 형식으로 잘 바뀌었는지 콘솔에서 확인 (M2 완료 기준)
  function logItems(label, items) {
    console.log(`[ON-Track] ${label}: ${items.length}건`);
    console.table(items.map((it) => ({ 종류: it.type, 과목: it.course, 제목: it.title, 마감: it.due, 상태: it.status, ...(it.meta?.percent != null ? { 수강률: it.meta.percent + "%" } : {}), ...(it.meta?.point != null ? { 포인트: it.meta.point } : {}) })));
  }

  const TYPE_LABEL = { assignment: "과제", video: "영상", program: "비교과" };
  function dueText(iso) {
    if (!iso) return "기한 없음";
    const d = new Date(iso);
    // 시각 차이가 아니라 "날짜" 차이로 센다 (10/10 오후에 10/12 마감 → D-2)
    const day0 = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const days = Math.round((day0(d) - day0(new Date())) / 86400000);
    const dd = days <= 0 ? "오늘" : `D-${days}`;
    return `${dd} · ${md(d)} ${hm(d)}`;
  }

  // ---------- 이번 주 탭 위쪽: 마감 임박 할 일 (과제·영상) ----------
  function todoBlock() {
    const box = el("div", { class: "block" });
    const head = el("div", { class: "section-head" }, [
      el("span", { class: "title", text: "7일 안에 마감" }),
      el("span", { class: "meta", text: eclassLoading ? "불러오는 중…" : ago(eclass?.fetchedAt) }),
      el("button", { class: "small", text: "새로고침", disabled: eclassLoading ? "" : null, onclick: () => loadEclass({ force: true }) }),
    ]);
    box.appendChild(head);
    if (!eclass) {
      box.appendChild(el("p", { class: "placeholder", text: "과목별 과제와 영상을 확인하고 있어요…" }));
      return box;
    }
    if (!eclass.ok) {
      box.appendChild(failCard(eclass.error?.message));
      return box;
    }
    if (eclass.error) box.appendChild(el("p", { class: "stale", text: "새로 불러오지 못해 예전 데이터를 보여주고 있어요." }));

    const now = Date.now();
    const limit = now + 7 * 86400000;
    const todo = eclass.data.items
      .filter((it) => it.status === "todo" && it.due && new Date(it.due).getTime() >= now && new Date(it.due).getTime() <= limit)
      .sort((a, b) => new Date(a.due) - new Date(b.due));

    if (!todo.length) {
      box.appendChild(el("p", { class: "placeholder", text: "7일 안에 마감되는 과제·영상이 없어요." }));
      return box;
    }
    const list = el("div", { class: "todos" });
    for (const it of todo) {
      const extra = it.type === "video" && it.meta?.percent != null ? ` · ${it.meta.percent}% 수강` : "";
      list.appendChild(
        el("a", { class: "todo", href: it.url, target: "_blank", rel: "noopener" }, [
          el("span", { class: `badge ${it.type}`, text: TYPE_LABEL[it.type] }),
          el("div", { class: "info" }, [el("div", { class: "name", text: it.title }), el("div", { class: "sub", text: `${it.course}${extra}` })]),
          el("span", { class: "due", text: dueText(it.due) }),
        ])
      );
    }
    box.appendChild(list);
    return box;
  }

  // ---------- 비교과 탭: 1주일 안에 신청 마감 ----------
  function renderPrograms() {
    const head = el("div", { class: "section-head" }, [
      el("span", { class: "title", text: "1주일 안에 신청 마감" }),
      el("span", { class: "meta", text: programsLoading ? "불러오는 중…" : ago(programs?.fetchedAt) }),
      el("button", { class: "small", text: "새로고침", disabled: programsLoading ? "" : null, onclick: () => loadPrograms({ force: true }) }),
    ]);
    if (!programs) {
      content.replaceChildren(head, el("p", { class: "placeholder", text: "불러오는 중…" }));
      return;
    }
    if (!programs.ok) {
      content.replaceChildren(head, failCard(programs.error?.message));
      return;
    }
    const parts = [head];
    if (programs.error) parts.push(el("p", { class: "stale", text: "새로 불러오지 못해 예전 데이터를 보여주고 있어요." }));
    if (!programs.data.length) parts.push(el("p", { class: "placeholder", text: "1주일 안에 신청이 마감되는 비교과가 없어요." }));
    const list = el("div", { class: "todos" });
    for (const it of programs.data) {
      const m = it.meta || {};
      const seats = m.capacity ? `${m.applied ?? "?"}/${m.capacity}명${m.full ? " · 정원 마감" : ""}` : m.applied != null ? `${m.applied}명 신청` : "";
      const runAt = it.start ? `운영 ${md(new Date(it.start))}` : "";
      list.appendChild(
        el("a", { class: m.full ? "todo full" : "todo", href: it.url, target: "_blank", rel: "noopener" }, [
          el("span", { class: "badge program", text: m.point ? `${m.point}p` : "비교과" }),
          el("div", { class: "info" }, [el("div", { class: "name", text: it.title }), el("div", { class: "sub", text: [m.department, runAt, seats].filter(Boolean).join(" · ") })]),
          el("span", { class: "due", text: `신청 ${dueText(it.due)}` }),
        ])
      );
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
      loadEclass();
      loadPrograms();
      checkStatus();
    }
  }
  launcher.addEventListener("click", () => toggle(true));

  renderTabs();
  renderBody();
})();
