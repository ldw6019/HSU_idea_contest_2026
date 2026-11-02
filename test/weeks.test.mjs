// 이번 주·다음 주 구분 (AI에 보내는 기간 표시, 10/29). 실행: node test/weeks.test.mjs
import { rangesOf, weekOf, monthOf, buildContext, distressReply } from "../core/ai.js";
let ok = 0, bad = 0;
const eq = (name, got, want) => (got === want ? ok++ : (bad++, console.log(`FAIL ${name}: ${got} ≠ ${want}`)));
const now = new Date(2026, 9, 29, 15, 0); // 10/29(목)
const r = rangesOf(now);
eq("이번 주", r.thisWeek, "10/26(월)~11/1(일)");
eq("다음 주", r.nextWeek, "11/2(월)~11/8(일)");
eq("이번 달", r.thisMonth, "10/1(목)~10/31(토)");
eq("다음 달", r.nextMonth, "11/1(일)~11/30(월)");
eq("일요일 23:59", weekOf(new Date(2026, 10, 1, 23, 59), now), "이번 주");
eq("월요일 0시 마감 = 일요일 밤", weekOf(new Date(2026, 10, 2, 0, 0), now), "이번 주");
eq("다음 주 수요일", weekOf(new Date(2026, 10, 4, 23, 59), now), "다음 주");
eq("다다음 주 월요일 0시 = 다음 주 일요일 밤", weekOf(new Date(2026, 10, 9, 0, 0), now), "다음 주");
eq("다다음 주", weekOf(new Date(2026, 10, 10, 10, 0), now), "다다음 주");
eq("그 뒤", weekOf(new Date(2026, 10, 17, 10, 0), now), "그 뒤");
eq("다다음 주 범위", rangesOf(now).weekAfterNext, "11/9(월)~11/15(일)");
eq("일요일 기준 이번 주", rangesOf(new Date(2026, 10, 1, 12, 0)).thisWeek, "10/26(월)~11/1(일)");
eq("연말 다음 달", rangesOf(new Date(2026, 11, 20)).nextMonth, "1/1(금)~1/31(일)");
eq("다음 달 11/2", monthOf(new Date(2026, 10, 2, 23, 59), now), "다음 달");
eq("11/1 0시 마감 = 10/31 밤", monthOf(new Date(2026, 10, 1, 0, 0), now), "이번 달");
eq("12월", monthOf(new Date(2026, 11, 3), now), "그 뒤");
eq("연말→1월", monthOf(new Date(2027, 0, 5), new Date(2026, 11, 20)), "다음 달");
// 11/2: 0시에 시작하는 종일 일정·기간은 그날로 (마감과 달리 전날로 당기지 않음)
const b = buildContext({ events: [{ title: "동아리 MT", start: new Date(2026, 10, 2, 0, 0).toISOString(), allDay: true }] }, now);
eq("종일 일정 시작 날짜", b.context.myEvents[0]?.when, "11/2(월)");
eq("종일 일정 주", b.context.myEvents[0]?.week, "다음 주");
eq("못 불러온 정보 표시", buildContext({ missing: ["eclass"] }, now).context.missing?.[0], "e클래스(강의·과제·퀴즈)");
eq("마음 힘듦 → 상담 안내", !!distressReply("요즘 우울하고 그만두고 싶어"), true);
eq("일정 질문은 그대로", distressReply("과제 너무 힘들어 언제까지야?"), null);
console.log(`${ok} passed, ${bad} failed`);
if (bad) process.exit(1);
