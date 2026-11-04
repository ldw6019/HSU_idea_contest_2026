// 0.4.1 동작 점검 (시연 데이터): 실행 버튼 배지, 표시 읽는 법, 숨기기→캘린더에서 빠짐→되돌리기, 공지→일정(AI 서버는 가짜 응답), Esc
// PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 node tools/e2e-check.mjs
import { chromium } from "playwright";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDemo } from "../core/demo.js";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ctx = await chromium.launchPersistentContext("", { headless: true, channel: "chromium", viewport: { width: 1280, height: 900 }, args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`] });
const demo = buildDemo(new Date());
await ctx.route("https://learn.hansung.ac.kr/**", (r) => {
  const u = new URL(r.request().url());
  const body = u.pathname === "/" || u.pathname === "/index.php" ? `<html><body id="page-site-index"><a>로그아웃</a></body></html>` : demo.learnHtml(u.href);
  return r.fulfill({ contentType: "text/html; charset=utf-8", body });
});
await ctx.route(/https:\/\/(hsportal|info|www)\.hansung\.ac\.kr\/.*/, (r) => r.abort());
let sentText = null;
await ctx.route("https://hsuplus-ai.yeee222241.workers.dev/**", async (r) => {
  const req = r.request();
  if (req.method() === "OPTIONS") return r.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST" } });
  if (req.url().endsWith("/v1/extract")) {
    sentText = JSON.parse(req.postData()).text;
    return r.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ events: [{ title: "동아리 정기 회의", date: "2026-11-12", start: "19:00", end: "21:00", place: "상상관 302" }, { title: "MT", date: "2026-11-21", start: null, end: null, place: null }] }) });
  }
  return r.fulfill({ status: 404, body: "{}" });
});
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
while (!(await sw.evaluate(() => !!chrome.storage))) await new Promise((r) => setTimeout(r, 100));
await sw.evaluate(() => chrome.storage.local.set({ "ui:welcomed": 1, "ui:demo": 1 }));

const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto("https://learn.hansung.ac.kr/");
await page.waitForTimeout(800);
const R = page.locator("#on-track-root");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => (cond ? pass++ : fail++, console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`));
const tab = (label) => R.locator("nav.tabs button", { hasText: label }).click();

await R.locator("button.launcher").click();
await page.waitForTimeout(3000);
const badge = R.locator(".ln-badge");
check("실행 버튼 배지 (오늘·내일 마감 수)", (await badge.count()) === 1, `hidden=${await badge.getAttribute("hidden")} text=${await badge.textContent()}`);


// 숨기기 → 토스트 → 캘린더에서 빠짐 → 되돌리기
await tab("캘린더");
await R.locator(".frame.cal .seg-btn", { hasText: /주간/ }).first().click(); // 월간은 점만 찍으므로 주간에서 이름으로 확인
await page.waitForTimeout(300);
const calText0 = await R.locator(".frame.cal").innerText();
await tab("이번 주");
await page.waitForTimeout(300);
const progSeg = R.locator(".seg-btn", { hasText: "비교과" }).first();
if (await progSeg.count()) await progSeg.click();
await page.waitForTimeout(300);
// 이번 주 캘린더에 실제로 보이는 비교과 회차 하나를 골라 숨김
const cards = R.locator('a.tcard[href*="hsportal"]:has(.hide-btn)'); // 비교과 회차 카드만 (직접 넣은 일정은 숨겨도 캘린더엔 남음)
let row = null, rowName = "";
for (let i = 0; i < (await cards.count()); i++) {
  const t = ((await cards.nth(i).locator(".tc-title").first().innerText().catch(() => "")) || "").trim();
  if (t && calText0.includes(t.slice(0, 6))) ((row = cards.nth(i)), (rowName = t));
  if (row) break;
}
await row.locator(".hide-btn").click();
await page.waitForTimeout(300);
check("숨기기 → 토스트", (await R.locator(".toast").count()) === 1 && /숨겼어요/.test(await R.locator(".toast").innerText()));
await tab("캘린더");
await page.waitForTimeout(300);
const calText1 = await R.locator(".frame.cal").innerText();
const key = rowName.slice(0, 6);
const cnt = (t) => t.split(key).length - 1; // 매주 회차는 숨긴 그 회차만 빠짐
check("숨긴 비교과 회차는 캘린더에서 빠짐", key && cnt(calText1) === cnt(calText0) - 1, `"${key}" ${cnt(calText0)} → ${cnt(calText1)}`);
await tab("이번 주");
await page.waitForTimeout(200);
if (await R.locator(".toast-undo").count()) await R.locator(".toast-undo").click();
await page.waitForTimeout(300);
await tab("캘린더");
await page.waitForTimeout(300);
check("되돌리기 → 캘린더에 다시 보임", cnt(await R.locator(".frame.cal").innerText()) === cnt(calText0));

// 같은 프로그램을 회차별로 신청해 목록에 여러 줄 (시연 데이터: 워크숍 1차·2차 → 2줄) → 카드 1개, 캘린더 회차 중복 없음
await tab("비교과");
await page.waitForTimeout(800);
await R.locator(".seg-btn", { hasText: "내 비교과" }).click();
await page.waitForTimeout(300);
check("회차별 신청 프로그램은 카드 1개", (await R.locator(".tcard", { hasText: "학습법 워크숍" }).count()) === 1);
await tab("캘린더");
await page.waitForTimeout(300);
const calAll = await R.locator(".frame.cal").innerText();
// 회차마다 이름이 있으면 캘린더에는 회차 이름 (11/2 사용자)
check("캘린더에 회차 이름으로 중복 없이 (이번 주 1회)", (calAll.match(/1차 AI 활용 학습법/g) || []).length === 1 && !/학습법 워크숍/.test(calAll), `${(calAll.match(/1차 AI 활용 학습법/g) || []).length}회`);

