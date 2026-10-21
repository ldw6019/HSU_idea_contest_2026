// 자동 화면 점검 (가짜 데이터, 실제 계정·개인정보 없음)
//
// 10/21부터 README 그림은 실제 크롬에서 "시연 모드"를 켜고 직접 찍는다 (실제 e클래스 글꼴·배경 그대로, docs/DEMO.md).
// 이 스크립트는 그 시연 모드를 클라우드·CI에서 켜서 화면이 깨지지 않았는지 자동으로 찍어 보는 용도.
//  - 데이터는 확장 안의 core/demo.js 하나만 쓴다 (예전처럼 이 파일에 따로 두지 않음)
//  - e클래스 화면은 빈 껍데기만 흉내 (그래서 글꼴·배경은 실제와 다름 → README에는 쓰지 않음)
//
// 준비: npm i -D playwright && npx playwright install chromium
// 실행: node tools/screenshots.mjs [저장 폴더]   (기본: tools/shots, 저장소에는 올리지 않음)

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { buildDemo } from "../core/demo.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(process.argv[2] || resolve(root, "tools/shots"));
mkdirSync(out, { recursive: true });

const ctx = await chromium.launchPersistentContext("", {
  headless: true,
  channel: "chromium", // 확장을 불러오려면 필요 (기본 headless 셸은 확장을 못 씀)
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
});

// e클래스: 메인은 "로그아웃"만 있는 빈 화면(시연 모드가 데이터를 대신함), 과목 페이지는 강의실 표시 점검용으로 가짜 데이터 화면
const demo = buildDemo(new Date());
await ctx.route("https://learn.hansung.ac.kr/**", (r) => {
  const u = new URL(r.request().url());
  const body = u.pathname === "/" || u.pathname === "/index.php" ? `<html><body id="page-site-index" style="font-family:sans-serif;padding:24px"><a>로그아웃</a><h2>e클래스 (점검용 빈 화면)</h2></body></html>` : demo.learnHtml(u.href);
  return r.fulfill({ contentType: "text/html; charset=utf-8", body });
});
// 다른 학교 사이트로 나가는 요청이 있으면 실패시켜 드러나게 (시연 모드는 학교에 요청하지 않아야 함)
const leaked = [];
await ctx.route(/https:\/\/(hsportal|info|www)\.hansung\.ac\.kr\/.*/, (r) => (leaked.push(r.request().url()), r.abort()));

const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
while (!(await sw.evaluate(() => !!chrome.storage))) await new Promise((r) => setTimeout(r, 100)); // 막 켜진 service worker는 잠깐 storage가 없음
await sw.evaluate(() => chrome.storage.local.set({ "ui:welcomed": 1, "ui:demo": 1 })); // 처음 안내 빼고, 시연 모드 켜기

// ---------- 찍기 ----------
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto("https://learn.hansung.ac.kr/");
await page.waitForTimeout(700);
const R = page.locator("#on-track-root");
await R.locator("button.launcher").click();
await page.waitForTimeout(3000);
const panelShot = async (name) => {
  await page.waitForTimeout(300);
  await R.locator("section.panel").screenshot({ path: resolve(out, name) });
  console.log("saved", name);
};
const tab = (label) => R.locator("nav.tabs button", { hasText: label }).click();
const seg = (label) => R.locator(".seg-btn", { hasText: label }).click();

await panelShot("panel-week.png"); // 이번 주: 강의
await seg("과제");
await panelShot("panel-week-assign.png");
await tab("캘린더");
await R.locator(".cal-sub .seg-mini", { hasText: "이번 주" }).click();
await panelShot("panel-calendar.png");
await R.locator(".frame.cal .seg-btn", { hasText: "월간" }).click();
await panelShot("panel-calendar-month.png");
await tab("비교과");
await page.waitForTimeout(800);
await R.locator(".tcard.ap", { hasText: "집단상담" }).locator(".linkish", { hasText: "회차" }).click();
await R.locator(".body").evaluate((e) => (e.scrollTop = 0));
await panelShot("panel-apply.png");
await seg("내 비교과");
await panelShot("panel-programs.png");
await tab("AI");
await R.locator(".chip", { hasText: "오늘 뭐 해야 돼?" }).click();
await page.waitForTimeout(1300);
await R.locator(".chip", { hasText: "비는 시간에 할 비교과" }).click();
await page.waitForTimeout(1300);
await R.locator(".chat").evaluate((e) => e.lastElementChild.scrollIntoView({ block: "end" }));
await panelShot("panel-ai.png");

// 강의실(과목 페이지) 표시
const course = await ctx.newPage();
await course.setViewportSize({ width: 980, height: 700 });
await course.goto("https://learn.hansung.ac.kr/course/view.php?id=11");
await course.waitForTimeout(2500);
await course.locator(".total_sections").screenshot({ path: resolve(out, "course-page.png") });
console.log("saved course-page.png");

console.log(leaked.length ? `학교 사이트로 나간 요청 ${leaked.length}건: ${leaked.slice(0, 3).join(", ")}` : "학교 사이트로 나간 요청 없음");
console.log(errors.length ? `콘솔 오류 ${errors.length}건: ${errors.slice(0, 3).join(" | ")}` : "콘솔 오류 없음");
await ctx.close();
