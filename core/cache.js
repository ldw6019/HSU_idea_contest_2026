// 캐시: 불러온 데이터를 chrome.storage.local에 저장해 두고,
// 유효 시간 안이면 학교 사이트에 다시 요청하지 않고 바로 돌려준다.
// (학교 서버 부담을 줄이고, 패널을 다시 열 때 바로 뜨게 하려는 목적)

const PREFIX = "cache:";

export const TTL = Object.freeze({
  TIMETABLE: 24 * 60 * 60 * 1000, // 시간표: 하루 (학기 중 거의 안 바뀜)
});

/** 저장된 값 꺼내기. 없으면 null. { data, fetchedAt } */
export async function read(key) {
  const k = PREFIX + key;
  const got = await chrome.storage.local.get(k);
  return got[k] || null;
}

export async function write(key, data) {
  const entry = { data, fetchedAt: Date.now() };
  await chrome.storage.local.set({ [PREFIX + key]: entry });
  return entry;
}

/**
 * 캐시가 유효하면 캐시를, 아니면 fetcher로 새로 받아 저장해서 돌려준다.
 * 새로 받기에 실패했는데 예전 캐시가 있으면, 예전 캐시와 오류를 함께 돌려준다.
 * @returns {Promise<{data, fetchedAt, fromCache: boolean, error?: Error}>}
 */
export async function getOrFetch(key, ttl, fetcher, { force = false } = {}) {
  const cached = await read(key);
  const fresh = cached && Date.now() - cached.fetchedAt < ttl;
  if (cached && fresh && !force) return { ...cached, fromCache: true };

  try {
    const data = await fetcher();
    const entry = await write(key, data);
    return { ...entry, fromCache: false };
  } catch (error) {
    if (cached) return { ...cached, fromCache: true, error };
    throw error;
  }
}

/** 이 확장이 저장한 캐시를 모두 지운다 ("데이터 지우기"용) */
export async function clearAll() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith(PREFIX));
  if (keys.length) await chrome.storage.local.remove(keys);
  return keys.length;
}
