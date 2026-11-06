// 공지 → 일정: 보내기 전에 지우는 것 시험 (node test/notice.test.mjs)
const { scrubNotice, scrubPersonal } = await import("../core/ai.js");
const cases = [
  ["전화번호", "문의 010-1234-5678 회장", "문의 [전화] 회장"],
  ["붙은 전화번호", "02 760 4114로 연락", "[전화]로 연락"],
  ["괄호 지역번호", "(02)760-4114 학생회", "[전화] 학생회"],
  ["+82", "+82 10-1234-5678 로", "[전화] 로"],
  ["대표번호", "1588-1234 문의", "[전화] 문의"],
  ["전각 숫자", "０１０-１２３４-５６７８", "[전화]"],
  ["메일", "신청 abc.def@hansung.ac.kr 로", "신청 [메일] 로"],
  ["링크", "폼 https://forms.gle/xyz 작성", "폼 [링크] 작성"],
  ["http 없는 링크", "톡방 open.kakao.com/o/abc 들어와", "톡방 [링크] 들어와"],
  ["계좌번호", "신한 110-123-456789 홍길동", "신한 [번호] 홍길동"],
  ["카카오뱅크 계좌", "카카오뱅크 3333-01-1234567", "카카오뱅크 [번호]"],
  ["학번 목록", "합격: 2291234 홍길동, 2391235", "합격: [번호] 홍길동, [번호]"],
  ["날짜·시각은 그대로", "11/6(목) 19:00 상상관 302", "11/6(목) 19:00 상상관 302"],
  ["연-월-일은 그대로", "2026-11-10 18시", "2026-11-10 18시"],
  ["학년도 그대로", "2026학년도 2학기 정기회의", "2026학년도 2학기 정기회의"],
  ["금액 그대로", "회비 30,000원 1.5배", "회비 30,000원 1.5배"],
];
let ok = 0;
for (const [name, input, want] of cases) {
  const got = scrubNotice(input);
  if (got === want) ok++;
  else console.log(`FAIL ${name}: ${JSON.stringify(got)}`);
}
const long = scrubNotice("가".repeat(2000));
if (long.length === 1500) ok++; else console.log("FAIL 1500자 자르기");
if (scrubPersonal("제 학번 2291234 이고 010-1234-5678") === "제 학번 [번호] 이고 [전화]") ok++; else console.log("FAIL 질문 거르기", scrubPersonal("제 학번 2291234 이고 010-1234-5678"));
console.log(`${ok}/${cases.length + 2} 맞음`);
process.exit(ok === cases.length + 2 ? 0 : 1);