// 내 비교과 통째로 숨기기 (11/2 사용자: 신청에 떨어진 비교과)
await tab("비교과");
await page.waitForTimeout(800);
await R.locator(".seg-btn", { hasText: "내 비교과" }).click();
await page.waitForTimeout(300);
const mineCard = R.locator(".tcard:has(.hide-btn)").first();
const progName = (await mineCard.locator(".tc-title").innerText()).trim();
const pk = progName.slice(0, 6);
await tab("캘린더");
await page.waitForTimeout(300);
const calBefore = (await R.locator(".frame.cal").innerText()).split(pk).length - 1;
await tab("비교과");
await page.waitForTimeout(300);
await R.locator(".tcard", { hasText: progName }).locator(".hide-btn").click();
await page.waitForTimeout(300);
const listText = await R.locator(".body").innerText();
check("내 비교과에서 숨기면 목록에서 빠짐", !listText.includes(progName) && /숨긴 비교과 1개 보기/.test(listText), progName);
await tab("캘린더");
await page.waitForTimeout(300);
const calAfter = (await R.locator(".frame.cal").innerText()).split(pk).length - 1;
check("숨긴 비교과는 캘린더 회차 전부 빠짐", calAfter === 0, `"${pk}" ${calBefore} → ${calAfter}`);
await tab("이번 주");
await page.waitForTimeout(300);
const ps = R.locator(".seg-btn", { hasText: "비교과" }).first();
if (await ps.count()) await ps.click();
await page.waitForTimeout(200);
check("숨긴 비교과는 이번 주에서도 빠짐", !(await R.locator(".body").innerText()).includes(progName));
await tab("비교과");
await page.waitForTimeout(300);
await R.locator(".hidden-toggle", { hasText: "숨긴 비교과" }).click();
await R.locator(".hidden-box").scrollIntoViewIfNeeded();
await R.locator("section.panel").screenshot({ path: resolve(root, "tools/shots/e2e-mine-hidden.png") });
await R.locator(".hidden-row", { hasText: progName }).locator("button").click();
await page.waitForTimeout(300);
check("다시 보이기 → 내 비교과에 돌아옴", (await R.locator(".body").innerText()).includes(progName));
await R.locator(".body").evaluate((e) => (e.scrollTop = 0));
await R.locator(".tcard", { hasText: progName }).scrollIntoViewIfNeeded();
await R.locator("section.panel").screenshot({ path: resolve(root, "tools/shots/e2e-mine.png") });

// 공지 → 일정
await tab("캘린더");
await page.waitForTimeout(300);
await R.locator("button.small", { hasText: "+ 일정" }).click();
await page.waitForTimeout(200);
await R.locator(".notice-box summary").click();
await R.locator(".notice-text").fill("[공지] 다음 주 목요일 저녁 7시~9시 상상관 302 정기 회의! 문의 010-1234-5678 https://open.kakao.com/o/abc");
await R.locator(".notice-box button", { hasText: "AI로 칸 채우기" }).click();
await page.waitForTimeout(1500);
check("서버로 간 공지에서 전화·링크 지움", sentText && !/010-1234|kakao/.test(sentText), JSON.stringify(sentText));
const chips = R.locator(".notice-found .chip");
check("일정 2개 → 고르기", (await chips.count()) === 2, await R.locator(".notice-box").innerText());
await chips.first().click();
await page.waitForTimeout(200);
const vals = await R.locator(".ev-form input, .ev-input").evaluateAll((xs) => xs.map((x) => x.value));
check("고른 일정으로 칸 채움", vals.includes("동아리 정기 회의") && vals.includes("2026-11-12") && vals.includes("19:00") && vals.includes("상상관 302"), vals.join(" | "));
await R.locator("section.panel").screenshot({ path: resolve(root, "tools/shots/e2e-notice.png") });
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
check("Esc → 일정 칸 닫힘", (await R.locator(".notice-box").count()) === 0);
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
check("Esc 한 번 더 → 패널 닫힘", !(await R.locator("section.panel").isVisible().catch(() => false)));
check("콘솔 오류 없음", errors.length === 0, errors.slice(0, 3).join(" | "));

// 기본은 넓게 보기, 좁게 고르면 기억 (11/2 사용자). 시연 모드는 설정을 저장하지 않아서 끄고 확인 (학교 요청은 위에서 막아 둠)
await sw.evaluate(() => chrome.storage.local.remove("ui:demo"));
const openPanel = async () => {
  await page.goto("https://learn.hansung.ac.kr/");
  await page.waitForTimeout(800);
  await R.locator("button.launcher").click();
  await page.waitForTimeout(1500);
};
await openPanel();
check("처음엔 넓게 보기", await R.locator("section.panel").evaluate((p) => p.classList.contains("wide")));
await R.locator("button.wide-toggle").click();
await page.waitForTimeout(900); // 설정 저장은 0.5초 모아서
await openPanel();
check("좁게 보기를 고르면 다시 열어도 좁게", !(await R.locator("section.panel").evaluate((p) => p.classList.contains("wide"))) && (await R.locator("button.wide-toggle").innerText()) === "넓게 보기");
await R.locator("button.wide-toggle").click();
await page.waitForTimeout(900);
console.log(`\n${pass} passed, ${fail} failed`);
await ctx.close();
process.exit(fail ? 1 : 0);
