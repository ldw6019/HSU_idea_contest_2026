// 시연 모드 데이터 (10/21): 실제 e클래스 화면 위에서 학교 데이터만 가짜로 바꿔 보여 준다.
//  README 그림·시연 영상·발표 화면에 내 과목·과제·포인트가 나오지 않게. 글꼴·배경은 실제 화면 그대로.
//  학교 사이트에는 요청하지 않는다 (모든 화면을 여기 HTML로 대신 → 확장의 읽기 코드가 그대로 동작해서 실제와 같은 결과)
//  날짜는 "지금" 기준으로 만들어서 언제 켜도 비슷한 화면이 나온다.
//  브라우저·Node 둘 다에서 쓴다 (tools/screenshots.mjs도 같은 데이터를 씀) → chrome API를 쓰지 않는다.

export function buildDemo(now = new Date()) {
  // ---------- 날짜 도우미 ----------
  const p2 = (n) => String(n).padStart(2, "0");
  const rel = (days, h = 23, m = 59) => { const d = new Date(now); d.setDate(d.getDate() + days); d.setHours(h, m, 0, 0); return d; };
  const soon = (min) => new Date(now.getTime() + min * 60000);
  const ymdhm = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  const D = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const kd = (x, sep = ".") => `${x.getFullYear()}${sep}${p2(x.getMonth() + 1)}${sep}${p2(x.getDate())}(${D[x.getDay()]}) ${p2(x.getHours())}:${p2(x.getMinutes())}`;
  const iso = (x) => `${x.getFullYear()}-${p2(x.getMonth() + 1)}-${p2(x.getDate())}`;
  const mon = new Date(now); mon.setHours(0, 0, 0, 0); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
  const wk = (off, h, m) => { const x = new Date(mon); x.setDate(x.getDate() + off); x.setHours(h, m, 0, 0); return x; };
  const kt = (x) => `${iso(x)}T${p2(x.getHours())}:${p2(x.getMinutes())}:00+09:00`;

  // ---------- e클래스 ----------
  const COURSES = { 11: "데이터베이스[N]", 22: "운영체제[A,N]", 33: "클라우드 컴퓨팅[A]", 44: "컴퓨터 네트워크[B]" };
  // [cmid, 제목, 시작, 끝, 길이, 들은 시간, 출석]
  const VIDEOS = {
    11: [["101", "6주차 정규화", rel(-9, 0, 0), rel(-2), "46:36", "46:37", true], ["102", "7주차 트랜잭션", rel(-2, 0, 0), rel(5), "53:22", "21:30", false]],
    22: [["201", "수업 전에 듣고 올 강의", rel(-1, 0, 0), soon(25), "40:00", "00:03", false], ["202", "7주차 스케줄링", rel(-2, 0, 0), rel(4), "35:48", "12:10", false]],
    33: [["301", "S3 데이터 파이프라인", rel(-3, 0, 0), rel(2), "37:23", "00:00", false], ["302", "8주차 컨테이너", rel(5, 0, 0), rel(12), "30:00", "00:00", false]],
  };
  // [cmid, 제목, 마감, 제출 여부, 제출 시각]
  const ASSIGNS = {
    11: [["501", "ERD 설계 과제", rel(1), false], ["502", "2주차 실습", rel(-3, 23, 55), true, rel(-4, 17, 4)]],
    22: [["511", "스케줄러 구현", rel(3), false]],
    44: [["521", "소켓 프로그래밍", rel(8), false], ["522", "패킷 분석 보고서", rel(16), false]],
  };
  const QUIZZES = { 33: [["601", "6주차 퀴즈", rel(2), false]] };

  const mainPage = `<html><body id="page-site-index"><a>로그아웃</a><h2>강좌 전체보기</h2><ul class="my-course-lists">${Object.entries(COURSES)
    .map(([id, n]) => `<li><a class="course_link" href="/course/view.php?id=${id}"><div class="course-label"><span class="label-course">교과</span></div><div class="course-title"><h3>${n}</h3></div></a></li>`)
    .join("")}</ul></body></html>`;
  const vli = ([cm, n, f, t, len]) => `<li class="activity vod modtype_vod" id="module-${cm}"><div><div class="mod-indent-outer"><div class="mod-indent"></div><div><div class="activityinstance"><a href="/mod/vod/view.php?id=${cm}"><span class="activityicon" style="display:inline-block;width:22px;height:22px;border-radius:50%;background:#8b93a1;vertical-align:middle;margin-right:6px"></span><span class="instancename">${n}<span class="accesshide"> 동영상</span></span></a> <span class="displayoptions"><span class="text-ubstrap">${ymdhm(f)}:00 ~ ${ymdhm(t)}:59</span>, <span class="text-info">${len}</span></span></div></div></div></div></li>`;
  const tli = (cm, n, type) => `<li class="activity ${type} modtype_${type}" id="module-${cm}"><div><div class="mod-indent-outer"><div class="mod-indent"></div><div><div class="activityinstance"><a href="/mod/${type}/view.php?id=${cm}"><span class="activityicon" style="display:inline-block;width:22px;height:22px;border-radius:50%;background:#8b93a1;vertical-align:middle;margin-right:6px"></span><span class="instancename">${n}</span></a></div></div></div></div></li>`;
  const coursePage = (id) => `<html><body id="page-course-view-weeks" style="font-family:'Noto Sans KR',sans-serif;padding:16px 24px"><h2>${COURSES[id]}</h2><div class="total_sections"><h3>주차 목록</h3><ul class="section img-text" style="list-style:none;padding-left:8px">${(VIDEOS[id] || []).map(vli).join("")}${(ASSIGNS[id] || []).map(([cm, n]) => tli(cm, n, "assign")).join("")}${(QUIZZES[id] || []).map(([cm, n]) => tli(cm, n, "quiz")).join("")}</ul></div></body></html>`;
  const progressPage = (id) => `<html><body><table class="user_progress_table"><tbody>${(VIDEOS[id] || []).map(([, n, , , , learned, ok], i) => `<tr><td>${i + 1}</td><td class="text-left">${n}</td><td>${learned}</td><td>${ok ? "O" : "X"}</td><td>-</td></tr>`).join("")}</tbody></table></body></html>`;
  const assignIndex = (id) => `<html><body><table class="generaltable"><tbody>${(ASSIGNS[id] || []).map(([cm, n, due, done]) => `<tr><td class="c0">7주</td><td class="c1"><a href="https://learn.hansung.ac.kr/mod/assign/view.php?id=${cm}">${n}</a></td><td class="c2">${ymdhm(due)}</td><td class="c3">${done ? "제출 완료" : "미제출"}</td><td class="c4">-</td></tr>`).join("")}</tbody></table></body></html>`;
  const assignView = (cm) => { const a = Object.values(ASSIGNS).flat().find((x) => x[0] === cm); return `<html><body><table class="generaltable"><tr><th>제출 여부</th><td>${a?.[3] ? "제출 완료" : "미제출"}</td></tr><tr><th>최종 수정 일시</th><td>${a?.[4] ? ymdhm(a[4]) : "-"}</td></tr></table></body></html>`; };
  const quizIndex = (id) => `<html><body><table class="generaltable"><tbody>${(QUIZZES[id] || []).map(([cm, n, due]) => `<tr><td class="c0">7주</td><td class="c1"><a href="https://learn.hansung.ac.kr/mod/quiz/view.php?id=${cm}">${n}</a></td><td class="c2">${ymdhm(due)}</td><td class="c3">-</td></tr>`).join("")}</tbody></table></body></html>`;

  /** e클래스 주소 → 가짜 HTML (경로 + ?id=) */
  function learnHtml(url) {
    const u = new URL(url, "https://learn.hansung.ac.kr");
    const id = u.searchParams.get("id");
    if (u.pathname === "/course/view.php") return coursePage(id);
    if (u.pathname.includes("progress.php")) return progressPage(id);
    if (u.pathname === "/mod/assign/index.php") return assignIndex(id);
    if (u.pathname === "/mod/assign/view.php") return assignView(id);
    if (u.pathname === "/mod/quiz/index.php") return quizIndex(id);
    if (u.pathname.startsWith("/mod/")) return "<html><body></body></html>";
    return mainPage;
  }

  // ---------- 종합정보 시간표 ----------
  const tt = [
    { id: "1", start: wk(0, 15, 0), end: wk(0, 16, 30), title: "클라우드 컴퓨팅(A)<br>교수<br>공학관 314" },
    { id: "2", start: wk(1, 10, 30), end: wk(1, 12, 0), title: "운영체제(N)<br>교수<br>상상관 303" },
    { id: "3", start: wk(2, 18, 0), end: wk(2, 19, 25), title: "데이터베이스(N)<br>교수<br>공학관 407" },
    { id: "4", start: wk(3, 10, 30), end: wk(3, 12, 0), title: "운영체제(N)<br>교수<br>상상관 303" },
    { id: "5", start: wk(4, 13, 0), end: wk(4, 15, 0), title: "컴퓨터 네트워크(B)<br>교수<br>공학관 404" },
  ].map((e) => ({ ...e, start: `${iso(e.start)}T${p2(e.start.getHours())}:${p2(e.start.getMinutes())}:00`, end: `${iso(e.end)}T${p2(e.end.getHours())}:${p2(e.end.getMinutes())}:00` }));

  // ---------- 비교과 (스마트자기관리시스템) ----------
  const row = ({ id, cat, dept, title, at, place, mileage = "0", status = "", iss = "", poll, cert }) => `<li class="tbody application_list"><span class="loopnum">1</span><span class="title"><p>[${cat}]<i></i></p><span>[${dept}]</span><a href="/ko/mypage/programs/view/${id}?p=1">${title}</a><span class="date"><p><i class="mi mi-calendar"></i><time>${at ? kd(at, "-") : ""}</time></p><p><i class="xi xi-map-marker"></i>${place || ""}</p></span></span><span class="mileage">${mileage} 점</span><span class="status">${status}</span>${iss ? `<span class="issuance_status">${iss}</span>` : ""}<span class="complete"><ul>${poll ? `<li><button data-action="poll" data-pidx="${id}" data-tidx="9${id}">설문조사</button></li><li><button ${cert ? "" : "disabled"}>교육확인증</button></li>` : "<li><button>신청서수정</button></li>"}</ul></span></li>`;
  const listPage = (rows) => `<html><body><a href="/ko/mypage">마이페이지</a><ul class="black inner"><li class="thead"><span class="title">프로그램명</span></li>${rows.join("")}</ul></body></html>`;
  const viewPage = (sessions) => `<html><body><ul class="black inner"><li class="thead"><span class="title">프로그램 일정</span><span class="status">상태</span><span class="button">비고</span></li>${sessions.map(([n, s, e]) => `<li class="tbody"><span class="title"><b>${n}</b><p><time>${kd(s)}</time> ~ <time>${kd(e)}</time></p></span><span class="status">참여승인</span></li>`).join("")}</ul></body></html>`;
  const MY = {
    wait: [
      { id: 101, cat: "학습역량강화 특강·워크숍", dept: "교육혁신처", title: "학습법 워크숍: AI 활용 학습법", at: rel(2, 15, 30), place: "", status: "참여승인", sessions: [["1차 AI 활용 학습법", rel(2, 15, 30), rel(2, 17, 30)], ["2차 시간 관리", rel(9, 15, 30), rel(9, 17, 30)]] },
      { id: 102, cat: "진로·취업지원 특강", dept: "학생진로취업처", title: "현직자 특강: 백엔드 개발자의 하루", at: rel(1, 18, 30), place: "상상관 B101", status: "참여승인", sessions: [["현직자 특강", rel(1, 18, 30), rel(1, 20, 0)]] },
    ],
    progress: [
      { id: 201, cat: "진로·취업지원 소모임·멘토", dept: "학생진로취업처", title: "진로 멘토링: 웹 서버 미니 프로젝트", at: rel(-20, 9, 0), place: "블렌디드", sessions: [["멘토링", rel(-20, 9, 0), rel(40, 23, 45)]] },
      { id: 202, cat: "상담·심리지원 특강", dept: "학생진로취업처", title: "중독예방 통합교육", at: rel(-20, 0, 0), place: "온라인", sessions: [["중독예방", rel(-20, 0, 0), rel(60, 23, 45)]] },
    ],
    complete: [
      { id: 301, cat: "학습역량강화 특강", dept: "학술정보관", title: "전자정보박람회", iss: "이수처리중", poll: "on", answered: true },
      { id: 302, cat: "비교과 봉사", dept: "학생복지팀", title: "가을 캠퍼스 플로깅", mileage: "5", iss: `이수${iso(rel(-5, 0, 0))}`, poll: "on", cert: true, answered: false },
    ],
  };
  const pages = {};
  for (const k of ["wait", "progress", "complete"]) pages[`/ko/mypage/programs/list/${k}/1`] = listPage(MY[k].map(row));
  for (const x of [...MY.wait, ...MY.progress]) pages[`/ko/mypage/programs/view/${x.id}`] = viewPage(x.sessions);
  for (const x of MY.complete) pages[`/ko/module/eco/@poll/write/${x.id}/9${x.id}`] = `<html><body><form><label><input type="radio" name="q1" ${x.answered ? "checked" : ""}>그렇다</label><label><input type="radio" name="q1">아니다</label></form></body></html>`;
  const semStart = now.getMonth() >= 8 || now.getMonth() < 2 ? new Date(now.getMonth() < 2 ? now.getFullYear() - 1 : now.getFullYear(), 8, 3) : new Date(now.getFullYear(), 2, 3);
  const prevSem = new Date(semStart); prevSem.setMonth(prevSem.getMonth() - 4);
  const prevSem2 = new Date(semStart); prevSem2.setMonth(prevSem2.getMonth() - 5);
  pages["/ko/mypage/point"] = `<html><body><a href="/ko/mypage">마이페이지</a><div class="mileage"><ul>${[["120", "이번학기 취득<br>비교과 포인트"], ["50", "지난 학기 이월<br>비교과 포인트"], ["0", "다음 학기 이월<br>비교과 포인트"], ["0", "소멸 포인트"], ["615", "전체 누적 포인트"], ["615", "졸업 인정<br>비교과 포인트"]].map(([n, l]) => `<li><p class="point"><i class="icon"></i><span>${n}</span>점</p><span>${l}</span></li>`).join("")}</ul></div><ul class="black inner">${[["가을 캠퍼스 플로깅", 5, rel(-5, 0, 0)], ["현직자 특강", 10, rel(-15, 0, 0)], ["AI 해커톤", 105, rel(-28, 0, 0)], ["하계 현장실습", 150, prevSem], ["전자정보박람회", 100, prevSem2]].map(([t, ch, d], i) => `<li class="tbody"><span class="loopnum">${i + 1}</span><span class="title">[${t}] 이수</span><span class="change">+${ch}</span><span class="accumulation">+0</span><span class="date">${iso(d)}(Thu) 10:00</span></li>`).join("")}</ul></body></html>`;
  const card = (id, title, inst, point, applyTo, runFrom, runTo, prog) => `<li><div class="APPROACH_CLOSING"></div><a href="/ko/program/all/view/${id}"><b class="title">${title}</b></a><span class="institution">${inst}</span><label><b>D-2</b>${point}</label><span class="progress">${prog}</span><small class="date_layer"><span class="date_title">신청:</span><time datetime="${iso(rel(-5, 0, 0))}T09:00:00+09:00"></time><time datetime="${iso(applyTo)}T23:59:00+09:00"></time></small><small class="date_layer"><span class="date_title">운영:</span><time datetime="${kt(runFrom)}"></time><time datetime="${kt(runTo)}"></time></small></li>`;
  const openList = `<html><body><main>총 <b>5</b>개<ul class="columns-4">${[
    card(901, "교내 영어 스피치 대회", "한성프레스센터", 30, rel(3), rel(9, 13, 0), rel(9, 18, 0), "2/무제한"),
    card(902, "진로 캠프: 융합형 진로 설계 특강", "학생진로취업처", 10, rel(5), wk(7 + 2, 13, 0), wk(7 + 2, 15, 0), "5/100명"),
    card(903, "인문학 살롱: 역사학 특강", "상상력 교양대학", 10, rel(6), wk(7 + 3, 10, 30), wk(7 + 3, 12, 0), "23/90명"),
    card(904, "2026 AI 해커톤", "SW중심대학사업단", 20, rel(2), rel(10, 10, 0), rel(11, 18, 0), "31/40명"),
    card(905, "2학기 집단상담 프로그램", "학생생활상담센터", 65, rel(6), wk(7 + 2, 10, 0), wk(28 + 3, 13, 0), "8/무제한"),
  ].join("")}</ul></main></body></html>`;
  const detail = (pick, sessions, desc) => `<html><body><div class="title"><label class="type">개인</label><h4>t</h4></div><ul class="black inner"><li class="thead"><span class="title">프로그램 일정</span><span class="mileage">마일리지</span><span class="date">신청기간</span><span class="status">신청현황</span></li>${sessions.map(([n, a, b, pt, st]) => `<li class="tbody"><span class="title"><label><input type="${pick}" name="tidx[]"><b>${n}</b><p><time datetime="${kt(a)}">x</time> ~ <time datetime="${kt(b)}">x</time></p></label></span><span class="mileage">인재인증${pt}</span><span class="date"><time datetime="${kt(rel(-5, 9, 0))}">x</time> 부터 <time datetime="${kt(rel(6, 23, 59))}">x</time> 까지</span><span class="status">${st || "3 명 / 무제한"}</span></li>`).join("")}</ul><div class="description">${desc}</div></body></html>`;
  pages["/ko/program/all/view/901"] = detail("hidden", [["교내 영어 스피치 대회", rel(9, 13, 0), rel(9, 18, 0), 30]], "본선 일시와 장소");
  pages["/ko/program/all/view/902"] = detail("checkbox", [["진로 캠프 1: 융합형 진로 설계", wk(7 + 2, 13, 0), wk(7 + 2, 15, 0), 10], ["진로 캠프 2: 직무 탐색 워크숍", wk(7 + 4, 18, 0), wk(7 + 4, 20, 0), 10]], "비대면/대면 중 하나만 선택해도 참여 가능, 모두 참여 시 추가 포인트");
  pages["/ko/program/all/view/903"] = detail("hidden", [["인문학 살롱", wk(7 + 3, 10, 30), wk(7 + 3, 12, 0), 10]], "장소: 상상관");
  pages["/ko/program/all/view/904"] = detail("hidden", [["2026 AI 해커톤", rel(10, 10, 0), rel(11, 18, 0), 20]], "1박 2일 해커톤");
  pages["/ko/program/all/view/905"] = detail("checkbox", [["집단상담(수10시)", wk(7 + 2, 10, 0), wk(28 + 2, 13, 0), 65], ["집단상담(목10시)", wk(7 + 3, 10, 0), wk(28 + 3, 13, 0), 65]], "총 12시간(3시간*4회) 집단상담. 운영방식: 대면");
  pages["/ko/program/all/view/201"] = detail("hidden", [["멘토링", rel(-20, 9, 0), rel(40, 23, 45), 15]], "멘토링 일정과 장소는 멘토와 협의하여 결정됩니다.");
  pages["/ko/program/all/view/101"] = detail("hidden", [["1차 AI 활용 학습법", rel(2, 15, 30), rel(2, 17, 30), 10, "3 명 / 30 명 신청완료"]], "AI 활용 학습법 워크숍");
  pages["/ko/program/all/view/102"] = detail("hidden", [["현직자 특강", rel(1, 18, 30), rel(1, 20, 0), 10, "40 명 / 80 명 신청완료"]], "현직자 특강");
  pages["/ko/program/all/view/202"] = detail("hidden", [["중독예방", rel(-20, 0, 0), rel(60, 23, 45), 5]], "온라인 교육");

  // ---------- 학교 학사일정 ----------
  const kdot = (x) => `${x.getFullYear()}.${p2(x.getMonth() + 1)}.${p2(x.getDate())}(Mon)`;
  const acadHtml = `<html><body><div class="desc">${[[rel(-4), rel(5), "트랙선택 신청"], [rel(-12), rel(20), "졸업예정자 비교과 포인트 신청"], [rel(6), rel(10), "일반 전과신청"], [rel(12), rel(17), "기말고사, 보강 주"]].map(([a, b, t]) => `<dl><dt><span>${kdot(a)} ~ ${kdot(b)}</span></dt><dd><a>${t}</a></dd></dl>`).join("")}</div></body></html>`;

  /** 비교과·종합정보·학교 홈페이지 주소 → 가짜 HTML */
  function siteHtml(url) {
    const u = new URL(url);
    if (u.host === "www.hansung.ac.kr") return acadHtml;
    if (u.host === "learn.hansung.ac.kr") return learnHtml(url);
    if (u.host === "hsportal.hansung.ac.kr") {
      if (pages[u.pathname]) return pages[u.pathname];
      if (u.pathname.startsWith("/ko/program/all")) return openList;
      if (u.pathname.startsWith("/ko/mypage/programs/list/")) return listPage([]); // 2쪽 이후
      if (u.pathname.startsWith("/ko/mypage/point/")) return "<html><body><ul class=\"black inner\"></ul></body></html>";
      return "<html><body><a>로그아웃</a></body></html>";
    }
    return "<html><body></body></html>";
  }

  // ---------- 직접 넣은 일정 (sync 저장 형식과 같게) ----------
  const userEvents = {
    demo1: { t: "멘토링 모임", d: iso(wk(3, 0, 0)), s: "16:00", e: "17:30", p: "상상관 302", n: "톡방 공지", g: "201", at: 1 },
    demo2: { t: "카페 알바", w: [5], s: "18:00", e: "22:00", from: iso(rel(-30, 0, 0)), until: "", at: 2 },
  };

  return { learnHtml, siteHtml, timetable: tt, userEvents, mainPage };
}
