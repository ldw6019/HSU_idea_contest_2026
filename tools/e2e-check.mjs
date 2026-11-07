// 0.4.1 동작 점검 (시연 데이터): 실행 버튼 배지, 표시 읽는 법, 숨기기→캘린더에서 빠짐→되돌리기, 공지→일정(AI 서버는 가짜 응답), Esc
// PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 node tools/e2e-check.mjs
import { chromium } from "playwright";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDemo } from "../core/demo.js";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ctx = await chromium.launchPersistentContext("", { headless: true, channel: "chromium", viewport: { width: 1280, height: 900 }, acceptDownloads: true, args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`] });
const demo = buildDemo(new Date());
let whoId = null; // 오른쪽 위 사용자 메뉴의 본인 번호 (공용 PC 사용자 바뀜 점검용, 없으면 메뉴 없음)
await ctx.route("https://learn.hansung.ac.kr/**", (r) => {
  const u = new URL(r.request().url());
  const menu = whoId ? `<div class="usermenu"><a href="https://learn.hansung.ac.kr/user/edit.php?id=${whoId}">정보 수정</a></div>` : "";
  const body = u.pathname === "/" || u.pathname === "/index.php" ? `<html><body id="page-site-index">${menu}<a>로그아웃</a></body></html>` : demo.learnHtml(u.href);
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
// 11/7: 토·일에는 캘린더가 저절로 다음 주를 보여 줘서, 이번 주 탭의 카드(이번 주 주말 회차)를 캘린더에서 못 찾고 멈췄음
//  → 이번 주·다음 주 주간 글을 둘 다 모아서 비교하고, 보던 주는 요일 기본값(평일 이번 주, 토·일 다음 주)으로 되돌린다
const calWeeks = async () => {
  let t = "";
  for (const w of ["이번 주", "다음 주"]) {
    await R.locator(".frame.cal .seg-mini", { hasText: w }).first().click();
    await page.waitForTimeout(200);
    t += (await R.locator(".frame.cal").innerText()) + "\n";
  }
  const wd = new Date().getDay();
  await R.locator(".frame.cal .seg-mini", { hasText: wd === 0 || wd === 6 ? "다음 주" : "이번 주" }).first().click();
  await page.waitForTimeout(200);
  return t;
};
await tab("캘린더");
await R.locator(".frame.cal .seg-btn", { hasText: /주간/ }).first().click(); // 월간은 점만 찍으므로 주간에서 이름으로 확인
await page.waitForTimeout(300);
const calText0 = await calWeeks();
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
check("이번 주 탭 비교과 카드를 캘린더에서 찾음", !!row, rowName);
if (!row) throw new Error("숨길 비교과 카드를 찾지 못해 멈춤");
await row.locator(".hide-btn").click();
await page.waitForTimeout(300);
check("숨기기 → 토스트", (await R.locator(".toast").count()) === 1 && /숨겼어요/.test(await R.locator(".toast").innerText()));
await tab("캘린더");
await page.waitForTimeout(300);
const calText1 = await calWeeks();
const key = rowName.slice(0, 6);
const cnt = (t) => t.split(key).length - 1; // 매주 회차는 숨긴 그 회차만 빠짐
check("숨긴 비교과 회차는 캘린더에서 빠짐", key && cnt(calText1) === cnt(calText0) - 1, `"${key}" ${cnt(calText0)} → ${cnt(calText1)}`);
await tab("이번 주");
await page.waitForTimeout(200);
if (await R.locator(".toast-undo").count()) await R.locator(".toast-undo").click();
await page.waitForTimeout(300);
await tab("캘린더");
await page.waitForTimeout(300);
check("되돌리기 → 캘린더에 다시 보임", cnt(await calWeeks()) === cnt(calText0));

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
const calBefore = (await calWeeks()).split(pk).length - 1;
await tab("비교과");
await page.waitForTimeout(300);
await R.locator(".tcard", { hasText: progName }).locator(".hide-btn").click();
await page.waitForTimeout(300);
const listText = await R.locator(".body").innerText();
check("내 비교과에서 숨기면 목록에서 빠짐", !listText.includes(progName) && /숨긴 비교과 1개 보기/.test(listText), progName);
await tab("캘린더");
await page.waitForTimeout(300);
const calAfter = (await calWeeks()).split(pk).length - 1;
check("숨긴 비교과는 캘린더 회차 전부 빠짐", calBefore > 0 && calAfter === 0, `"${pk}" ${calBefore} → ${calAfter}`);
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

// AI 탭: 보내는 곳(미국 AI 회사)과 보관 기간을 한 줄로 알림 (11/7)
await tab("AI");
await page.waitForTimeout(300);
check("AI 탭: 국외(Anthropic) 처리·보관 기간 안내", /미국 AI 회사\(Anthropic\)/.test(await R.locator(".ai-bottom").innerText()) && /30일/.test(await R.locator(".ai-bottom").innerText()));

// 공지 → 일정
await tab("캘린더");
await page.waitForTimeout(300);
await R.locator("button.small", { hasText: "+ 일정" }).click();
await page.waitForTimeout(200);
await R.locator(".notice-box summary").click();
check("공지 칸: 다른 사람 이름은 지우고 붙여 넣으라는 안내", /다른 사람 이름은 지우고/.test(await R.locator(".notice-box .notice-name").innerText()));
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
// 11/6: 쓰던 내용이 있으면 Esc로 지우지 않고 알림만 → 취소로 닫기
check("쓰던 일정은 Esc로 안 지워짐", (await R.locator(".notice-box").count()) === 1 && /취소/.test(await R.locator(".toast").innerText()));
await R.locator(".ev-form button", { hasText: "취소" }).click();
await page.waitForTimeout(200);
check("취소 → 일정 칸 닫힘", (await R.locator(".notice-box").count()) === 0);
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

// 공용 PC (11/7 아침 사용자 결정: 지우지 않고 숨김) — 주인/손님 두 계정 흐름
//  이 크롬의 주인(처음 확인된 사용자)이 아니면 손님 모드: sync의 직접 일정·숨김·옵션을 화면·캘린더·.ics·AI 전송 모두에서 빼고, 손님 설정은 local "guest|"
const { userTag } = await import("../core/who.js");
const store = (area) => sw.evaluate((a) => chrome.storage[a].get(null), area);
const day2 = (() => {
  const d = new Date(Date.now() + 2 * 864e5);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
})();
const putOwner = () =>
  sw.evaluate((d) => Promise.all([chrome.storage.sync.set({ "ev|e2e1": { t: "주인 카페 알바", w: [1, 2, 3, 4, 5], s: "18:00", e: "22:00", from: "2026-10-01", until: "", at: 1 }, "ev|e2e2": { t: "주인 병원 예약", d, s: "10:00", e: "11:00", at: 1 }, "hide|e2e": Date.now() }), chrome.storage.local.set({ "ai:install": "e2e-install-a" })]), day2);
const OWN_SYNC = ["ev|e2e1", "ev|e2e2", "hide|e2e"];
const hasOwnSync = (s) => OWN_SYNC.every((k) => k in s);
const warnText = async () => ((await R.locator(".save-warn").getAttribute("hidden")) === null ? await R.locator(".save-warn").innerText() : "");
const calNow = async () => {
  await tab("캘린더");
  await page.waitForTimeout(300);
  await R.locator(".frame.cal .seg-btn", { hasText: /주간/ }).first().click();
  await page.waitForTimeout(200);
  return calWeeks();
};
const aiJson = async () => {
  await tab("AI");
  await page.waitForTimeout(300);
  await R.locator(".ai-preview > summary").click();
  await page.waitForTimeout(300);
  await R.locator(".ai-raw > summary").click();
  await page.waitForTimeout(200);
  const t = await R.locator(".ai-json").innerText();
  await R.locator(".ai-preview > summary").click(); // 다음 점검에 영향 없게 닫음
  return t;
};
const icsText = async () => {
  await tab("캘린더");
  await page.waitForTimeout(300);
  const got = page.waitForEvent("download", { timeout: 5000 }).catch(() => null);
  await R.locator("button.small", { hasText: "캘린더 파일(.ics) 내보내기" }).click();
  const dl = await got;
  if (!dl) return /내보낼 일정이 없어요/.test(await R.locator(".ct-note").innerText().catch(() => "")) ? "" : "ERR 내려받기 없음";
  const { readFile } = await import("node:fs/promises");
  return readFile(await dl.path(), "utf8");
};
// 이번 주 탭 '과제'의 숨기기 버튼 툴팁들. 시연 모드가 아니면 e클래스 목록을 못 불러오므로, 지금 사용자의 학교 데이터 저장본에 과제 1개를 넣어 둠
//  (사용자가 바뀌면 지워지므로 같은 사용자로 다시 열기 전에 넣는다)
const { makeItem } = await import("../core/model.js");
const seedEclass = () => sw.evaluate((it) => chrome.storage.local.set({ "cache:eclass": { data: { courses: [], items: [it], failed: [] }, fetchedAt: Date.now() } }), makeItem({ id: "eclass:assign:e2e", source: "eclass", type: "assignment", title: "e2e 보고서", course: "운영체제", due: new Date(Date.now() + 2 * 864e5).toISOString(), status: "todo", url: "https://learn.hansung.ac.kr/mod/assign/view.php?id=1" }));
const hideTitles = async () => {
  await tab("이번 주");
  await page.waitForTimeout(300);
  await R.locator(".seg-btn", { hasText: "과제" }).first().click();
  await page.waitForTimeout(300);
  return R.locator(".hide-btn").evaluateAll((bs) => bs.map((b) => b.title));
};
const tagA = await userTag("1001"), tagB = await userTag("1002");

// 1) 주인 표시가 없을 때 처음 확인된 사용자(1001)를 주인으로
whoId = "1001";
await openPanel();
check("주인 표시 없음 → 처음 확인된 사용자를 주인으로 (해시만 저장)", (await store("sync"))["ui:owner"] === tagA && !JSON.stringify(await store("sync")).includes("1001"));
await putOwner();
await seedEclass();
await openPanel();
const ownCal = await calNow();
check("주인 → 직접 넣은 일정이 캘린더에 보임, 손님 알림 없음", ownCal.includes("주인 카페 알바") && ownCal.includes("주인 병원 예약") && !(await warnText()));
check("주인 → AI로 보낼 내용에 직접 넣은 일정 있음 (대조)", (await aiJson()).includes("주인 병원 예약"));
const oIcs = await icsText().catch((e) => `ERR ${e.message}`);
check("주인 → .ics 내보내기에 직접 넣은 일정 있음 (대조)", oIcs.includes("주인 카페 알바") && oIcs.includes("주인 병원 예약"), oIcs.slice(0, 40));
const oTips = await hideTitles();
check("주인 → 숨기기 툴팁 '내 크롬 계정에서 모두 적용' (대조)", oTips.length > 0 && oTips.every((t) => t.includes("내 크롬 계정에서 모두 적용")), oTips.slice(0, 2).join(" | "));

// 2) 다른 계정(1002) = 손님: sync는 그대로(지우지 않음), 화면·캘린더·.ics·AI 전송에서 주인 것이 빠짐
whoId = "1002";
await openPanel();
const s2 = await store("sync"), l2 = await store("local");
check("손님 → sync의 주인 일정·숨김·주인 표시 그대로 (지우지 않음)", hasOwnSync(s2) && s2["ui:owner"] === tagA, Object.keys(s2).join());
check("손님 → AI 설치 번호는 새로 (앞 사람 것 지움)", l2["ai:install"] !== "e2e-install-a");
check("손님 → 패널 위 알림 줄에 손님 모드 한 줄", /처음 쓴 e클래스 계정이 아니어서.*이 기기에만 잠깐 저장돼요/.test(await warnText()), await warnText());
const guestCal = await calNow();
check("손님 → 캘린더에 주인 일정 안 보임", !guestCal.includes("카페 알바") && !guestCal.includes("병원 예약"));
await R.locator("section.panel").screenshot({ path: resolve(root, "tools/shots/e2e-guest.png") });
check("손님 → AI로 보낼 내용에 주인 일정 없음", !(await aiJson()).includes("병원 예약"));
const gIcs = await icsText().catch((e) => `ERR ${e.message}`);
check("손님 → .ics 내보내기에 주인 일정 없음", !/^ERR/.test(gIcs) && !gIcs.includes("카페 알바") && !gIcs.includes("병원 예약"), `${gIcs.length}자`);
// 손님이 바꾼 설정은 local "guest|"로 (sync에 안 감)
await R.locator("button.wide-toggle").click();
await page.waitForTimeout(900);
const s2b = await store("sync"), l2b = await store("local");
check("손님 설정 → local guest|로 저장, sync엔 안 감", l2b["guest|opt|narrow"] === 1 && !("opt|narrow" in s2b), Object.keys(l2b).filter((k) => k.startsWith("guest|")).join());
await sw.evaluate(() => chrome.storage.local.set({ "guest|ev|g1": { t: "손님 스터디", w: [1, 2, 3, 4, 5], s: "08:00", e: "09:00", from: "2026-10-01", until: "", at: 1 } }));
await seedEclass();
await openPanel();
const guestCal2 = await calNow();
check("같은 손님이 다시 열면 → 손님 설정 그대로 (좁게 보기·손님 일정), 주인 일정은 여전히 없음", guestCal2.includes("손님 스터디") && !guestCal2.includes("카페 알바") && !(await R.locator("section.panel").evaluate((p) => p.classList.contains("wide"))));
const gTips = await hideTitles();
check("손님 → 숨기기 툴팁 '이 기기에만 잠깐 적용'", gTips.length > 0 && gTips.every((t) => t.includes("이 기기에만 잠깐 적용")), gTips.slice(0, 2).join(" | "));

// 3) 사용자를 확인하지 못하면(사용자 메뉴 없음) 아무것도 바꾸지 않음 = 지금처럼 sync가 보임
whoId = null;
await openPanel();
const l3 = await store("local");
check("사용자 확인 못 함 → 사용자 표시·손님 설정 그대로, 화면은 지금처럼 sync", l3["ui:who"] === tagB && l3["guest|opt|narrow"] === 1 && (await calNow()).includes("주인 카페 알바") && !(await warnText()));

// 4) 손님이 '내 데이터 모두 지우기' → 손님 local만 지우고 sync·주인 표시·사용자 표시는 남김
const wipeNow = async () => {
  await R.locator(".status-box summary").click();
  await R.locator("button.danger", { hasText: "내 데이터 모두 지우기" }).click();
  await R.locator("button.danger", { hasText: "한 번 더 누르면 지워요" }).click();
  await page.waitForTimeout(1200);
  return R.locator(".set-note").innerText().catch(() => "");
};
whoId = "1002";
await openPanel();
const gNote = await wipeNow();
const s4 = await store("sync"), l4 = await store("local");
check("손님이 지우기 → 손님 설정 지움, sync의 주인 데이터·주인 표시·사용자 표시는 남김", /지웠어요/.test(gNote) && !Object.keys(l4).some((k) => k.startsWith("guest|")) && hasOwnSync(s4) && s4["ui:owner"] === tagA && l4["ui:who"] === tagB, Object.keys(l4).join());

// 4-2) 사용자를 확인하지 못한 화면에서 '내 데이터 모두 지우기' → local만 지우고 sync 개인 항목은 그대로 (손님일 수도 있어서)
await sw.evaluate(() => chrome.storage.local.set({ "guest|opt|narrow": 1, "cache:e2e-unknown": 1 }));
whoId = null;
await openPanel();
await R.locator(".status-box summary").click();
await R.locator("button.danger", { hasText: "내 데이터 모두 지우기" }).click();
const uFirst = await R.locator(".set-note").innerText().catch(() => "");
await R.locator("button.danger", { hasText: "한 번 더 누르면 지워요" }).click();
await page.waitForTimeout(1200);
const s4u = await store("sync"), l4u = await store("local");
check("사용자 확인 못 함 → 지우기 확인 문구는 학교 데이터만 지운다고, 지운 뒤 sync 개인 항목·주인 표시 그대로", /확인하지 못해서.*학교 데이터\(캐시\)만 지워요/.test(uFirst) && hasOwnSync(s4u) && s4u["ui:owner"] === tagA && !("cache:e2e-unknown" in l4u) && !("guest|opt|narrow" in l4u) && l4u["ui:who"] === tagB, uFirst);
check("사용자 확인 못 함 → 지운 뒤에도 화면엔 sync 일정 그대로 (지우지 않았으므로)", (await calNow()).includes("주인 카페 알바"));

// 5) 주인(1001)이 돌아옴 → 주인 데이터 그대로 보이고, 손님 설정은 지워짐
await sw.evaluate(() => chrome.storage.local.set({ "guest|ev|g2": { t: "손님 남긴 일정", d: "2026-11-30", at: 1 } }));
whoId = "1001";
await openPanel();
const l5 = await store("local");
const backCal = await calNow();
check("주인 복귀 → 주인 일정 그대로 보이고 손님 알림 없음, 넓게 보기(손님 설정 안 섞임)", backCal.includes("주인 카페 알바") && backCal.includes("주인 병원 예약") && !(await warnText()) && (await R.locator("section.panel").evaluate((p) => p.classList.contains("wide"))));
check("주인 복귀 → 손님 설정 지움", !Object.keys(l5).some((k) => k.startsWith("guest|")) && l5["ui:who"] === tagA, Object.keys(l5).join());
check("주인 복귀 → AI로 보낼 내용에 주인 일정 다시 있음", (await aiJson()).includes("주인 병원 예약"));

// 5-2) 주인 화면을 열어 둔 채 다른 탭에서 다른 계정(1002)이 로그인 → 남은 주인 화면은 내 설정을 비우고 저장을 멈추고 새로고침 알림
whoId = "1002";
const page2 = await ctx.newPage();
await page2.goto("https://learn.hansung.ac.kr/");
await page2.waitForTimeout(1500);
await page.waitForTimeout(300);
const staleWarn = await warnText();
check("다른 탭에서 다른 계정 로그인 → 남은 화면에 새로고침 알림 한 줄", /다른 e클래스 계정으로 로그인돼서.*새로고침해 주세요/.test(staleWarn), staleWarn);
check("남은 화면 → 캘린더·AI로 보낼 내용에서 주인 일정 빠짐 (메모리 비움)", !(await calNow()).includes("카페 알바") && !(await aiJson()).includes("병원 예약"));
await R.locator("button.wide-toggle").click(); // 남은 화면에서 설정을 바꿔도
await page.waitForTimeout(900);
const s5s = await store("sync"), l5s = await store("local");
check("남은 화면 → 바꾼 설정을 sync·local 어디에도 쓰지 않음, 주인 sync 그대로", !("opt|narrow" in s5s) && !Object.keys(l5s).some((k) => k.endsWith("opt|narrow")) && hasOwnSync(s5s), Object.keys(s5s).join());
const stNote = await (async () => {
  await R.locator(".status-box summary").click();
  await R.locator("button.danger", { hasText: "내 데이터 모두 지우기" }).click();
  await page.waitForTimeout(200);
  return R.locator(".set-note").innerText().catch(() => "");
})();
check("남은 화면 → '내 데이터 모두 지우기'도 하지 않고 새로고침 안내", /새로고침해 주세요/.test(stNote) && (await R.locator("button.danger", { hasText: "한 번 더 누르면 지워요" }).count()) === 0 && hasOwnSync(await store("sync")), stNote);
await page2.close();
whoId = "1001";
await openPanel(); // 주인이 새로고침 → 다시 주인 화면
check("새로고침 → 다시 주인 화면 (알림 없음, 주인 일정 보임)", !(await warnText()) && (await calNow()).includes("주인 카페 알바"));

// 6) 주인이 '내 데이터 모두 지우기' → 주인 본인의 요청이라 sync 개인 항목까지 (기존 동작), 주인 표시·사용자 표시는 남김
const oNote = await wipeNow();
const s6 = await store("sync"), l6 = await store("local");
check("주인이 지우기 → sync 개인 항목·AI 설치 번호 지우고 주인 표시·사용자 표시는 남김", /지웠어요/.test(oNote) && !OWN_SYNC.some((k) => k in s6) && s6["ui:owner"] === tagA && l6["ui:who"] === tagA && l6["ai:install"] !== "e2e-install-a", Object.keys(s6).join());

// 7) 지운 뒤 주인이 다시 일정을 넣고 → 다른 계정(1003)이 첫 화면: 앞 사람 local 저장본은 지우고, sync는 숨김(보존)
await putOwner();
whoId = "1003";
await openPanel();
const s7 = await store("sync"), l7 = await store("local");
check("지우기 뒤 다른 사용자 로그인 → 앞 사람 local 저장본 지움, 주인 sync는 보존·숨김", hasOwnSync(s7) && l7["ai:install"] !== "e2e-install-a" && !(await calNow()).includes("카페 알바") && /처음 쓴 e클래스 계정이 아니어서/.test(await warnText()), Object.keys(l7).join());
console.log(`\n${pass} passed, ${fail} failed`);
await ctx.close();
process.exit(fail ? 1 : 0);
