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

async function getDoc(path) {
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
const norm = (s) => String(s || "").replace(/[\s ·.\-_()[\]]/g, "").toLowerCase();

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
  return [...doc.querySelectorAll("li.activity.modtype_vod")].map((li) => {
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
        url: new URL(a.getAttribute("href"), BASE).href,
        due: parseDate(text(tr.querySelector("td.c2"))),
        submitted: /제출\s*완료/.test(statusText),
        statusText,
      };
    });
}

// ---------------------------------------------------------------- 합치기

function videoStatus(v, prog, now) {
  if (prog?.attended) return STATUS.DONE;
  if (v.to && v.to < now) return STATUS.MISSED;
  return STATUS.TODO;
}

/** 한 과목의 영상·과제를 공통 형식으로 */
export async function fetchCourseItems(course, now = new Date()) {
  const [viewDoc, assignDoc, progressDoc] = await Promise.all([
    getDoc(`/course/view.php?id=${course.id}`),
    getDoc(`/mod/assign/index.php?id=${course.id}`),
    getDoc(`/report/ubcompletion/progress.php?id=${course.id}`).catch(() => null), // 영상이 없는 과목은 없을 수 있음
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
      meta: { lengthSec: v.lengthSec, learnedSec: p?.learnedSec ?? null, percent: ratio, attended: !!p?.attended },
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

  return [...videos, ...assignments];
}

/** 모든 교과 과목의 과목 정보 + 영상·과제. 과목별 실패는 건너뛰고 기록만 한다. */
export async function fetchEclass(mainDoc = document) {
  const courses = parseCourses(mainDoc);
  if (!courses.length) throw new ParseError("e클래스 강좌 목록을 찾지 못했습니다");
  const results = await runLimited(courses.map((c) => () => fetchCourseItems(c)), 3);
  const items = [];
  const failed = [];
  results.forEach((r, i) => (r.ok ? items.push(...r.value) : failed.push({ course: courses[i].name, message: String(r.error?.message || r.error) })));
  return { courses, items, failed };
}
