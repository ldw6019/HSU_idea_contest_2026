// 동시에 보내는 요청 수를 제한한다 (학교 서버 부담 줄이기)

/** tasks: () => Promise 들의 배열. 최대 n개씩 동시에 실행하고, 결과를 같은 순서로 돌려준다. */
export async function runLimited(tasks, n = 3) {
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      try {
        results[i] = { ok: true, value: await tasks[i]() };
      } catch (error) {
        results[i] = { ok: false, error };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
  return results;
}
