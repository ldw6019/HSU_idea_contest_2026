// 낸 것으로 확인된 설문은 다시 열지 않기 (11/7). 실행: node test/survey.test.mjs (Playwright 크로미움 사용, 시연 데이터의 가짜 HTML)
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const browser = await chromium.launch();
const page = await browser.newPage();
await page.route("http://t.local/**", (route) => {
  const p = new URL(route.request().url()).pathname;
  if (p === "/") return route.fulfill({ contentType: "text/html", body: "<html></html>" });
  return route.fulfill({ path: path.join(root, p), contentType: "text/javascript" });
});
await page.goto("http://t.local/");
const got = await page.evaluate(async () => {
  const hs = await import("/adapters/hsportal.js");
  const { buildDemo } = await import("/core/demo.js");
  const demo = buildDemo(new Date());
  // 시연 데이터 종료 목록: 301 전자정보박람회(설문 냄), 302 가을 캠퍼스 플로깅(안 냄)
  const run = async (answered, failPoll = false) => {
    const polls = [];
    const getText = async (url) => {
      if (url.includes("/@poll/write/")) {
        polls.push(url.replace(/.*\/@poll\/write\//, ""));
        if (failPoll) throw new Error("요청 실패");
      }
      return demo.siteHtml(url);
    };
    const r = await hs.fetchMyPrograms(getText, new Date(), answered ? { answered } : undefined);
    return { polls, surveys: r.surveys.map((s) => s.title), answeredPolls: r.answeredPolls, checked: r.checkedSurveys };
  };
  const first = await run(null);
  const second = await run(first.answeredPolls);
  const failed = await run([], true);
  return { first, second, failed };
});
await browser.close();

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => (cond ? pass++ : fail++, console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`));
const { first, second, failed } = got;
check("처음: 설문 화면 2개 열어 확인", first.polls.length === 2, first.polls.join());
check("처음: 안 낸 설문만 알림", first.surveys.join() === "가을 캠퍼스 플로깅", first.surveys.join());
check("처음: 낸 설문은 저장할 목록으로", first.answeredPolls.join() === "301/9301", first.answeredPolls.join());
check("다음: 낸 설문은 다시 열지 않음", second.polls.join() === "302/9302", second.polls.join());
check("다음: 안 낸 설문 알림은 그대로", second.surveys.join() === "가을 캠퍼스 플로깅");
check("다음: 저장 목록 유지 (확인한 설문 수도 그대로)", second.answeredPolls.join() === "301/9301" && second.checked === 2);
check("확인 못 함(오류) → 저장하지 않음 (다음에 다시 엶)", failed.answeredPolls.length === 0 && failed.surveys.length === 0 && failed.polls.length === 2);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
