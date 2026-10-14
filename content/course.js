// HSU PLUS — 과목 페이지(강의실, /course/view.php) 꾸미기
// e클래스 기본 화면은 강의를 다 들었는지, 과제를 냈는지 하나씩 눌러 봐야 안다.
// 그래서 강의실 목록에 바로 보이게 덧붙인다 (기존 익텐 hsu-ecx의 배치를 따르고, 색 입히는 방식은 우리 식으로:
// 빈 칸도 상태 색으로 옅게 + 듣는 중인 강의는 흐르는 줄무늬).
// 색: 초록 = 완료(출석·제출·응시)에만. 나머지는 패널과 같은 마감 위험도 색
//  - 강의 영상: 제목 아래 진도 막대(안에 "학습시간 / 출석 기준 시간(%)", 기준 = 영상 길이의 90%)
//               + 오른쪽 꼬리표: 출석 / 결석 / 열림 날짜 / "N분 N초 필요" + "N일 … 남음"(1초마다 갱신)
//  - 과제: 제출 완료(+제출 시각) / 미제출 + 마감 + 남은 시간
//  - 퀴즈: 응시 완료 / 미응시 + 마감 + 남은 시간
// 읽는 곳: 온라인출석부 진도 표, 과제 목록 표, 과제 화면의 "제출 여부·종료 일시·최종 수정 일시" 줄만,
//          퀴즈 목록 표, 퀴즈 응시 요약의 "진행 상황" 칸만. 성적·점수·첨부파일은 읽지 않는다.
// 또 패널의 강의 카드를 눌러 들어오면(#hsuplus-module-번호) 그 강의로 스크롤하고 잠깐 강조한다.

