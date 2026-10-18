// 비교과 포인트 계산 (10/19 사용자 설명)
//  - 한 학기에 졸업 인정으로 쌓이는 건 최대 200점
//  - 넘친 점수는 다음 학기로 최대 200점까지 이월, 그보다 넘치면 소멸
//  - 이월된 점수는 다음 학기가 시작되면 그 학기의 200점 칸을 먼저 채운다
//    예) 3-1에 400점 → 3-1에 200, 3-2 시작하자마자 200 (3-2 칸이 이미 다 참)
//        3-2에 100점 더 모으면 → 3-2는 이미 200이라 100점은 3-3으로 이월
// 학기 구분은 1학기 3/1~8/31, 2학기 9/1~다음 해 2월 말로 본다.
//  (10/19 확인: 학교 화면의 "이번학기 취득" = 9/1부터의 내역 합계. 1학기 시작일 3/1은 추정)

export const SEM_CAP = 200; // 한 학기 인정 한도
export const CARRY_CAP = 200; // 이월 한도
export const GRAD_POINTS = 800; // 졸업 요건 (사용자 확인, 학과·학번마다 다를 수 있음)

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** 날짜가 속한 학기 { year, term: 1|2, label, from, to } (from·to는 "YYYY-MM-DD", to는 다음 학기 첫날) */
export function semesterOf(date = new Date()) {
  const d = new Date(date);
  const m = d.getMonth() + 1;
  const y = m <= 2 ? d.getFullYear() - 1 : d.getFullYear();
  const term = m >= 3 && m <= 8 ? 1 : 2;
  const from = term === 1 ? `${y}-03-01` : `${y}-09-01`;
  const to = term === 1 ? `${y}-09-01` : `${y + 1}-03-01`;
  return { year: y, term, label: `${y}-${term}학기`, from, to };
}
/** 바로 전 학기 */
export function prevSemester(sem) {
  return sem.term === 2 ? semesterOf(`${sem.year}-05-01T12:00:00`) : semesterOf(`${sem.year - 1}-10-01T12:00:00`);
}
const sumIn = (history, sem) => (history || []).filter((r) => r.date >= sem.from && r.date < sem.to).reduce((a, r) => a + (r.change || 0), 0);

/**
 * 학교 포인트 화면 6칸 + 내역 → 화면에 보여줄 숫자
 * @param {{semester?, carriedIn?, carryOut?, expired?, total?, graduation?, history?}} pt
 */
export function pointSummary(pt, now = new Date()) {
  const sem = semesterOf(now);
  const prev = prevSemester(sem);
  // history가 없으면(예전 캐시) 모름 → null, 빈 배열이면 모은 점수 0
  const hasHistory = Array.isArray(pt.history);
  // 이번 학기에 실제로 모은 점수 (한도와 상관없이). 학교 칸과 내역 합계 중 큰 값 (학교 칸이 한도로 잘려 있을 수도 있어서)
  const earned = Math.max(pt.semester ?? 0, hasHistory ? sumIn(pt.history, sem) : 0);
  const prevEarned = hasHistory ? sumIn(pt.history, prev) : null;
  const carryIn = pt.carriedIn ?? 0;
  // 이월이 이번 학기 칸을 먼저 채우고, 이번 학기에 모은 점수가 나머지를 채운다
  const recognized = Math.min(SEM_CAP, carryIn + earned);
  const fromCarry = Math.min(SEM_CAP, carryIn);
  const fromEarned = recognized - fromCarry;
  const overflow = Math.max(0, carryIn + earned - SEM_CAP);
  const carryOut = Math.min(CARRY_CAP, overflow);
  const lost = Math.max(0, overflow - CARRY_CAP);
  const graduation = pt.graduation ?? pt.total ?? 0;
  return {
    sem,
    prev,
    earned,
    prevEarned,
    carryIn,
    recognized,
    fromCarry,
    fromEarned,
    room: SEM_CAP - recognized, // 이번 학기에 더 모으면 바로 인정되는 점수
    carryRoom: Math.max(0, CARRY_CAP - carryOut), // 그다음 이월될 수 있는 점수
    overflow,
    carryOut,
    lost,
    total: pt.total ?? null,
    graduation,
    toGraduate: Math.max(0, GRAD_POINTS - graduation),
    done: graduation >= GRAD_POINTS,
    schoolCarryOut: pt.carryOut ?? null, // 학교 화면 값 (학기 끝에 정해질 수 있음)
    schoolExpired: pt.expired ?? null,
    recent: hasHistory ? [...pt.history].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5) : [],
  };
}
