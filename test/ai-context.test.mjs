// AI에 보내는 정보·추천 버튼 답 (11/7 검토 반영). 실행: node test/ai-context.test.mjs
import { buildContext, isCounselProgram, localAnswer } from "../core/ai.js";
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => (cond ? pass++ : fail++, console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`));
const now = new Date(2026, 10, 4, 12, 0); // 11/4(수)

// 1) 상담 프로그램 이름은 AI로 보내지 않고 일반 이름으로 (화면용 연결표에는 진짜 항목 그대로)
// 회차 시각은 실행하는 곳의 시간으로 만든다 (화면·AI 전송 글이 그 시간으로 나오므로). 11/7: "+09:00"으로 고정했더니 LA 시간대에서 11/5(목) 17:00으로 나와 실패했음
const local = (h) => new Date(2026, 10, 6, h, 0).toISOString(); // 11/6(금)
const prog = (id, title, category) => ({ id, title, category, phase: "wait", sessions: [{ kind: "exact", start: local(10), end: local(12) }] });
const myPrograms = {
  programs: [prog("1", "2학기 집단상담: 관계 회복", "상담·심리지원 특강"), prog("2", "현직자 특강: 백엔드 개발자의 하루", "진로·취업지원 특강"), prog("3", "마음건강 검사 해석", "기타"), prog("4", "진로 멘토링: 웹 서버 미니 프로젝트", "진로·취업지원 소모임·멘토")],
  surveys: [{ id: "9", title: "개인상담 만족도", category: "상담·심리지원" }, { id: "8", title: "가을 캠퍼스 플로깅", category: "비교과 봉사" }],
  points: { graduation: 600 },
};
const { context: c, refs } = buildContext({ myPrograms }, now);
const sent = JSON.stringify(c);
check("상담 프로그램 제목은 보내지 않음", !/집단상담|관계 회복|개인상담|마음건강/.test(sent), sent.slice(0, 200));
check("상담 → '상담 일정'", c.myPrograms[0].title === "상담 일정" && c.myPrograms[2].title === "상담 일정");
check("안 낸 설문 상담 → '상담 프로그램'", c.surveys[0].title === "상담 프로그램");
check("상담 아닌 것은 제목 그대로", c.myPrograms[1].title === "현직자 특강: 백엔드 개발자의 하루" && c.surveys[1].title === "가을 캠퍼스 플로깅");
check("멘토링·진로 프로그램은 상담으로 보지 않음", c.myPrograms[3].title.startsWith("진로 멘토링"));
check("일정(다음 회차)은 그대로 보냄", c.myPrograms[0].next === "11/6(금) 10:00-12:00", c.myPrograms[0].next);
check("화면용 연결표에는 진짜 이름", refs.get("p1").item.title === "2학기 집단상담: 관계 회복" && refs.get("s1").item.title === "개인상담 만족도");
check("분류 칸만 상담이어도 상담", isCounselProgram({ title: "중독예방 통합교육", category: "상담·심리지원 특강" }) && !isCounselProgram({ title: "AI 해커톤", category: "" }));

// 2) 추천 버튼 "비는 시간에 할 비교과"·"졸업 포인트 얼마 남았어?": 포인트 높은 순이 아니라 신청 마감 가까운 순 (포인트는 함께 표시)
{
  const o = (id, title, point, applyDday, extra = {}) => ({ id, title, point, applyDday, when: "11/10(화) 18:30-20:00", clashWithClass: false, ...extra });
  const ctx = {
    tasks: [], myPrograms: [], surveys: [], myEvents: [], academic: [],
    points: { needForGraduation: 185 },
    openPrograms: [o("o1", "AI 해커톤", 105, 9), o("o2", "현직자 특강", 10, 2), o("o3", "영어 스피치 대회", 30, 5), o("o4", "2학기 집단상담 프로그램", 65, 1, { category: "consult" }), o("o5", "겹치는 특강", 50, 0, { clashWithClass: true })],
  };
  const free = localAnswer("free", { context: ctx }, now);
  // 11/7 아침 사용자 결정: "비는 시간"에서는 상담 프로그램도 포함 (빼는 것은 "졸업 포인트" 답만)
  check("비는 시간: 신청 마감 가까운 순, 상담은 포함, 겹치는 것만 뺌", free.picks.map((p) => p.id).join() === "o4,o2,o3,o1", free.picks.map((p) => p.id).join());
  check("비는 시간: 개수 문구에 상담 포함 (4개)", /비교과 4개예요/.test(free.text), free.text);
  check("비는 시간: '포인트 높은 순' 문구 없음, 포인트는 줄에 표시", !/포인트 높은/.test(free.text) && /마감/.test(free.text) && /105점/.test(free.picks.find((p) => p.id === "o1").reason), free.text);
  const pts = localAnswer("points", { context: ctx }, now);
  check("졸업 포인트: 신청 마감 가까운 순", pts.picks.map((p) => p.id).join() === "o2,o3,o1", pts.picks.map((p) => p.id).join());
  check("졸업 포인트: 상담 프로그램은 계속 뺌", !pts.picks.some((p) => p.id === "o4"));
  check("졸업 포인트: 수업과 겹치는 것 뺌", !pts.picks.some((p) => p.id === "o5"));
  check("졸업 포인트: '포인트 높은 순' 문구 없음", !/포인트 높은/.test(pts.text) && /185점 남았어요/.test(pts.text), pts.text);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
