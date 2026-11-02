// 내 비교과: 같은 프로그램의 회차를 따로 신청해 목록에 여러 줄일 때 (node test/merge.test.mjs)
// 11/2 사용자 사례: 인문학 살롱 특강 4개를 각각 신청 → 목록 4줄, 프로그램 화면은 4줄 모두 내 회차 4개 → 캘린더에 목요일마다 4개씩
const { mergeSameProgram } = await import("../adapters/hsportal.js");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => (cond ? pass++ : fail++, console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`));
const day = (d) => ({ name: `특강 ${d}`, start: `2026-11-${d}T15:00:00+09:00`, end: `2026-11-${d}T17:00:00+09:00`, kind: "exact" });
const four = ["05", "12", "19", "26"].map(day);

const a = mergeSameProgram([1, 2, 3, 4].map(() => ({ id: "777", title: "기초학문 가치확산", phase: "wait", sessions: four.map((s) => ({ ...s })) })));
check("같은 프로그램 4줄 → 1개", a.length === 1);
check("회차는 4개 그대로 (16개 아님)", a[0].sessions.length === 4, a[0].sessions.map((s) => s.start.slice(5, 10)).join(","));

const b = mergeSameProgram([
  { id: "1", phase: "wait", sessions: [four[1]] },
  { id: "1", phase: "progress", sessions: [four[0]] },
  { id: "2", phase: "wait", sessions: [four[2]] },
]);
check("다른 프로그램은 따로", b.length === 2);
check("줄마다 다른 회차는 합치고 날짜순", b[0].sessions.map((s) => s.start.slice(8, 10)).join(",") === "05,12");
check("한 줄이라도 진행 중이면 진행 중", b[0].phase === "progress");
check("목록 단계(회차 읽기 전)도 합침", mergeSameProgram([{ id: "9", phase: "wait" }, { id: "9", phase: "wait" }]).length === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
