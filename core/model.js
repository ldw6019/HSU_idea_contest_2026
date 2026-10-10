// 공통 데이터 형식
// 세 사이트(e클래스·비교과·종합정보)의 데이터를 모두 이 모양으로 바꿔서 쓴다.
// 화면(이번 주, 캘린더)은 사이트를 신경 쓰지 않고 이 목록만 정렬해서 그리면 된다.

export const SOURCE = Object.freeze({
  ECLASS: "eclass",
  HSPORTAL: "hsportal",
  INFO: "info",
});

export const TYPE = Object.freeze({
  CLASS: "class", // 수업 (시간표)
  ASSIGNMENT: "assignment", // 과제
  VIDEO: "video", // 강의 영상
  PROGRAM: "program", // 비교과 프로그램
});

export const STATUS = Object.freeze({
  TODO: "todo", // 해야 함 / 예정
  DONE: "done", // 완료
  LATE: "late", // 늦게 완료
  MISSED: "missed", // 놓침
});

/**
 * 공통 항목을 만든다. 날짜는 ISO 문자열로 저장한다(캐시에 그대로 넣을 수 있게).
 * @param {object} p
 * @param {string} p.source  SOURCE 값
 * @param {string} p.type    TYPE 값
 * @param {string} p.title   화면에 보일 제목
 * @param {string} [p.course]     과목명
 * @param {string} [p.place]      장소
 * @param {string} [p.professor]  교수
 * @param {Date|string} [p.start] 시작 시각
 * @param {Date|string} [p.end]   끝 시각
 * @param {Date|string} [p.due]   마감 시각
 * @param {string} [p.status]     STATUS 값
 * @param {string} [p.url]        원래 페이지 주소
 */
export function makeItem(p) {
  const iso = (v) => (v ? new Date(v).toISOString() : null);
  return {
    id: p.id || `${p.source}:${p.type}:${p.title}:${iso(p.start) || iso(p.due) || ""}`,
    source: p.source,
    type: p.type,
    title: p.title || "(제목 없음)",
    course: p.course || null,
    place: p.place || null,
    professor: p.professor || null,
    start: iso(p.start),
    end: iso(p.end),
    due: iso(p.due),
    status: p.status || STATUS.TODO,
    url: p.url || null,
  };
}

/** 항목의 기준 시각 (정렬용): 시작 시각, 없으면 마감 시각 */
export function sortTime(item) {
  return new Date(item.start || item.due || 0).getTime();
}

/** 이번 주 월요일 00:00 ~ 다음 주 월요일 00:00 */
export function thisWeekRange(now = new Date()) {
  const start = new Date(now);
  const day = (start.getDay() + 6) % 7; // 월=0 … 일=6
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - day);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
}
