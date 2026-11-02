// 아이콘 만들기: 화면의 "+" 로고와 같은 모양 (학교 로고 아님). node tools/make-icons.mjs icons
import { chromium } from "playwright";
const out = process.argv[2];
const svg = (s) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24">
<rect x="0.5" y="0.5" width="23" height="23" rx="5.5" fill="#0b4ea2"/>
<rect x="10.25" y="4.5" width="3.5" height="15" rx="1.75" fill="#fff"/><rect x="4.5" y="10.25" width="15" height="3.5" rx="1.75" fill="#fff"/></svg>`;
const b = await chromium.launch(); const p = await b.newPage();
for (const s of [16, 32, 48, 128]) {
  await p.setViewportSize({ width: s, height: s });
  await p.setContent(`<html><body style="margin:0;background:transparent">${svg(s)}</body></html>`);
  await p.locator("svg").screenshot({ path: `${out}/icon${s}.png`, omitBackground: true });
}
await b.close();
