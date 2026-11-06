// 온라인출석부 진도 표 읽기 (두 가지 모양). 실행: node test/progress.test.mjs (Playwright 크로미움 사용)
// 11/6 실제 화면 확인: 일부 과목은 progress.php → user_progress.php로 넘어가며 표 모양이 다름
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
  const ec = await import("/adapters/eclass.js");
  const P = new DOMParser();
  const toObj = (m) => Object.fromEntries([...m.entries()]);
  // 보통 모양: 주차 | 강의 자료 | 총 학습시간 | 출석 | 주차 출석
  const a = P.parseFromString(`<table class="user_progress_table"><tbody>
    <tr><td>1</td><td class="text-left">1주차 소개</td><td>48:10<br>(100%)</td><td>O</td><td>O</td></tr>
    <tr><td>2</td><td class="text-left">2주차 정렬</td><td>10:00</td><td>X</td><td>X</td></tr></tbody></table>`, "text/html");
  // 다른 모양: (위쪽 개인정보 표) + 주제 | 강의 자료 | 출석인정 요구시간 | 총 학습시간
  const b = P.parseFromString(`<table class="table table-bordered"><tr><td>학번</td><td>0000000</td></tr></table>
    <table class="table table-bordered user_progress"><thead><tr><th>주제</th><th>강의 자료</th><th>출석인정 요구시간</th><th>총 학습시간</th></tr></thead><tbody>
    <tr><td class="vmiddle text-center" rowspan="3">1</td><td class="text-left">안전 교육 1</td><td class="text-center hidden-xs hidden-sm">27:00</td><td class="text-center">30:12</td></tr>
    <tr><td class="text-left">안전 교육 2</td><td class="text-center hidden-xs hidden-sm">27:00</td><td class="text-center"></td></tr>
    <tr><td class="text-left">안전 교육 3</td><td class="text-center hidden-xs hidden-sm">1:02:00</td><td class="text-center">20:00</td></tr>
    </tbody></table>`, "text/html");
  const none = P.parseFromString(`<p>없음</p>`, "text/html");
  return { a: toObj(ec.parseProgress(a)), b: toObj(ec.parseProgress(b)), none: ec.parseProgress(none).size };
});
await browser.close();

let ok = 0, bad = 0;
const eq = (name, g, w) => (JSON.stringify(g) === JSON.stringify(w) ? ok++ : (bad++, console.log(`FAIL ${name}: ${JSON.stringify(g)} ≠ ${JSON.stringify(w)}`)));
eq("보통 표 출석", got.a["1주차소개"], { learnedSec: 2890, attended: true });
eq("보통 표 미출석", got.a["2주차정렬"], { learnedSec: 600, attended: false });
eq("다른 표 요구시간 넘김", got.b["안전교육1"], { learnedSec: 1812, attended: true });
eq("다른 표 빈 칸 = 0", got.b["안전교육2"], { learnedSec: 0, attended: false });
eq("다른 표 1시간 넘는 요구시간", got.b["안전교육3"], { learnedSec: 1200, attended: false });
eq("다른 표 개수(개인정보 표는 안 읽음)", Object.keys(got.b).length, 3);
eq("표 없음", got.none, 0);
console.log(`${ok}/${ok + bad} 맞음`);
process.exit(bad ? 1 : 0);
