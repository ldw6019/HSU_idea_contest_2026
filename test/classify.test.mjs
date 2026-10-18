// 규칙 분류 정답률 (node test/classify.test.mjs). 정답표: test/golden-programs.json
import { readFileSync } from "node:fs";
import { classifyProgram } from "../core/classify.js";

process.env.TZ ||= "Asia/Seoul";
const g = JSON.parse(readFileSync(new URL("./golden-programs.json", import.meta.url), "utf8"));
const now = new Date(g.now);
let ok = 0;
const rows = [];
for (const c of g.cases) {
  const sessions = c.sessions.map(([name, start, end]) => ({ name, start: `${start}:00+09:00`, end: `${end}:00+09:00` }));
  const r = classifyProgram({ title: c.title, text: c.text, sessions, pick: c.pick }, now);
  const e = c.expected;
  const bad = [];
  if (r.category !== e.category) bad.push(`분류 ${r.category} (정답 ${e.category})`);
  if ("multi" in e && r.multi !== e.multi) bad.push(`여러 회차 ${r.multi} (정답 ${e.multi})`);
  if ("online" in e && r.online !== e.online) bad.push(`온라인 ${r.online} (정답 ${e.online})`);
  if (e.recurringTimes && r.recurring?.times !== e.recurringTimes) bad.push(`매주 횟수 ${r.recurring?.times}`);
  if (!bad.length) ok++;
  rows.push(`${bad.length ? "FAIL" : "PASS"} ${c.id} ${c.title.slice(0, 26)} → ${r.category}${bad.length ? " — " + bad.join(", ") : ""}`);
}
console.log(rows.join("\n"));
console.log(`\n규칙 분류 ${ok}/${g.cases.length} 맞음`);
process.exit(ok === g.cases.length ? 0 : 1);
