// 캘린더 도우미 (10/19): 시간표 겹침, 구글 캘린더 추가 링크, .ics 파일
// 일정 하나 = { title, start, end?, allDay?, place?, memo?, url?, rrule? }  (start/end는 ISO 또는 Date)
// 화면 없이 계산만 한다 → node로 시험 가능 (test/calendar.test.mjs)

const pad = (n) => String(n).padStart(2, "0");
const minutes = (d) => d.getHours() * 60 + d.getMinutes();

/**
 * 수업 시간표(요일 + 시각)를 "주마다 같은 칸"으로 바꿔 둔다.
 * @param {{start: string, end: string, course?: string, title?: string}[]} classes 종합정보 시간표 항목
 * @returns {{day: number, from: number, to: number, name: string}[]} day: 0=일 … 6=토, 분 단위
 */
export function weeklySlots(classes) {
  return (classes || []).map((c) => {
    const s = new Date(c.start);
    const e = new Date(c.end || c.start);
    return { day: s.getDay(), from: minutes(s), to: minutes(e), name: c.course || c.title || "" };
  });
}

/** 하루 안의 일정(start~end)이 수업과 겹치면 겹치는 수업들, 아니면 [] */
export function clashes(slots, start, end) {
  const s = new Date(start);
  const e = new Date(end || start);
  if (s.toDateString() !== e.toDateString()) return []; // 여러 날 일정은 따지지 않음
  const a = minutes(s);
  const b = Math.max(minutes(e), a + 1);
  return slots.filter((x) => x.day === s.getDay() && x.from < b && a < x.to);
}

/** 매주 일정(요일, "HH:MM"~"HH:MM")이 수업과 겹치는지 */
export function weeklyClashes(slots, weekday, from, to) {
  const m = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const a = m(from);
  const b = m(to);
  return slots.filter((x) => x.day === weekday && x.from < b && a < x.to);
}

// ---------- 구글 캘린더 "일정 추가" 링크 (로그인한 사람의 구글 캘린더에 미리 채운 일정 화면이 열림, 저장은 본인이 누름) ----------
const gDate = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const gDateTime = (d) => `${gDate(d)}T${pad(d.getHours())}${pad(d.getMinutes())}00`;

export function googleLink(ev) {
  const s = new Date(ev.start);
  let dates;
  if (ev.allDay) {
    const e = new Date(ev.end || ev.start);
    const next = new Date(e);
    next.setDate(next.getDate() + 1); // 종일 일정은 끝 날짜 다음 날까지 (구글 규칙)
    dates = `${gDate(s)}/${gDate(next)}`;
  } else {
    const e = ev.end ? new Date(ev.end) : new Date(s.getTime() + 60 * 60000);
    dates = `${gDateTime(s)}/${gDateTime(e)}`;
  }
  const q = new URLSearchParams({ action: "TEMPLATE", text: ev.title || "일정", dates, ctz: "Asia/Seoul" });
  const details = [ev.memo, ev.url].filter(Boolean).join("\n");
  if (details) q.set("details", details);
  if (ev.place) q.set("location", ev.place);
  if (ev.rrule) q.set("recur", `RRULE:${ev.rrule}`);
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

// ---------- .ics (아이폰·삼성·구글·아웃룩 캘린더에서 가져오기) ----------
const icsEscape = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (c) => `\\${c}`);
// 75바이트마다 줄을 접는다 (RFC 5545). 한글은 3바이트라 글자 수로 대충 자르면 깨질 수 있어 바이트로 센다
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = "";
  for (const ch of line) {
    if (enc.encode(cur + ch).length > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}
const icsLocal = (d) => `${gDate(d)}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
const icsUtc = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** 일정들 → .ics 글. uid가 같으면 다시 가져와도 같은 일정으로 덮어쓴다 */
export function buildIcs(events, now = new Date()) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//HSU PLUS//KO", "CALSCALE:GREGORIAN", "X-WR-CALNAME:HSU PLUS", "X-WR-TIMEZONE:Asia/Seoul"];
  // 한국은 서머타임이 없어 고정 +09:00 한 줄이면 된다
  lines.push("BEGIN:VTIMEZONE", "TZID:Asia/Seoul", "BEGIN:STANDARD", "DTSTART:19700101T000000", "TZOFFSETFROM:+0900", "TZOFFSETTO:+0900", "TZNAME:KST", "END:STANDARD", "END:VTIMEZONE");
  for (const ev of events) {
    const s = new Date(ev.start);
    lines.push("BEGIN:VEVENT", `UID:${ev.uid || `${icsUtc(s)}-${Math.random().toString(36).slice(2)}`}@hsuplus`, `DTSTAMP:${icsUtc(now)}`);
    if (ev.allDay) {
      const e = new Date(ev.end || ev.start);
      e.setDate(e.getDate() + 1);
      lines.push(`DTSTART;VALUE=DATE:${gDate(s)}`, `DTEND;VALUE=DATE:${gDate(e)}`);
    } else {
      const e = ev.end ? new Date(ev.end) : new Date(s.getTime() + 60 * 60000);
      lines.push(`DTSTART;TZID=Asia/Seoul:${icsLocal(s)}`, `DTEND;TZID=Asia/Seoul:${icsLocal(e)}`);
    }
    if (ev.rrule) lines.push(`RRULE:${ev.rrule}`);
    lines.push(`SUMMARY:${icsEscape(ev.title)}`);
    if (ev.place) lines.push(`LOCATION:${icsEscape(ev.place)}`);
    const desc = [ev.memo, ev.url].filter(Boolean).join("\n");
    if (desc) lines.push(`DESCRIPTION:${icsEscape(desc)}`);
    if (ev.url) lines.push(`URL:${ev.url}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** 매주 n회 → RRULE (예: 수요일 4회) */
export const weeklyRule = (times) => `FREQ=WEEKLY;COUNT=${times}`;
