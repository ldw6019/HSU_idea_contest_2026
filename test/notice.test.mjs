// 공지 → 일정: 보내기 전에 지우는 것 시험 (node test/notice.test.mjs)
const { scrubNotice } = await import("../core/ai.js");
const cases = [
  ["전화번호", "문의 010-1234-5678 회장", "문의 [전화] 회장"],
  ["붙은 전화번호", "02 760 4114로 연락", "[전화]로 연락"],
  ["메일", "신청 abc.def@hansung.ac.kr 로", "신청 [메일] 로"],
  ["링크", "폼 https://forms.gle/xyz 작성", "폼 [링크] 작성"],
  ["날짜·시각은 그대로", "11/6(목) 19:00 상상관 302", "11/6(목) 19:00 상상관 302"],
  ["학번 같은 숫자는 그대로", "2026학년도 2학기 정기회의", "2026학년도 2학기 정기회의"],
];
let ok = 0;
for (const [name, input, want] of cases) {
  const got = scrubNotice(input);
  if (got === want) ok++;
  else console.log(`FAIL ${name}: ${JSON.stringify(got)}`);
}
const long = scrubNotice("가".repeat(2000));
if (long.length === 1500) ok++; else console.log("FAIL 1500자 자르기");
console.log(`${ok}/${cases.length + 1} 맞음`);
process.exit(ok === cases.length + 1 ? 0 : 1);
