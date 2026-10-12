// HSU PLUS — 과목 페이지(강의실, /course/view.php) 꾸미기
// e클래스 기본 화면은 강의를 다 들었는지, 과제를 냈는지 하나씩 눌러 봐야 안다.
// 그래서 강의실 목록에 바로 보이게 덧붙인다 (기존 익텐 hsu-ecx의 기능을 참고해 우리 디자인으로).
// 색: 초록 = 완료(출석·제출·응시)에만. 나머지는 패널과 같은 마감 위험도 색
//  - 강의 영상: 제목 옆 상태(출석 / 결석 / 미시청·수강 중 / 열리기 전) + 아래 줄에 학습 진도 막대
//               (학습시간 / 출석 기준 시간 = 영상 길이의 90%), 아직 기간 중이면 "더 필요한 시간"·"마감까지"
//  - 과제: 제목 옆 제출 완료 / 미제출 + 제출 시각·마감
//  - 퀴즈: 제목 옆 응시 완료 / 미응시 + 마감
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
  const URGENT_DAYS = 2;

  // ---------- 시간·날짜 표시 ----------
  const pad = (n) => String(n).padStart(2, "0");
  const DAY = ["일", "월", "화", "수", "목", "금", "토"];
  const clock = (sec) => {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  };
  const human = (sec) => {
    sec = Math.max(0, Math.round(sec));
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    if (d) return `${d}일 ${h}시간`;
    if (h) return `${h}시간 ${m}분`;
    return `${Math.max(m, 1)}분`;
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
  const dLabel = (d) => (daysLeft(d) <= 0 ? "오늘" : `D-${daysLeft(d)}`);

  // ---------- 화면 조각 ----------
  const mk = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  function injectStyle() {
    if (document.getElementById("hsup-style")) return;
    const st = mk("style");
    st.id = "hsup-style";
    st.textContent = `
      .hsup-pill { display: inline-flex; align-items: center; gap: 4px; margin: 0 8px 0 6px; padding: 1px 9px;
        border-radius: 999px; font-size: 12px; font-weight: 700; line-height: 1.7; vertical-align: middle; white-space: nowrap; }
      .hsup-pill::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: .85; }
      /* 초록은 "완료"(출석·제출 완료·응시 완료)에만 쓴다. 그래서 다른 곳에서는 초록을 쓰지 않음 */
      .hsup-ok { background: #e3f6ea; color: #18794e; }
      .hsup-bad { background: #fdecec; color: #c62828; }
      .hsup-wait { background: #eef1f5; color: #5b6577; }
      .hsup-r1 { background: #fde7e7; color: #c62828; } .hsup-r2 { background: #ffeadb; color: #c2410c; }
      .hsup-r3 { background: #fff1d6; color: #a65f00; } .hsup-r4 { background: #fdf5d3; color: #806300; }
      .hsup-r5 { background: #eef2f7; color: #4f5d73; }
      .hsup-row { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; margin: 6px 0 4px 42px; }
      .hsup-track { position: relative; width: 320px; max-width: 48%; height: 8px; border-radius: 999px; background: #e3e7ee; overflow: hidden; }
      .hsup-fill { height: 100%; border-radius: inherit; background: #22a55a; }
      .hsup-fill.hsup-f-bad { background: #b9c0cc; }
      .hsup-fill.hsup-f-r1 { background: #e5484d; } .hsup-fill.hsup-f-r2 { background: #f76b15; }
      .hsup-fill.hsup-f-r3 { background: #f5a623; } .hsup-fill.hsup-f-r4 { background: #e6c02a; }
      .hsup-fill.hsup-f-r5 { background: #8fa3bf; }
      .hsup-num { font-size: 12.5px; font-weight: 600; color: #384152; font-variant-numeric: tabular-nums; }
      .hsup-chip { font-size: 12px; font-weight: 600; padding: 1px 8px; border-radius: 6px; line-height: 1.7; white-space: nowrap; }
      .hsup-chip.hsup-line { background: transparent; box-shadow: inset 0 0 0 1px currentColor; }
      .hsup-flash { transition: background .6s, outline-color .6s; outline: 3px solid #0b4ea2 !important; outline-offset: 4px; background: #eef4ff !important; }
    `;
    document.head.appendChild(st);
  }
  const pill = (cls, text) => mk("span", `hsup-pill ${cls}`, text);
  const chip = (cls, text) => mk("span", `hsup-chip ${cls}`, text);
  function placePill(li, node) {
    const a = li.querySelector(".activityinstance > a");
    if (a) a.after(node);
  }
  function placeRow(li, row) {
    const inst = li.querySelector(".activityinstance");
    if (inst) inst.after(row);
  }

  // ---------- 강의 영상 ----------
  function decorateVideo(li, v, p, now) {
    const required = v.lengthSec ? Math.floor(v.lengthSec * ATTEND_RATIO) : null;
    const learned = p?.learnedSec || 0;
    const from = v.from, to = v.to;
    let status, fillCls = "";
    if (p?.attended) status = pill("hsup-ok", "출석");
    else if (to && to < now) {
      status = pill("hsup-bad", "결석");
      fillCls = "hsup-f-bad";
    } else if (from && from > now) status = pill("hsup-wait", "열리기 전");
    else if (to) {
      const t = tier(to);
      status = pill(`hsup-r${t}`, `${learned > 0 ? "수강 중" : "미시청"} · ${dLabel(to)}`);
      fillCls = `hsup-f-r${t}`;
    } else status = pill("hsup-wait", learned > 0 ? "수강 중" : "미시청");
    placePill(li, status);

    if (!required) return;
    const row = mk("div", "hsup-row");
    const track = mk("div", "hsup-track");
    const fill = mk("div", `hsup-fill ${fillCls}`);
    fill.style.width = `${Math.min(100, (learned / required) * 100)}%`;
    track.appendChild(fill);
    const pct = Math.round((learned / required) * 1000) / 10;
    row.append(track, mk("span", "hsup-num", `${clock(learned)} / ${clock(required)} · ${pct}%`));
    track.title = `출석 기준: 영상 길이(${clock(v.lengthSec)})의 90%`;

    // 기간 중이고 아직 출석 전이면: 더 들어야 할 시간과 마감까지 남은 시간
    if (!p?.attended && to && to >= now && (!from || from <= now)) {
      const need = required - learned;
      const left = (to - now) / 1000;
      if (need > 0) {
        if (need > left) row.appendChild(chip("hsup-r1", "🚨 지금부터 들어도 출석 시간을 채우기 어려워요"));
        else row.appendChild(chip(`hsup-r${tier(to)}`, `${human(need)} 더 들으면 출석`));
      }
      row.appendChild(chip("hsup-r5 hsup-line", `마감까지 ${human(left)}`));
    }
    placeRow(li, row);
  }

  // ---------- 과제 · 퀴즈 ----------
  function decorateTask(li, { done, doneLabel, todoLabel, due, doneAt }, now) {
    const past = due && due < now;
    if (done) placePill(li, pill("hsup-ok", doneLabel));
    else if (past) placePill(li, pill("hsup-bad", `${todoLabel} · 마감 지남`));
    else if (due) placePill(li, pill(`hsup-r${tier(due)}`, `${todoLabel} · ${dLabel(due)}`));
    else placePill(li, pill("hsup-wait", todoLabel));
    const row = mk("div", "hsup-row");
    if (doneAt) row.appendChild(chip("hsup-ok", `제출 ${dateLabel(doneAt)}`));
    if (due) row.appendChild(chip("hsup-wait", `마감 ${dateLabel(due)}`));
    if (row.childNodes.length) placeRow(li, row);
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
