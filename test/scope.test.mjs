// 직접 쓴 질문 중 서버에 보내지 않고 바로 막는 것(코드·번역·과제 정답) 시험. 실행: node test/scope.test.mjs
import { clearlyOutOfScope as f } from "../core/ai.js";
const block = ["파이썬 코드 짜줘", "버블 정렬 알려줘", "이 문장 영어로 번역해 줘", "데이터베이스 과제 대신 해줘", "3장 연습문제 답 알려줘", "레포트 써줘", "자바로 구현해줘", "정답 뭐야", "코드 좀 짜 줘"];
const pass = ["오늘 뭐 해야 돼?", "설문 답 안 한 거 있어?", "이번 주 일정 짜줘", "비교과 추천해줘", "코딩 비교과 있어?", "파이썬 강의 언제까지야?", "과제 마감 언제야?", "운영체제 강의 몇 % 들었어?", "프로그래밍 관련 비교과 있어?", "보고서 마감 언제야?"];
let fail = 0;
for (const q of block) if (!f(q)) (fail++, console.log("FAIL 막아야 함:", q));
for (const q of pass) if (f(q)) (fail++, console.log("FAIL 통과해야 함:", q));
console.log(`${block.length + pass.length - fail}/${block.length + pass.length} 맞음`);
process.exit(fail ? 1 : 0);
