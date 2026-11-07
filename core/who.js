// 공용 PC: 이 크롬의 '주인'이 아닌 e클래스 계정이면 주인의 개인 설정을 숨기고(지우지 않음), 손님 설정은 이 기기에만 잠깐 둔다
//
// 11/6: 사용자가 바뀌면 학교에서 불러온 정보(cache:)만 지웠음
// 11/7 새벽(검토): 직접 넣은 일정·숨긴 항목(chrome.storage.sync)과 AI 설치 번호가 남아서 다음 학생 화면·AI 질문에 섞였음
//  → 처음엔 sync까지 지웠는데, 친구가 내 크롬을 잠깐 빌려도 내 모든 기기에서 지워지고 되돌릴 수 없었음
// 11/7 아침(사용자 결정): "지우기" 대신 "숨기기". sync의 개인 항목은 아무것도 지우지 않는다
//  - 주인 표시(OWNER_KEY, sync): 이 크롬 프로필(같은 구글 계정으로 동기화되는 크롬들)의 주인 e클래스 사용자 값
//    아직 없으면 처음 확인된 사용자를 주인으로 정한다 (기존 데이터를 그대로 그 사람 것으로)
//  - 지금 사용자 ≠ 주인 → 손님 모드: sync 개인 항목(ev|·hide|·color|·opt|)을 읽지 않고, 손님 설정은 local의 "guest|…"에 둔다
//    주인이 다시 로그인하면 sync가 그대로 보인다 (같은 사람의 다른 PC도 주인 표시가 같아서 그대로)
//  - 이 크롬(local)의 앞 사용자 표시(WHO_KEY)와 다르면 "바뀜": 학교 데이터 저장본(cache:)·손님 설정(guest|)·AI 설치 번호·예전 키를 지운다
//    지우다 실패하면 WHO_KEY를 바꾸지 않아서 다음에 다시 지운다
//  - 번호를 못 찾으면(사용자 메뉴 링크 없음) 아무것도 바꾸지 않는다 (= 지금처럼 sync가 보임). 시연 모드는 이 확인을 하지 않는다
//  - "내 데이터 모두 지우기"는 WHO_KEY·OWNER_KEY·OWNER_HINT_KEY를 남긴다 (전에는 표시까지 지워서, 지운 뒤 다음 학생이 "처음 쓰는 크롬"으로 보였음)
// 11/7 검토 3 버그 1: 주인 표시를 sync에 쓰지 못하면(sync가 가득 참 등) "이번엔 기억만" 했는데, 다음에 열 때 WHO_KEY가 이미 손님 값이라
//  손님이 주인이 됐음 → 쓰지 못한 주인 후보를 local OWNER_HINT_KEY에 남기고, 판단은 sync 주인 표시 || local 후보 || 앞 사용자 || 지금 사용자
//  OWNER_HINT_KEY는 사용자가 바뀌어도 지우지 않는다 (LOCAL_RE에 걸리지 않는 이름)
// e클래스 사용자 번호는 저장하지 않고, 되돌릴 수 없는 짧은 값(해시)만 저장·비교한다

export const WHO_KEY = "ui:who"; // local: 이 크롬에서 마지막으로 확인된 사용자
export const OWNER_KEY = "ui:owner"; // sync: 이 크롬 프로필의 주인 (sync 개인 항목 SYNC_RE에 걸리지 않는 이름)
export const OWNER_HINT_KEY = "ui:ownerHint"; // local: sync에 쓰지 못한 주인 후보 (sync에 주인 표시가 없을 때만 씀. 사용자가 바뀌어도·모두 지우기에도 남김)
export const WIPE_KEEP = [WHO_KEY, OWNER_HINT_KEY]; // '내 데이터 모두 지우기'에서 남길 local 키
export const GUEST_PREFIX = "guest|"; // local: 손님 설정 ("guest|ev|id", "guest|hide|id" …)
export const SYNC_RE = /^(hide|color|ev|opt)\|/; // sync 개인 항목: 숨긴 항목(내 비교과 숨김 prog: 포함), 과목 색, 직접 넣은 일정, 화면 옵션
const LOCAL_RE = /^(cache:|guest\||ai:install$|ui:hidden$|ui:courseColors$)/; // 사용자가 바뀌면 지울 local: 학교 데이터 저장본, 손님 설정, AI 설치 번호, 예전 버전의 숨긴 항목·과목 색

