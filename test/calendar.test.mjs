// core/calendar.js 시험 (node test/calendar.test.mjs, 한국 시간 기준)
process.env.TZ = "Asia/Seoul";
const { weeklySlots, clashes, weeklyClashes, googleLink, buildIcs, weeklyRule } = await import("../core/calendar.js");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => (cond ? pass++ : fail++, console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`));

// 시간표: 월 15:00~16:30 클라우드, 목 10:00~13:00 시스템
const slots = weeklySlots([
  { start: "2026-10-19T15:00:00+09:00", end: "2026-10-19T16:30:00+09:00", course: "클라우드 컴퓨팅(A)" },
  { start: "2026-10-22T10:00:00+09:00", end: "2026-10-22T13:00:00+09:00", course: "시스템 프로그래밍(7)" },
]);
check("다른 주 같은 요일·시각이면 겹침", clashes(slots, "2026-11-05T12:00:00+09:00", "2026-11-05T14:00:00+09:00")[0]?.name === "시스템 프로그래밍(7)");
check("끝과 시작이 딱 붙으면 안 겹침", clashes(slots, "2026-11-02T16:30:00+09:00", "2026-11-02T18:00:00+09:00").length === 0);
check("다른 요일이면 안 겹침", clashes(slots, "2026-11-04T10:00:00+09:00", "2026-11-04T13:00:00+09:00").length === 0);
check("여러 날 일정은 따지지 않음", clashes(slots, "2026-11-05T09:00:00+09:00", "2026-11-06T18:00:00+09:00").length === 0);
check("매주 목 10~13시 → 겹침", weeklyClashes(slots, 4, "10:00", "13:00").length === 1);
check("매주 수 10~13시 → 안 겹침", weeklyClashes(slots, 3, "10:00", "13:00").length === 0);

// 구글 캘린더 링크
const g = new URL(googleLink({ title: "현직자 특강", start: "2026-10-23T19:00:00+09:00", end: "2026-10-23T21:00:00+09:00", place: "온라인 (Zoom)" }));
check("구글: 시각 일정", g.searchParams.get("dates") === "20261023T190000/20261023T210000" && g.searchParams.get("ctz") === "Asia/Seoul" && g.searchParams.get("location") === "온라인 (Zoom)");
const g2 = new URL(googleLink({ title: "MT", start: new Date(2026, 9, 31), end: new Date(2026, 10, 1), allDay: true }));
check("구글: 종일 일정은 끝 다음 날까지", g2.searchParams.get("dates") === "20261031/20261102", g2.searchParams.get("dates"));

// .ics
const ics = buildIcs(
  [
    { uid: "a1", title: "집단상담, 화10시; 진로", start: "2026-11-03T10:00:00+09:00", end: "2026-11-03T13:00:00+09:00", rrule: weeklyRule(4), place: "미래관 B1" },
    { uid: "a2", title: "MT", start: new Date(2026, 9, 31), end: new Date(2026, 10, 1), allDay: true },
    { uid: "a3", title: "아주 긴 제목 ".repeat(12), start: "2026-11-05T09:00:00+09:00" },
  ],
  new Date("2026-10-19T00:00:00Z")
);
check(".ics: 줄바꿈 CRLF", ics.split("\r\n").length > 20 && !/[^\r]\n/.test(ics));
check(".ics: 일정 3개", (ics.match(/BEGIN:VEVENT/g) || []).length === 3);
check(".ics: 쉼표·세미콜론 이스케이프", ics.includes(String.raw`SUMMARY:집단상담\, 화10시\; 진로`));
check(".ics: 한국 시간", ics.includes("DTSTART;TZID=Asia/Seoul:20261103T100000") && ics.includes("RRULE:FREQ=WEEKLY;COUNT=4"));
check(".ics: 종일", ics.includes("DTSTART;VALUE=DATE:20261031") && ics.includes("DTEND;VALUE=DATE:20261102"));
const enc = new TextEncoder();
check(".ics: 75바이트 줄 접기", ics.split("\r\n").every((l) => enc.encode(l).length <= 75));
check(".ics: 끝 시각 없으면 1시간", ics.includes("DTEND;TZID=Asia/Seoul:20261105T100000"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
