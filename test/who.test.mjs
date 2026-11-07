// 공용 PC: 주인/손님 모드와 사용자 바뀜 (11/7). 실행: node test/who.test.mjs
//  11/7 아침(사용자 결정): sync 개인 항목은 지우지 않고 숨긴다 — 주인이 아니면 손님 모드, 손님 설정은 local "guest|"
import { userTag, switchUser, WHO_KEY, OWNER_KEY, OWNER_HINT_KEY, WIPE_KEEP, GUEST_PREFIX, SYNC_RE } from "../core/who.js";
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => (cond ? pass++ : fail++, console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`));

// chrome.storage.local / sync 흉내 (get(null) = 전부, get(키) = 그 키만)
function area(init = {}, { failRemove = false, failGet = false, failSet = false, log = null, name = "" } = {}) {
  // failSet: true = 늘 실패, 함수 = 부를 때마다 물어봄 (일시 실패 흉내)
  const m = { ...init };
  return {
    m,
    get: async (k) => {
      log?.push(`${name}.get`);
      if (failGet) throw new Error("저장소 오류");
      return k == null ? { ...m } : k in m ? { [k]: m[k] } : {};
    },
    set: async (o) => {
      log?.push(`${name}.set`);
      if (typeof failSet === "function" ? failSet(o) : failSet) throw new Error("QUOTA_BYTES quota exceeded");
      Object.assign(m, o);
    },
    remove: async (ks) => {
      log?.push(`${name}.remove`);
      if (failRemove) throw new Error("저장소 오류");
      for (const k of [].concat(ks)) delete m[k];
    },
  };
}
const A = await userTag("1001");
const B = await userTag("1002");
const C = await userTag("1003");
check("사용자 값: 16자리, 번호와 다름", /^[0-9a-f]{16}$/.test(A) && !A.includes("1001"), A);
check("사용자 값: 같은 번호 → 같은 값, 다른 번호 → 다른 값", A === (await userTag("1001")) && A !== B);
check("주인 표시 키는 sync 개인 항목(지우기 대상)에 걸리지 않음", !SYNC_RE.test(OWNER_KEY) && SYNC_RE.test("ev|x") && SYNC_RE.test("hide|prog:1"));

const OWNER_SYNC = { "ev|a1": { t: "매주 카페 알바" }, "hide|x": 1, "hide|prog:9": 1, "color|운영체제": 3, "opt|narrow": 1, "other|keep": 1 };
// A가 주인이고 이 크롬에서 마지막으로 확인된 사람도 A
const sample = (who = A, owner = A) => ({
  local: area({ "cache:eclass": 1, "cache:course:77": 1, "ai:install": "uuid-a", "ui:hidden": {}, "ui:courseColors": {}, "ui:welcomed": 1, "ui:demo": 1, ...(who ? { [WHO_KEY]: who } : {}) }),
  sync: area({ ...OWNER_SYNC, ...(owner ? { [OWNER_KEY]: owner } : {}) }),
});
const syncUntouched = (s, owner = A) => JSON.stringify(s.sync.m) === JSON.stringify({ ...OWNER_SYNC, [OWNER_KEY]: owner });

// 1) 주인 표시가 없을 때: 처음 확인된 사용자를 주인으로 (기존 데이터를 그대로 그 사람 것으로)
{
  const s = sample(null, null);
  const r = await switchUser(A, s);
  check("주인 표시 없음 → 첫 사용자를 주인으로", r.ownerSet && s.sync.m[OWNER_KEY] === A && !r.guest && !r.changed);
  check("주인 표시 없음 → 아무것도 안 지움, 사용자 표시 남김", s.sync.m["ev|a1"] && s.local.m["ai:install"] && s.local.m["cache:eclass"] && s.local.m[WHO_KEY] === A);
  const again = await switchUser(A, s);
  check("주인이 다시 열면 그대로 (주인 표시 다시 안 씀)", !again.ownerSet && !again.guest && !again.changed && s.sync.m[OWNER_KEY] === A);
}
// 1-2) 11/6판에서 올라온 크롬: 표시는 없고 이 크롬에 확인된 앞 사용자(A)가 있는데 B가 먼저 열면 → 주인은 A (B에게 A 데이터를 넘기지 않음)
{
  const s = sample(A, null);
  const r = await switchUser(B, s);
  check("주인 표시 없음 + 앞 사용자 A, B가 엶 → 주인은 A, B는 손님", s.sync.m[OWNER_KEY] === A && r.guest && r.changed);
  check("그때도 sync 개인 항목은 그대로", s.sync.m["ev|a1"] && s.sync.m["hide|x"] && s.sync.m["color|운영체제"] === 3);
}
// 2) 주인이 같은 크롬을 그대로 씀
{
  const s = sample();
  const r = await switchUser(A, s);
  check("주인 → 손님 아님, 그대로", !r.guest && !r.changed && syncUntouched(s) && Object.keys(s.local.m).length === 8);
}
// 3) 주인 A → 손님 B: sync는 하나도 안 지움, local의 학교 데이터·AI 설치 번호·예전 키만 지움
{
  const s = sample();
  s.local.m["guest|ev|old"] = { t: "남은 손님 일정" };
  const r = await switchUser(B, s);
  check("주인 → 다른 사용자: changed, 손님 모드", r.changed && r.guest);
  check("손님 모드 → sync 개인 항목·주인 표시 그대로 (지우지 않음)", syncUntouched(s), Object.keys(s.sync.m).join());
  check("바뀜 → 학교 데이터 저장본 지움", !s.local.m["cache:eclass"] && !s.local.m["cache:course:77"]);
  check("바뀜 → AI 설치 번호 지움 (새로 만들어짐)", !("ai:install" in s.local.m));
  check("바뀜 → 예전 버전 숨긴 항목·과목 색·남은 손님 설정 지움", !("ui:hidden" in s.local.m) && !("ui:courseColors" in s.local.m) && !("guest|ev|old" in s.local.m));
  check("바뀜 → 시작 안내·시연 모드 표시는 남김", s.local.m["ui:welcomed"] === 1 && s.local.m["ui:demo"] === 1);
  check("바뀜 → 지운 local 개수", r.removedLocal === 6, String(r.removedLocal));
  check("바뀜 → 새 사용자 표시", s.local.m[WHO_KEY] === B);

  // 손님 B가 설정을 만들면 local "guest|…"에 둠 (main.js flushUser와 같은 키 모양) → 같은 손님이 다시 열면 그대로
  s.local.m[`${GUEST_PREFIX}ev|b1`] = { t: "손님 스터디" };
  s.local.m[`${GUEST_PREFIX}hide|y`] = 1;
  s.local.m["cache:eclass"] = "B의 과목";
  const again = await switchUser(B, s);
  check("손님이 다시 열면 → 손님 모드 그대로, 손님 설정 남음", again.guest && !again.changed && s.local.m["guest|ev|b1"] && s.local.m["guest|hide|y"] === 1);

  // 4) 주인 A가 돌아옴 → 주인 데이터 그대로 보이고, 손님 설정·손님 학교 데이터는 지움
  const back = await switchUser(A, s);
  check("주인 복귀 → 손님 아님 (sync 그대로 보임)", back.changed && !back.guest && syncUntouched(s));
  check("주인 복귀 → 손님 설정·학교 데이터 지움", !Object.keys(s.local.m).some((k) => k.startsWith(GUEST_PREFIX)) && !("cache:eclass" in s.local.m), Object.keys(s.local.m).join());
}
// 5) 손님 B → 손님 C: 앞 손님 설정 지움
{
  const s = sample(B, A);
  s.local.m["guest|ev|b1"] = { t: "B 스터디" };
  const r = await switchUser(C, s);
  check("손님 → 다른 손님: 손님 모드, 앞 손님 설정 지움, sync 그대로", r.guest && r.changed && !("guest|ev|b1" in s.local.m) && syncUntouched(s));
}
// 6) 이 크롬엔 표시가 없고(새 기기·다시 설치) 주인 표시가 동기화돼 있음
{
  const s = sample(null, A);
  const r = await switchUser(A, s);
  check("주인의 다른 PC (사용자 표시 없음, 주인 같음) → 주인 모드", !r.guest && !r.changed && syncUntouched(s));
  const s2 = sample(null, A);
  const r2 = await switchUser(B, s2);
  check("주인 계정 크롬을 빌린 친구 (사용자 표시 없음) → 손님 모드, 아무것도 안 지움", r2.guest && !r2.changed && syncUntouched(s2) && s2.local.m["ai:install"] === "uuid-a");
}
// 7) 사용자를 확인하지 못하면(번호 없음) 아무것도 바꾸지 않음 (= sync 그대로 보임)
{
  const s = sample(B, A);
  const r = await switchUser("", s);
  check("사용자 확인 못 함 → 아무것도 안 함 (known false, 손님 아님 = sync 그대로)", !r.known && !r.guest && !r.changed && s.local.m[WHO_KEY] === B && syncUntouched(s) && s.local.m["cache:eclass"]);
  const s2 = sample(null, null);
  await switchUser(null, s2);
  check("사용자 확인 못 함 → 주인 표시도 안 정함", !(OWNER_KEY in s2.sync.m));
}
// 8) local 지우기 실패: 사용자 표시를 바꾸지 않음(다음에 다시), 손님 판단은 그대로, sync 그대로
{
  const s = sample();
  s.local = area(s.local.m, { failRemove: true });
  const r = await switchUser(B, s);
  check("지우기 실패 → clearError, 앞 사용자 표시 그대로 (다음에 다시)", r.clearError && s.local.m[WHO_KEY] === A);
  check("지우기 실패해도 손님 모드 판단 (주인 데이터 안 보임)", r.guest && syncUntouched(s));
}
// 9) 주인 표시를 읽지 못하면 안전하게 손님으로 / 쓰지 못하면 이번엔 기억만
{
  const s = sample();
  s.sync = area(s.sync.m, { failGet: true });
  const r = await switchUser(A, s);
  check("주인 표시 읽기 실패 → 손님으로 (sync 개인 항목 안 보임)", r.guest);
  const s2 = sample(null, null);
  s2.sync = area(s2.sync.m, { failSet: true });
  const r2 = await switchUser(A, s2);
  check("주인 표시 쓰기 실패 → 이번엔 주인으로 보고 다음에 다시 씀", !r2.guest && !r2.ownerSet && !(OWNER_KEY in s2.sync.m));
}
// 9-2) 11/7 검토 3 버그 1: 주인 표시를 sync에 쓰지 못한 채 다른 사람이 이어서 열면 → 손님이 주인이 되던 것
//  11/6판 PC(이 크롬의 앞 사용자 = A, 주인 표시 없음), sync가 가득 차서 주인 표시를 계속 못 씀, A의 일정은 sync에 있음
{
  const s = sample(A, null);
  s.sync = area(s.sync.m, { failSet: true });
  const r1 = await switchUser(B, s);
  check("sync 쓰기 실패 + B 첫 화면 → 손님, 주인 후보 A를 이 크롬(local)에 남김", r1.guest && !r1.ownerSet && s.local.m[OWNER_HINT_KEY] === A && s.local.m[WHO_KEY] === B);
  const r2 = await switchUser(B, s);
  check("sync 쓰기 실패 + 같은 손님 B 새로고침 → 여전히 손님 (전에는 B가 주인이 됨)", r2.guest && !r2.changed && s.local.m[OWNER_HINT_KEY] === A);
  const r3 = await switchUser(A, s);
  check("sync 쓰기 실패 + 주인 A 복귀 → 주인 모드, 주인 후보는 사용자 바뀜에도 남음", !r3.guest && r3.changed && s.local.m[OWNER_HINT_KEY] === A && s.sync.m["ev|a1"] && !(OWNER_KEY in s.sync.m));
}
// 9-3) 일시적 실패 1번만 (B의 첫 화면 때만 sync 쓰기 실패) → 다음에 sync에 쓰는 주인 표시는 처음 주인 A (전에는 B로 굳음)
{
  let n = 0;
  const s = sample(A, null);
  s.sync = area(s.sync.m, { failSet: () => n++ === 0 });
  const r1 = await switchUser(B, s);
  const r2 = await switchUser(B, s);
  check("일시 실패 뒤 성공 → sync 주인 표시 = 처음 주인 A, B는 계속 손님", r1.guest && !r1.ownerSet && r2.guest && r2.ownerSet && s.sync.m[OWNER_KEY] === A, `sync owner=${s.sync.m[OWNER_KEY] === B ? "B" : s.sync.m[OWNER_KEY] === A ? "A" : s.sync.m[OWNER_KEY]}`);
  const r3 = await switchUser(B, s);
  check("그 뒤로는 sync 주인 표시대로 (다시 쓰지 않음)", r3.guest && !r3.ownerSet && s.sync.m[OWNER_KEY] === A);
}
// 10) 11/7 검토 버그 1: 바뀐 것을 안 순간 onSwitch(화면 메모리 비우기)를 저장소를 만지기 전에 한 번 부름
{
  const log = [];
  const s = sample();
  const local = area(s.local.m, { log, name: "local" });
  const sync = area(s.sync.m, { log, name: "sync" });
  const r = await switchUser(B, { local, sync, onSwitch: () => log.push("onSwitch") });
  const first = log.findIndex((x) => x !== "local.get");
  check("바뀜 → onSwitch를 사용자 표시 읽기 다음, 다른 저장소 일보다 먼저 한 번 부름", r.changed && log[first] === "onSwitch" && log.filter((x) => x === "onSwitch").length === 1, log.join(","));
  check("바뀜 → sync는 읽기만 (지우기·쓰기 없음)", !log.includes("sync.remove") && !log.includes("sync.set"), log.join(","));
}
{
  const s = sample();
  s.local = area(s.local.m, { failRemove: true });
  let called = 0;
  await switchUser(B, { ...s, onSwitch: () => called++ });
  check("지우기 실패해도 onSwitch는 이미 불림 (화면엔 앞 사람 데이터가 안 남음)", called === 1);
}
{
  const s = sample();
  let called = 0;
  await switchUser(A, { ...s, onSwitch: () => called++ }); // 같은 사용자
  delete s.local.m[WHO_KEY];
  await switchUser(B, { ...s, onSwitch: () => called++ }); // 이 크롬에 표시 없음
  await switchUser("", { ...s, onSwitch: () => called++ }); // 번호 없음
  check("같은 사용자·표시 없음·번호 없음 → onSwitch 안 부름", called === 0);
}
// 11) "내 데이터 모두 지우기" (content/main.js wipeAll과 같은 방식)
//  local은 사용자 표시(WHO_KEY)만 남기고 다 지움. 주인이면 sync 개인 항목까지(주인 본인의 요청), 손님이면 sync는 안 건드림. 주인 표시는 남김
{
  const wipe = async (s, guest) => {
    await s.local.remove(Object.keys(await s.local.get(null)).filter((k) => !WIPE_KEEP.includes(k)));
    if (!guest) await s.sync.remove(Object.keys(await s.sync.get(null)).filter((k) => SYNC_RE.test(k)));
  };
  // 주인이 누름
  const s = sample();
  const r0 = await switchUser(A, s);
  await wipe(s, r0.guest);
  check("주인이 지우기 → sync 개인 항목 지움, 주인 표시·사용자 표시·다른 키 남김", !Object.keys(s.sync.m).some((k) => SYNC_RE.test(k)) && s.sync.m[OWNER_KEY] === A && s.sync.m["other|keep"] === 1 && s.local.m[WHO_KEY] === A && Object.keys(s.local.m).length === 1, Object.keys(s.sync.m).join());
  // 지운 뒤 바로 다시 불러온 A의 학교 데이터 → 다음 학생 B가 첫 화면
  await s.local.set({ "cache:eclass": "A의 과목", "ai:install": "uuid-a2" });
  await s.sync.set({ "ev|a2": { t: "A가 지운 뒤 넣은 일정" } });
  const r = await switchUser(B, s);
  check("지우기 뒤 다음 학생 → 바뀜을 알고 A의 저장본 지움, B는 손님, A 일정은 sync에 그대로", r.changed && r.guest && !("cache:eclass" in s.local.m) && !("ai:install" in s.local.m) && s.sync.m["ev|a2"] && s.local.m[WHO_KEY] === B);
  // 손님이 누름
  const g = sample(B, A);
  g.local.m["guest|ev|b1"] = { t: "B 스터디" };
  const rg = await switchUser(B, g);
  await wipe(g, rg.guest);
  check("손님이 지우기 → 손님 local 설정·학교 데이터만 지움, sync는 그대로", rg.guest && syncUntouched(g) && !("guest|ev|b1" in g.local.m) && !("cache:eclass" in g.local.m) && g.local.m[WHO_KEY] === B);
  // 주인 후보(sync에 못 쓴 주인 표시)도 남김 → 지운 뒤 새로고침해도 손님 그대로
  const h = sample(A, null);
  h.sync = area(h.sync.m, { failSet: true });
  const rh = await switchUser(B, h);
  await wipe(h, rh.guest);
  const rh2 = await switchUser(B, h);
  check("손님이 지우기 → 주인 후보(local)도 남김, 새로고침해도 손님", rh.guest && h.local.m[OWNER_HINT_KEY] === A && h.local.m[WHO_KEY] === B && rh2.guest);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
