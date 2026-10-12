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
    { id: "alerts", label: "알림" },
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
        block.style.background = courseColor(it.course || it.title)?.c || "var(--ot-muted)";
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
  ];
  let weekKind = "video"; // 지금 고른 칸 (다시 그려도 유지)

  function renderWeek() {
    const now = new Date();
    const head = el("div", { class: "section-head" }, [
      el("span", { class: "meta", text: eclassLoading ? "불러오는 중…" : eclass?.fetchedAt ? `e클래스 ${ago(eclass.fetchedAt)}` : "" }),
      el("button", { class: "small", text: "새로고침", disabled: eclassLoading ? "" : null, onclick: () => loadEclass({ force: true }) }),
    ]);

    // 종류별 남은 항목
    let lists = null;
    if (eclass?.ok) {
      const pending = eclass.data.items.filter((it) => it.status === "todo" && (!it.due || new Date(it.due) >= now)).sort(byDue);
      lists = {
        // 강의: 수강 기간이 시작된 것만 (기간 없는 보충 영상은 출석과 무관해서 뺀다)
        video: pending.filter((it) => it.type === "video" && it.due && (!it.start || new Date(it.start) <= now)),
        assignment: pending.filter((it) => it.type === "assignment"),
        quiz: pending.filter((it) => it.type === "quiz"),
      };
    }

    const seg = el(
      "div",
      { class: "seg", role: "tablist" },
      KINDS.map((k) => {
        const items = lists?.[k.id] || [];
        const hot = items.some((it) => isUrgent(it.due));
        return el(
          "button",
          {
            class: k.id === weekKind ? "seg-btn active" : "seg-btn",
            role: "tab",
            "aria-selected": String(k.id === weekKind),
            title: hot ? "마감 이틀 이내 항목이 있어요" : null,
            onclick: () => {
              weekKind = k.id;
              renderWeek();
            },
          },
          [
            el("span", { class: "lbl" }, [el("span", { text: k.label }), hot ? el("span", { class: "dot", "aria-label": "마감 임박" }) : null]),
            lists ? el("span", { class: "n", text: String(items.length) }) : null,
          ]
        );
      })
    );

    let bodyParts;
    if (!eclass) bodyParts = [placeholder("과목별 과제와 강의를 확인하고 있어요…")];
    else if (!eclass.ok) bodyParts = [failCard(eclass.error?.message, () => loadEclass({ force: true }))];
    else {
      const kind = KINDS.find((k) => k.id === weekKind);
      const items = lists[weekKind];
      bodyParts = [];
      if (eclass.error) bodyParts.push(el("p", { class: "stale", text: "e클래스를 새로 불러오지 못해 예전 데이터를 보여주고 있어요." }));
      bodyParts.push(items.length ? rows(grouped(weekKind, items, kind.label)) : placeholder(kind.empty));
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

  function rerender() {
    if (deadContext) return renderDeadNotice();
    if (current === "week") renderWeek();
    else if (current === "calendar") renderCalendar();
    else if (current === "programs") renderPrograms();
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

  // 비교과 한 줄
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
    const now = Date.now();
    const soon = programs.data.filter((it) => it.due && new Date(it.due).getTime() >= now && new Date(it.due).getTime() <= now + 7 * 86400000);
    const parts = [head];
    if (programs.error) parts.push(el("p", { class: "stale", text: "새로 불러오지 못해 예전 데이터를 보여주고 있어요." }));
    if (!soon.length) parts.push(placeholder("1주일 안에 신청이 마감되는 비교과가 없어요."));
    else parts.push(rows(soon.map(programRow)));
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
      checkStatus();
    }
  }
  launcher.addEventListener("click", () => toggle(true));

  renderTabs();
  renderBody();
})();