/** e클래스 사용자 번호 → 비교용 짧은 값 (번호 자체는 저장하지 않음) */
export async function userTag(id) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`hsuplus-who:${id}`));
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 지금 사용자 값(tag)으로 주인/손님을 정하고, 이 크롬의 앞 사용자와 다르면 앞 사람의 local 저장본을 지운다. sync는 지우지 않는다.
 * onSwitch: 바뀐 것을 안 순간, 저장소를 만지기 **전에** 한 번 부른다 (화면 메모리부터 비우라고. 11/7 검토 버그 1)
 * 사용자 값이 없으면 아무것도 하지 않는다 (known: false → 부르는 쪽은 지금처럼 sync를 쓴다)
 * @returns {Promise<{ known: boolean, changed: boolean, guest: boolean, ownerSet: boolean, removedLocal: number, clearError: any }>}
 *  guest: 손님 모드 (sync 개인 항목을 쓰지 말 것). 주인 표시를 읽지 못하면 안전하게 손님으로 본다
 *  clearError: 앞 사람 local 저장본을 지우다 실패 (WHO_KEY는 그대로 → 다음에 다시)
 */
export async function switchUser(tag, { local = chrome.storage.local, sync = chrome.storage.sync, onSwitch = null } = {}) {
  const out = { known: false, changed: false, guest: false, ownerSet: false, removedLocal: 0, clearError: null };
  if (!tag) return out;
  const { [WHO_KEY]: prev } = await local.get(WHO_KEY);
  out.known = true;
  out.changed = !!prev && prev !== tag;
  if (out.changed) onSwitch?.();
  // 주인 정하기: 표시가 없으면 처음 확인된 사용자 = 이 크롬에 이미 확인된 앞 사용자(prev)가 있으면 그 사람, 없으면 지금 사용자
  //  (11/6판에서 올라온 공용 PC: sync에 있는 것은 prev의 데이터일 가능성이 커서, 지금 사용자에게 넘기지 않는다)
  //  전에 sync에 쓰지 못한 주인 후보(local OWNER_HINT_KEY)가 있으면 prev보다 먼저 (prev는 그 사이 손님 값으로 바뀌었을 수 있음. 검토 3 버그 1)
  try {
    let { [OWNER_KEY]: owner } = await sync.get(OWNER_KEY);
    if (typeof owner !== "string" || !owner) {
      let hint = null;
      try {
        hint = (await local.get(OWNER_HINT_KEY))[OWNER_HINT_KEY];
      } catch {}
      owner = (typeof hint === "string" && hint) || prev || tag;
      try {
        await sync.set({ [OWNER_KEY]: owner });
        out.ownerSet = true;
      } catch {
        // 못 쓰면 이 크롬(local)에 후보로 남기고 다음에 다시 sync에 쓴다
        if (owner !== hint) {
          try {
            await local.set({ [OWNER_HINT_KEY]: owner });
          } catch {}
        }
      }
    }
    out.guest = owner !== tag;
  } catch {
    out.guest = true; // 주인을 알 수 없음 → sync 개인 항목을 보이지 않는 쪽으로
  }
  if (out.changed) {
    try {
      const lk = Object.keys(await local.get(null)).filter((k) => LOCAL_RE.test(k));
      if (lk.length) await local.remove(lk);
      out.removedLocal = lk.length;
    } catch (e) {
      out.clearError = e || new Error("지우기 실패");
      return out; // WHO_KEY를 바꾸지 않음 → 다음에 열 때 다시 지움
    }
  }
  if (prev !== tag) {
    try {
      await local.set({ [WHO_KEY]: tag });
    } catch {}
  }
  return out;
}
