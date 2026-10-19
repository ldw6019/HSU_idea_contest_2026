// AI 문장 속 칩 뒤 조사 고치기 시험. 실행: node test/josa.test.mjs
import { fixJosa, detectIntent } from "../core/ai.js";
const cases = [
  ["AI 실무 활용 역량 특강&검사 2차 모집", "는", "은"],
  ["중간고사", "은", "는"],
  ["팀별 프로젝트 활동 보고서 제출", "가", "이"], // 출 = ㄹ받침
  ["ERD 설계 과제", "을", "를"],
  ["진로멘토링", "를", "을"],
  ["학습법 워크숍", "와", "과"],
  ["서울", "으로", "로"],
  ["상상관", "로", "으로"],
  ["AI 해커톤", "부터", "부터"],
  ["OcO(오시오, Open course On)", "는", "는"], // 끝이 괄호·영어면 그대로
  ["제14회 외국인한국어뽐내기 대회 참관(학부…", "도", "도"],
];
let fail = 0;
for (const [n, j, want] of cases) {
  const got = fixJosa(n, j);
  if (got !== want) (fail++, console.log(`FAIL ${n} + ${j} → ${got} (기대 ${want})`));
}
for (const q of ["할거 알려줘", "할거 알려줘.", "오늘 뭐하지"]) if (detectIntent(q) !== "today") (fail++, console.log("FAIL intent", q, detectIntent(q)));
console.log(`${cases.length + 3 - fail}/${cases.length + 3} 맞음`);
process.exit(fail ? 1 : 0);
