// 비교과(hsportal.hansung.ac.kr, 스마트자기관리시스템) 어댑터
// 다른 사이트라 화면 쪽에서 직접 요청할 수 없다 → 페이지 글은 백그라운드가 받아 주고(getText),
// 해석(DOMParser)은 여기서 한다.
// 비교과 목록·상세는 로그인 없이도 보인다 (2026-10-10 확인).

import { makeItem, SOURCE, TYPE, STATUS } from "../core/model.js";
import { ParseError } from "../core/errors.js";

const BASE = "https://hsportal.hansung.ac.kr";

const text = (el) => (el ? el.textContent.normalize("NFC").replace(/\s+/g, " ").trim() : "");

/** <small class="date_layer"> 안의 "신청:" / "운영:" 줄에서 <time datetime> 두 개를 꺼낸다 */
function readRange(card, label) {
  const layer = [...card.querySelectorAll("small.date_layer")].find((s) => text(s.querySelector(".date_title")).startsWith(label));
  if (!layer) return { from: null, to: null };
  const times = [...layer.querySelectorAll("time")].map((t) => t.getAttribute("datetime")).filter(Boolean);
  return { from: times[0] || null, to: times[1] || times[0] || null };
}

/** 비교과 목록 페이지 HTML → 공통 형식 항목들 */
export function parseProgramList(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const cards = [...doc.querySelectorAll("ul.columns-4 > li")];
  if (!cards.length && !/총\s*0\s*개/.test(doc.body?.textContent || "")) {
    // 카드도 없고 "총 0개"도 아니면 구조가 바뀐 것
    if (!doc.querySelector("main")) throw new ParseError("비교과 목록 구조를 읽지 못했습니다");
  }
  return cards
    .map((li) => {
      const a = li.querySelector('a[href*="/program/all/view/"]');
      if (!a) return null;
      const href = a.getAttribute("href");
      const id = /view\/(\d+)/.exec(href)?.[1];
      const label = li.querySelector("label");
      const point = Number((label ? [...label.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("") : "").replace(/\D/g, "")) || null;
      const progress = text(li.querySelector("span.progress")); // "43/50명" 또는 "1/무제한"
      const pm = /(\d+)\s*\/\s*(\d+|무제한)/.exec(progress);
      const apply = readRange(li, "신청");
      const run = readRange(li, "운영");
      return makeItem({
        id: `hsportal:program:${id}`,
        source: SOURCE.HSPORTAL,
        type: TYPE.PROGRAM,
        title: text(li.querySelector("b.title")),
        start: run.from,
        end: run.to,
        due: apply.to, // 신청 마감
        status: STATUS.TODO,
        url: new URL(href, BASE).href,
        meta: {
          programId: id,
          department: text(li.querySelector("span.institution")),
          point,
          dday: text(li.querySelector("label b")),
          applied: pm ? Number(pm[1]) : null,
          capacity: pm ? (pm[2] === "무제한" ? null : Number(pm[2])) : null,
          full: pm && pm[2] !== "무제한" ? Number(pm[1]) >= Number(pm[2]) : false,
          kind: text(li.querySelector("span.type")), // 개인/팀
          applyFrom: apply.from,
          state: li.firstElementChild?.className || "", // APPROACH_CLOSING, SCHEDULED, CLOSED …
        },
      });
    })
    .filter(Boolean);
}

const PAGE_SIZE = 12; // 목록은 한 쪽에 12개씩
const MAX_PAGES = 8; // 학교 서버 부담을 생각해 최대 8쪽(96개)까지만

/** 목록 HTML의 "총 N개" → N (못 찾으면 null). 실제 HTML은 "총 <b>42</b>개" 형태라 태그를 지우고 찾는다 */
export function parseTotal(html) {
  const m = /총\s*([\d,]+)\s*개/.exec(String(html).replace(/<[^>]+>/g, ""));
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

/** 조건(query)에 맞는 목록을 여러 쪽 이어서 받는다. 2쪽부터 /ko/program/all/list/0/{쪽}?… (2026-10-10 확인) */
async function fetchAllPages(getText, query) {
  const first = await getText(`${BASE}/ko/program/all?${query}`);
  const items = parseProgramList(first);
  const total = parseTotal(first);
  const pages = total ? Math.min(Math.ceil(total / PAGE_SIZE), MAX_PAGES) : 1;
  for (let p = 2; p <= pages; p++) {
    items.push(...parseProgramList(await getText(`${BASE}/ko/program/all/list/0/${p}?${query}`)));
  }
  const seen = new Set();
  return items.filter((it) => !seen.has(it.id) && seen.add(it.id));
}

/**
 * 지금 신청을 받는(접수중) 비교과 전체, 신청 마감 순.
 * 이번 주·다음 주·1주일 안 마감 등은 화면에서 이 목록을 걸러 쓴다.
 * @param {(url: string) => Promise<string>} getText 백그라운드를 통해 페이지 글을 받아 오는 함수
 */
export async function fetchOpenPrograms(getText, now = new Date()) {
  const items = await fetchAllPages(getText, "status=open");
  return items
    .filter((it) => !it.due || new Date(it.due) >= now) // 이미 마감된 것 제외
    .sort((a, b) => new Date(a.due || 8.64e15) - new Date(b.due || 8.64e15));
}