(() => {
  if (location.pathname !== "/course/view.php") return;
  const courseId = new URLSearchParams(location.search).get("id");
  if (!courseId || document.documentElement.dataset.hsuplusCourse) return;
  document.documentElement.dataset.hsuplusCourse = "1";

  // 패널에서 넘어온 경우: 이동할 강의 번호를 기억하고 주소 끝 표시는 지운다
  const jumpId = /^#hsuplus-module-(\d+)$/.exec(location.hash)?.[1] || null;
  if (jumpId) history.replaceState(null, "", location.pathname + location.search);

  const ATTEND_RATIO = 0.9; // 출석 기준 = 영상 길이의 90% (예: 53:22 → 48:01)

  // ---------- 시간·날짜 표시 ----------
  const pad = (n) => String(n).padStart(2, "0");
  const DAY = ["일", "월", "화", "수", "목", "금", "토"];
  const clock = (sec) => {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  };
  // 0시 마감은 "전날 24:00"으로 (패널과 같은 규칙)
  const isMidnight = (d) => d.getHours() === 0 && d.getMinutes() === 0;
  const dueDay = (d) => (isMidnight(d) ? new Date(d.getTime() - 60000) : d);
  const dateLabel = (d) => {
    const e = dueDay(d);
    return `${e.getMonth() + 1}/${e.getDate()}(${DAY[e.getDay()]}) ${isMidnight(d) ? "24:00" : `${pad(d.getHours())}:${pad(d.getMinutes())}`}`;
  };
  const daysLeft = (d) => {
    const day0 = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    return Math.round((day0(dueDay(d)) - day0(new Date())) / 86400000);
  };
  // 마감 위험도 5단계 (패널과 같은 색): 1 당일·1일 / 2 2일 / 3 3~7일 / 4 8~13일 / 5 14일 이상
  const tier = (d) => {
    const n = daysLeft(d);
    return n <= 1 ? 1 : n === 2 ? 2 : n <= 7 ? 3 : n < 14 ? 4 : 5;
  };

  // ---------- 화면 조각 ----------
  const mk = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  // 남은 시간을 "6일 5시간 16분 56초"처럼 (앞쪽 0 단위는 생략)
  const dhms = (sec) => {
    sec = Math.max(0, Math.floor(sec));
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const parts = [];
    if (d) parts.push(`${d}일`);
    if (d || h) parts.push(`${h}시간`);
    if (d || h || m) parts.push(`${m}분`);
    parts.push(`${s}초`);
    return parts.join(" ");
  };

  function injectStyle() {
    if (document.getElementById("hsup-style")) return;
    const st = mk("style");
    st.id = "hsup-style";
    // 상태별 색은 변수 3개: --a(밝은 쪽) --b(진한 쪽) --ink(그 위 글자)
    // 초록은 "완료"(출석·제출 완료·응시 완료)에만. 진행 중은 패널과 같은 마감 위험도 5단계 색
    st.textContent = `
      .hsup-row { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 8px; margin: 6px 0 8px 0;
        font-variant-numeric: tabular-nums; }
      .hsup-ok   { --a: #2fe07a; --b: #0fbf55; --ink: #fff; --t: #d6f7e3; --d: #0b7a38; }
      .hsup-bad  { --a: #ff6b6b; --b: #d42f35; --ink: #fff; --t: #fde2e2; --d: #b42318; }
      .hsup-gray { --a: #c9cfd8; --b: #9aa3b1; --ink: #fff; --t: #e6eaf0; --d: #5b6577; }
      .hsup-wait { --a: #eef1f5; --b: #dde2ea; --ink: #4a5568; --t: #eef1f5; --d: #4a5568; }
      .hsup-r1 { --a: #ff6b6b; --b: #d42f35; --ink: #fff; --t: #fde2e2; --d: #b42318; }
      .hsup-r2 { --a: #ff9b54; --b: #e8590c; --ink: #fff; --t: #ffe5d3; --d: #b93c0a; }
      .hsup-r3 { --a: #ffc94d; --b: #f0a01a; --ink: #3d2600; --t: #ffefcc; --d: #8f5200; }
      .hsup-r4 { --a: #fae17a; --b: #e3bf1f; --ink: #3d3000; --t: #fcf2c6; --d: #6e5600; }
      .hsup-r5 { --a: #b7c5d9; --b: #8193ad; --ink: #fff; --t: #e8edf4; --d: #46536a; }
      .hsup-left { --a: #3d82f0; --b: #0b4ea2; --ink: #fff; --t: #e1ecfd; --d: #0b4ea2; }

      /* 진도 막대: 글자를 막대 안에. 빈 칸은 상태 색을 옅게(0%여도 급한 정도가 보이게),
         채운 칸은 밝은색→진한색 그라데이션 + 위쪽 광택. 아직 듣는 중인 강의는 사선 줄무늬가 천천히 흐른다 */
      .hsup-bar { position: relative; flex: none; width: 320px; height: 16px; border-radius: 5px; overflow: hidden;
        background: var(--t, #e6eaf0); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--b, #9aa3b1) 24%, transparent); }
      .hsup-fill { position: absolute; inset: 0 auto 0 0; overflow: hidden; border-radius: 5px 0 0 5px;
        background: linear-gradient(180deg, rgba(255,255,255,.22), rgba(255,255,255,0) 55%), linear-gradient(90deg, var(--a), var(--b)); }
      .hsup-fill.hsup-full { border-radius: 5px; }
      /* 완료 막대는 꼬리표보다 한 단계 진한 초록 (안의 흰 글자가 잘 보이게) */
      .hsup-fill.hsup-ok { --a: #23a85b; --b: #0b7d3e; }
      .hsup-fill.hsup-gray { --a: #a9b1be; --b: #7d889a; }
      .hsup-fill.hsup-live {
        background: repeating-linear-gradient(-45deg, rgba(255,255,255,.24) 0 8px, rgba(255,255,255,0) 8px 16px),
          linear-gradient(180deg, rgba(255,255,255,.18), rgba(255,255,255,0) 55%), linear-gradient(90deg, var(--a), var(--b));
        background-size: 22.63px 22.63px, 100% 100%, 100% 100%; animation: hsup-flow 1.4s linear infinite; }
      @keyframes hsup-flow { to { background-position: 22.63px 0, 0 0, 0 0; } }
      @media (prefers-reduced-motion: reduce) { .hsup-fill.hsup-live { animation: none; } }
      .hsup-lbl { position: absolute; left: 0; top: 0; width: 320px; height: 16px; line-height: 16px; text-align: center;
        font-size: 11.5px; font-weight: 700; color: var(--d, #4a5568); white-space: nowrap; }
      .hsup-fill .hsup-lbl { color: var(--ink); }
      .hsup-fill .hsup-lbl[data-ink="light"] { text-shadow: 0 1px 1px rgba(0,0,0,.3); }
      .hsup-tag[data-ink="light"] { text-shadow: 0 1px 1px rgba(0,0,0,.18); }

      /* 막대 오른쪽 꼬리표: 진한 그라데이션 (안내용 회색 꼬리표만 옅게) */
      .hsup-tag { display: inline-flex; align-items: center; height: 20px; padding: 0 8px; border-radius: 6px;
        font-size: 12px; font-weight: 700; color: var(--ink); white-space: nowrap;
        background: linear-gradient(180deg, rgba(255,255,255,.2), rgba(255,255,255,0) 55%), linear-gradient(90deg, var(--a), var(--b));
        box-shadow: 0 1px 2px rgba(15,23,42,.16); }
      .hsup-tag.hsup-wait { background: #eef1f5; box-shadow: inset 0 0 0 1px #dde2ea; }
      /* 과제·퀴즈 칸끼리 구분: 제출 시각 = 옅은 초록, 늦은 제출 = 주황, 마감 = 진회색 */
      .hsup-tag.hsup-at { background: var(--t); color: var(--d); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--b) 45%, transparent); }
      .hsup-due { --a: #7a8597; --b: #535d6e; --ink: #fff; }
      .hsup-late { --a: #ffab3d; --b: #f57c00; --ink: #fff; }
      /* 과제·퀴즈는 제목 바로 옆 한 줄에 */
      .hsup-inline { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-left: 10px; vertical-align: middle;
        font-variant-numeric: tabular-nums; }
      /* 제목 옆 알약은 막대가 없을 때(영상 길이를 모를 때)만 */
      .hsup-pill { margin: 0 8px 0 6px; vertical-align: middle; }

      .hsup-flash { transition: background .6s, outline-color .6s; outline: 3px solid #0b4ea2 !important; outline-offset: 4px; background: #eef4ff !important; }
    `;
    document.head.appendChild(st);
  }
  const LIGHT_INK = new Set(["hsup-ok", "hsup-bad", "hsup-gray", "hsup-r1", "hsup-r2", "hsup-r5", "hsup-left", "hsup-due", "hsup-late"]);
  const tag = (cls, text) => {
    const t = mk("span", `hsup-tag ${cls}`, text);
    if (!cls.includes("hsup-at") && cls.split(" ").some((c) => LIGHT_INK.has(c))) t.dataset.ink = "light";
    return t;
  };
  function placePill(li, node) {
    const a = li.querySelector(".activityinstance > a");
    if (a) a.after(node);
  }
  function placeRow(li, row) {
    const inst = li.querySelector(".activityinstance");
    if (inst) inst.after(row);
  }

  // 남은 시간 꼬리표: 1초마다 줄어든다
  const live = new Set();
  function countdown(until) {
    const t = tag("hsup-left", "");
    const tick = () => {
      const left = (until - Date.now()) / 1000;
      t.textContent = left > 0 ? `${dhms(left)} 남음` : "마감";
      return left > 0;
    };
    tick();
    live.add({ t, tick });
    return t;
  }
  setInterval(() => {
    for (const x of live) if (!x.t.isConnected || !x.tick()) live.delete(x);
  }, 1000);

  // 진도 막대 (글자 안에)
  function bar(ratio, colorCls, text, moving) {
    const b = mk("div", `hsup-bar ${colorCls}`);
    b.appendChild(mk("span", "hsup-lbl", text));
    const w = Math.min(1, Math.max(0, ratio));
    if (w > 0) {
      const f = mk("div", `hsup-fill ${colorCls}${w >= 1 ? " hsup-full" : ""}${moving ? " hsup-live" : ""}`);
      f.style.width = `${w * 100}%`;
      const l = mk("span", "hsup-lbl", text);
      if (LIGHT_INK.has(colorCls)) l.dataset.ink = "light";
      f.appendChild(l);
      b.appendChild(f);
    }
    return b;
  }

  // ---------- 강의 영상 ----------
  // [ 학습시간 / 출석 기준 (비율%) ] [출석] 또는 [N분 N초 필요] [N일 … 남음]
  function decorateVideo(li, v, p, now) {
    const required = v.lengthSec ? Math.floor(v.lengthSec * ATTEND_RATIO) : null;
    const learned = p?.learnedSec || 0;
    const from = v.from, to = v.to;
    const open = (!from || from <= now) && (!to || to >= now);
    const state = p?.attended ? "ok" : to && to < now ? "bad" : from && from > now ? "wait" : "live";
    const color = state === "ok" ? "hsup-ok" : state === "bad" ? "hsup-gray" : state === "wait" ? "hsup-gray" : to ? `hsup-r${tier(to)}` : "hsup-r5";

    if (!required) {
      const label = state === "ok" ? "출석" : state === "bad" ? "결석" : state === "wait" ? "열리기 전" : learned > 0 ? "수강 중" : "미시청";
      placePill(li, tag(state === "ok" ? "hsup-ok" : state === "bad" ? "hsup-bad" : state === "wait" ? "hsup-wait" : color, label));
      li.querySelector(".hsup-tag")?.classList.add("hsup-pill");
      return;
    }
    const row = mk("div", "hsup-row");
    const pct = Math.round((learned / required) * 1000) / 10;
    const b = bar(learned / required, color, `${clock(learned)} / ${clock(required)} (${pct}%)`, state === "live");
    b.title = `출석 기준: 영상 길이(${clock(v.lengthSec)})의 90%`;
    row.appendChild(b);

    if (state === "ok") row.appendChild(tag("hsup-ok", "출석"));
    else if (state === "bad") row.appendChild(tag("hsup-bad", "결석"));
    else if (state === "wait") row.appendChild(tag("hsup-wait", from ? `${from.getMonth() + 1}/${from.getDate()}(${DAY[from.getDay()]}) 열림` : "열리기 전"));
    else if (open) {
      const need = required - learned;
      if (to && need > (to - now) / 1000) row.appendChild(tag("hsup-r1", "🚨 지금부터 들어도 출석 시간을 채우기 어려워요"));
      else if (need > 0) row.appendChild(tag(color, `${dhms(need)} 필요`));
      if (to) row.appendChild(countdown(to.getTime()));
    }
    placeRow(li, row);
  }

  // ---------- 과제 · 퀴즈 ----------
  // 제목 옆 한 줄: [제출 완료] [제출 10/10(토) 17:04] [마감 …]  /  [미제출] [마감 …] [N일 … 남음]  (마감 뒤 제출이면 [늦은 제출 …])
  function decorateTask(li, { done, doneLabel, todoLabel, due, doneAt }, now) {
    const past = due && due < now;
    const row = mk("span", "hsup-inline");
    if (done) row.appendChild(tag("hsup-ok", doneLabel));
    else if (past) row.appendChild(tag("hsup-bad", `${todoLabel} · 마감 지남`));
    else row.appendChild(tag(due ? `hsup-r${tier(due)}` : "hsup-wait", todoLabel));
    if (doneAt) {
      const late = due && doneAt > due;
      row.appendChild(tag(late ? "hsup-late" : "hsup-ok hsup-at", `${late ? "늦은 제출" : "제출"} ${dateLabel(doneAt)}`));
    }
    if (due) row.appendChild(tag("hsup-due", `마감 ${dateLabel(due)}`));
    if (!done && due && !past) row.appendChild(countdown(due.getTime()));
    placePill(li, row);
  }

  // ---------- 불러와서 붙이기 ----------
  const getDoc = async (path) => {
    const res = await fetch(path, { credentials: "include", cache: "no-store" });
    if (!res.ok) throw new Error(`요청 실패 (${res.status})`);
    return new DOMParser().parseFromString(await res.text(), "text/html");
  };
  const cmidOf = (url) => {
    try {
      return new URL(url, location.origin).searchParams.get("id");
    } catch {
      return null;
    }
  };
  // 과제 화면에서 "최종 수정 일시" 줄만 읽는다 (제출 시각)
  function readSubmittedAt(doc, parseDate) {
    for (const tr of doc.querySelectorAll("table tr")) {
      const th = tr.querySelector("th, td.cell.c0");
      if (th && th.textContent.replace(/\s+/g, " ").trim() === "최종 수정 일시") {
        return parseDate(tr.querySelector("td:last-child")?.textContent || "");
      }
    }
    return null;
  }

  async function decorate() {
    const [ec, lim] = await Promise.all([import(chrome.runtime.getURL("adapters/eclass.js")), import(chrome.runtime.getURL("core/limit.js"))]);
    const now = new Date();
    const [progDoc, assignDoc, quizDoc] = await Promise.all([
      getDoc(`/report/ubcompletion/progress.php?id=${courseId}`).catch(() => null),
      getDoc(`/mod/assign/index.php?id=${courseId}`).catch(() => null),
      getDoc(`/mod/quiz/index.php?id=${courseId}`).catch(() => null),
    ]);
    injectStyle();

    // 강의 영상
    const progress = progDoc ? ec.parseProgress(progDoc) : new Map();
    const videos = new Map(ec.parseVideos(document).map((v) => [v.cmid, v]));
    for (const li of document.querySelectorAll("li.activity.modtype_vod")) {
      const v = videos.get(li.id.replace("module-", ""));
      if (!v || li.dataset.hsup) continue;
      li.dataset.hsup = "1";
      decorateVideo(li, v, progress.get(ec.norm(v.name)), now);
    }

    // 과제: 목록 표로 제출 여부·마감, 낸 과제만 과제 화면에서 제출 시각
    const assigns = assignDoc ? ec.parseAssignments(assignDoc) : [];
    const submittedAt = new Map();
    await lim.runLimited(
      assigns
        .filter((a) => a.submitted)
        .map((a) => async () => submittedAt.set(cmidOf(a.url), readSubmittedAt(await getDoc(new URL(a.url).pathname + new URL(a.url).search), ec.parseDate))),
      2
    );
    const assignBy = new Map(assigns.map((a) => [cmidOf(a.url), a]));
    for (const li of document.querySelectorAll("li.activity.modtype_assign")) {
      const a = assignBy.get(li.id.replace("module-", ""));
      if (!a || li.dataset.hsup) continue;
      li.dataset.hsup = "1";
      decorateTask(li, { done: a.submitted, doneLabel: "제출 완료", todoLabel: "미제출", due: a.due, doneAt: submittedAt.get(cmidOf(a.url)) }, now);
    }

    // 퀴즈: 목록 표로 마감, 각 퀴즈 화면의 "진행 상황" 칸으로 응시 여부
    const quizzes = quizDoc ? ec.parseQuizIndex(quizDoc) : [];
    const done = await lim.runLimited(quizzes.map((q) => async () => ec.parseQuizDone(await getDoc(new URL(q.url).pathname + new URL(q.url).search))), 2);
    const quizBy = new Map(quizzes.map((q, i) => [q.cmid, { ...q, done: done[i].ok && done[i].value }]));
    for (const li of document.querySelectorAll("li.activity.modtype_quiz")) {
      const q = quizBy.get(li.id.replace("module-", ""));
      if (!q || li.dataset.hsup) continue;
      li.dataset.hsup = "1";
      decorateTask(li, { done: q.done, doneLabel: "응시 완료", todoLabel: "미응시", due: q.due }, now);
    }
  }

  // ---------- 패널에서 넘어온 강의로 스크롤 ----------
  // 맨 위 "이번 주" 칸에도 같은 강의가 한 번 더 있어서(같은 id) 주차 목록(.total_sections) 쪽을 고른다
  function jump() {
    if (!jumpId) return;
    const all = [...document.querySelectorAll(`li[id="module-${jumpId}"]`)];
    const target = all.find((li) => li.closest(".total_sections")) || all[all.length - 1];
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("hsup-flash");
    setTimeout(() => target.classList.remove("hsup-flash"), 2200);
  }

  // 꾸미기가 끝난 뒤 스크롤해야 위치가 밀리지 않는다 (오래 걸리면 4초 뒤 그냥 스크롤)
  injectStyle();
  const timeout = new Promise((r) => setTimeout(r, 4000));
  Promise.race([
    decorate().catch((err) => {
      const dead = /Extension context invalidated/i.test(String(err?.message || err));
      if (!dead) console.warn("[HSU PLUS] 강의실 표시 실패:", err);
    }),
    timeout,
  ]).then(jump);
})();
