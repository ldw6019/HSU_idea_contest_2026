// e클래스(learn.hansung.ac.kr) 어댑터
// e클래스 화면 안에서 실행된다 (같은 사이트라 직접 요청·해석 가능, DOMParser 사용).
// - 수강 과목: 메인 화면의 강좌 목록 (교과만)
// - 강의 영상: 과목 페이지의 동영상 항목 (수강 기간, 길이) + 온라인출석부 (학습 시간, 출석)
// - 과제: 과목별 과제 목록 (종료 일시, 제출 여부). 성적 칸은 읽지 않는다.
// - 온라인출석부 위쪽의 개인정보 표는 읽지 않고, 진도 표(user_progress_table)만 읽는다.

import { makeItem, SOURCE, TYPE, STATUS } from "../core/model.js";
import { ParseError } from "../core/errors.js";
import { runLimited } from "../core/limit.js";

const BASE = "https://learn.hansung.ac.kr";

// 시연 모드(10/21): 학교 대신 가짜 HTML을 주는 함수를 끼울 수 있게
let demoHtml = null;
export function useDemo(fn) {
  demoHtml = fn;
}

async function getDoc(path) {
  if (demoHtml) return new DOMParser().parseFromString(demoHtml(BASE + path), "text/html");
  const res = await fetch(BASE + path, { credentials: "include", cache: "no-store" });
  if (!res.ok) throw new Error(`e클래스 요청 실패 (${res.status})`);
  return new DOMParser().parseFromString(await res.text(), "text/html");
}

