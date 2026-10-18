// core/points.js 시험 (node test/points.test.mjs)
const { semesterOf, prevSemester, pointSummary } = await import("../core/points.js");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => (cond ? pass++ : fail++, console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`));
const at = (s) => new Date(`${s}T12:00:00`);

check("10월 = 2학기", semesterOf(at("2026-10-19")).label === "2026-2학기");
check("1월 = 전년도 2학기", semesterOf(at("2027-01-10")).label === "2026-2학기");
check("3월 = 1학기", semesterOf(at("2026-03-02")).label === "2026-1학기");
check("2학기의 전 학기 = 같은 해 1학기", prevSemester(semesterOf(at("2026-10-19"))).label === "2026-1학기");
check("1학기의 전 학기 = 전년도 2학기", prevSemester(semesterOf(at("2026-04-01"))).label === "2025-2학기");

// 사용자 예시: 3-1에 400 → 3-2 시작에 200 이월. 3-2에 100 더 → 3-2는 200, 100 이월
let r = pointSummary({ carriedIn: 200, semester: 100, graduation: 600, history: [{ date: "2026-09-10", change: 100 }] }, at("2026-10-19"));
check("이월 200 + 이번 100 → 이번 학기 인정 200", r.recognized === 200 && r.fromCarry === 200 && r.fromEarned === 0);
check("→ 100점 이월, 소멸 없음", r.carryOut === 100 && r.lost === 0 && r.room === 0);
// 이월 50 + 이번 120 → 170 인정, 30 더 모으면 이번 학기
r = pointSummary({ carriedIn: 50, semester: 120, graduation: 400 }, at("2026-10-19"));
check("이월 50 + 이번 120 → 170, 30 남음", r.recognized === 170 && r.room === 30 && r.carryOut === 0);
// 한 학기 600 모음(이월 0) → 200 인정, 200 이월, 200 소멸
r = pointSummary({ carriedIn: 0, semester: 200, graduation: 900, history: [{ date: "2026-09-02", change: 350 }, { date: "2026-10-01", change: 250 }, { date: "2026-08-30", change: 40 }] }, at("2026-10-19"));
check("학교 칸이 잘려 있어도 내역 합계로 실제 600", r.earned === 600, String(r.earned));
check("600 → 인정 200, 이월 200, 소멸 200", r.recognized === 200 && r.carryOut === 200 && r.lost === 200);
check("지난 학기(1학기) 모은 점수 = 내역 합계", r.prevEarned === 40);
check("800 넘으면 졸업 요건 달성", r.done && r.toGraduate === 0);
check("최근 내역은 날짜 내림차순", r.recent[0].date === "2026-10-01");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