// 일부 제목은 한글이 자모 분리(NFD) 상태로 들어 있어서 NFC로 합쳐 둔다.
const clean = (s) => String(s || "").normalize("NFC").replace(/\s+/g, " ").trim();
const text = (el) => (el ? clean(el.textContent) : "");
// 요소 안의 글자 노드만 (NEW 배지 같은 자식 요소 글자는 뺀다)
const ownText = (el) => (el ? clean([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("")) : "");

/** "2026-10-02 00:00:00" / "2026-09-13 00:00" → Date (내 컴퓨터 시간대 기준) */
export function parseDate(s) {
  const m = /(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s || "");
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
}

/** "01:00:54" / "43:13" → 초 */
export function parseDuration(s) {
  const m = /(?:(\d+):)?(\d{1,2}):(\d{2})/.exec(s || "");
  if (!m) return null;
  return (+(m[1] || 0)) * 3600 + +m[2] * 60 + +m[3];
}

/** 제목 비교용: 공백·기호 제거 */
export const norm = (s) => String(s || "").replace(/[\s ·.\-_()[\]]/g, "").toLowerCase();

// ---------------------------------------------------------------- 수강 과목

/** 메인 화면 문서에서 교과 과목 목록을 읽는다 */
export function parseCourses(doc) {
  return [...doc.querySelectorAll("ul.my-course-lists > li")]
    .map((li) => {
      const a = li.querySelector("a.course_link");
      const label = text(li.querySelector(".course-label .label-course"));
      const id = a ? new URL(a.getAttribute("href"), BASE).searchParams.get("id") : null;
      return { id, name: ownText(li.querySelector(".course-title h3")), professor: text(li.querySelector(".course-title .prof")), label };
    })
    .filter((c) => c.id && c.label.startsWith("교과"));
}

// ---------------------------------------------------------------- 강의 영상

/** 과목 페이지에서 동영상 항목 (이름, 수강 기간, 길이) */
export function parseVideos(doc) {
  // 과목 페이지 맨 위에 "이번 주" 칸(.course_box_current)이 같은 활동을 한 번 더 보여준다 → 같은 id는 한 번만
  const seen = new Set();
  const lis = [...doc.querySelectorAll("li.activity.modtype_vod")].filter((li) => !seen.has(li.id) && seen.add(li.id));
  return lis.map((li) => {
    const nameEl = li.querySelector(".instancename");
    const name = ownText(nameEl);
    const period = text(li.querySelector(".displayoptions .text-ubstrap"));
    const [from, to] = period.split("~").map((s) => parseDate(s));
    const a = li.querySelector(".activityinstance a");
    return {
      cmid: (li.id || "").replace("module-", ""),
      name,
      from: from || null,
      to: to || null,
      lengthSec: parseDuration(text(li.querySelector(".displayoptions .text-info"))),
      url: a ? new URL(a.getAttribute("href"), BASE).href : null,
    };
  });
}

/** 온라인출석부 진도 표: 영상 제목 → { learnedSec, attended } */
export function parseProgress(doc) {
  const table = doc.querySelector("table.user_progress_table");
  const map = new Map();
  if (!table) return map;
  for (const tr of table.querySelectorAll("tbody tr")) {
    const cells = [...tr.children];
    const ti = cells.findIndex((td) => td.classList.contains("text-left"));
    if (ti < 0) continue;
    const title = text(cells[ti]);
    const timeCell = cells[ti + 1];
    const firstText = timeCell ? [...timeCell.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim()) : null;
    const learnedSec = firstText ? parseDuration(firstText.textContent) : null;
    const attended = text(cells[ti + 2]) === "O";
    map.set(norm(title), { learnedSec: learnedSec || 0, attended });
  }
  return map;
}

// ---------------------------------------------------------------- 과제

/** 과제 목록 표: 과제명, 종료 일시, 제출 여부 (성적 칸은 읽지 않음) */
export function parseAssignments(doc) {
  const table = doc.querySelector("table.generaltable");
  if (!table) return [];
  return [...table.querySelectorAll("tbody tr")]
    .filter((tr) => tr.querySelector("td.c1 a"))
    .map((tr) => {
      const a = tr.querySelector("td.c1 a");
      const statusText = text(tr.querySelector("td.c3"));
      return {
        name: text(a),
        url: new URL(a.getAttribute("href"), `${BASE}/mod/assign/`).href, // 짧은 주소(view.php?id=)도 올바르게
        due: parseDate(text(tr.querySelector("td.c2"))),
        submitted: /제출\s*완료/.test(statusText),
        statusText,
      };
    });
}

// ---------------------------------------------------------------- 합치기

/**
 * 퀴즈 목록 표 (/mod/quiz/index.php?id=과목)
 * 칸: c0 주차, c1 제목(링크), c2 종료 일시, c3 성적 → 성적 칸(c3)은 읽지 않는다.
 * 제출 여부 칸은 없어서, 아직 안 닫힌 퀴즈만 각 퀴즈 화면에서 따로 확인한다.
 */
export function parseQuizIndex(doc) {
  const table = doc.querySelector("table.generaltable");
  if (!table) return [];
  return [...table.querySelectorAll("tbody tr")]
    .filter((tr) => tr.querySelector("td.c1 a"))
    .map((tr) => {
      const a = tr.querySelector("td.c1 a");
      const url = new URL(a.getAttribute("href"), `${BASE}/mod/quiz/`).href;
      return { cmid: new URL(url).searchParams.get("id"), name: text(a), url, due: parseDate(text(tr.querySelector("td.c2"))) };
    });
}

/**
 * 퀴즈 화면의 응시 요약 표(table.quizattemptsummary)에서 "진행 상황" 칸만 읽는다 (점수·성적 칸은 읽지 않음).
 * "종료됨"인 응시가 하나라도 있으면 푼 것으로 본다. 표가 없으면 아직 응시 안 함.
 */
export function parseQuizDone(doc) {
  const table = doc.querySelector("table.quizattemptsummary");
  if (!table) return false;
  const heads = [...table.querySelectorAll("thead th")].map((th) => text(th));
  const col = heads.findIndex((h) => /진행|상태|state/i.test(h));
  if (col < 0) return false;
  return [...table.querySelectorAll("tbody tr")].some((tr) => /종료|finished/i.test(text(tr.children[col])));
}

function videoStatus(v, prog, now) {
  if (prog?.attended) return STATUS.DONE;
  if (v.to && v.to < now) return STATUS.MISSED;
  return STATUS.TODO;
}

/** 한 과목의 영상·과제를 공통 형식으로 */
export async function fetchCourseItems(course, now = new Date()) {
  const [viewDoc, assignDoc, progressDoc, quizDoc] = await Promise.all([
    getDoc(`/course/view.php?id=${course.id}`),
    getDoc(`/mod/assign/index.php?id=${course.id}`),
    getDoc(`/report/ubcompletion/progress.php?id=${course.id}`).catch(() => null), // 영상이 없는 과목은 없을 수 있음
    getDoc(`/mod/quiz/index.php?id=${course.id}`).catch(() => null), // 퀴즈가 없는 과목이 많다
  ]);

  const progress = progressDoc ? parseProgress(progressDoc) : new Map();
  const videos = parseVideos(viewDoc).map((v) => {
    const p = progress.get(norm(v.name));
    const ratio = v.lengthSec && p ? Math.round((p.learnedSec / v.lengthSec) * 1000) / 10 : null;
    return makeItem({
      id: `eclass:video:${v.cmid}`,
      source: SOURCE.ECLASS,
      type: TYPE.VIDEO,
      title: v.name,
      course: course.name,
      start: v.from,
      due: v.to,
      status: videoStatus(v, p, now),
      url: v.url,
      // courseId·cmid: 패널에서 누르면 강의실(과목 페이지)의 그 강의 위치로 보내기 위해
      meta: { lengthSec: v.lengthSec, learnedSec: p?.learnedSec ?? null, percent: ratio, attended: !!p?.attended, courseId: course.id, cmid: v.cmid },
    });
  });

  const assignments = parseAssignments(assignDoc).map((a) =>
    makeItem({
      id: `eclass:assign:${a.url}`,
      source: SOURCE.ECLASS,
      type: TYPE.ASSIGNMENT,
      title: a.name,
      course: course.name,
      due: a.due,
      status: a.submitted ? STATUS.DONE : a.due && a.due < now ? STATUS.MISSED : STATUS.TODO,
      url: a.url,
      meta: { statusText: a.statusText },
    })
  );

  // 퀴즈: 이미 닫힌 것은 할 수 있는 게 없으니 빼고, 아직 열려 있는 것만 각 화면에서 응시 여부 확인
  const openQuizzes = (quizDoc ? parseQuizIndex(quizDoc) : []).filter((q) => !q.due || q.due >= now);
  const quizDone = await runLimited(openQuizzes.map((q) => async () => parseQuizDone(await getDoc(new URL(q.url).pathname + new URL(q.url).search))), 2);
  const quizzes = openQuizzes.map((q, i) =>
    makeItem({
      id: `eclass:quiz:${q.cmid}`,
      source: SOURCE.ECLASS,
      type: TYPE.QUIZ,
      title: q.name,
      course: course.name,
      due: q.due,
      // 확인에 실패하면 "안 함"으로 둔다 (놓치는 것보다 한 번 더 보이는 편이 낫다)
      status: quizDone[i].ok && quizDone[i].value ? STATUS.DONE : STATUS.TODO,
      url: q.url,
    })
  );

  return [...videos, ...assignments, ...quizzes];
}

/** 모든 교과 과목의 과목 정보 + 영상·과제. 과목별 실패는 건너뛰고 기록만 한다. */
export async function fetchEclass(mainDoc = document) {
  const courses = parseCourses(mainDoc);
  if (!courses.length) {
    // 강좌 목록 칸은 있는데 교과 과목이 없으면 방학·학기 초 → 오류가 아니라 "과목 없음" (10/20)
    if (mainDoc.querySelector("ul.my-course-lists")) return { courses: [], items: [], failed: [], noCourses: true };
    throw new ParseError("e클래스 강좌 목록을 찾지 못했습니다");
  }
  const results = await runLimited(courses.map((c) => () => fetchCourseItems(c)), 3);
  const items = [];
  const failed = [];
  results.forEach((r, i) => (r.ok ? items.push(...r.value) : failed.push({ course: courses[i].name, message: String(r.error?.message || r.error) })));
  return { courses, items, failed };
}
