# 사이트 분석 노트 (2026-09-28 ~ 29)

로그인된 화면을 **읽기만** 해서 확인한 구조입니다. 학교 사이트가 바뀌면 이 노트와 adapters/를 함께 고칩니다.

## e클래스 (learn.hansung.ac.kr)
- Moodle 기반 코스모스(Coursemos) v2 테마. 메인 화면 `body#page-site-index`
- Moodle 표준 AJAX API(`/lib/ajax/service.php`)는 막혀 있음 → 페이지를 읽어서 파싱
- 강의 목록: 메인 `a[href*="course/view.php"]` (교과 / 커뮤니티 구분 라벨 있음)
- 과목 페이지 `/course/view.php?id={courseId}`
  - `li.activity.modtype_vod`: 영상. `.displayoptions .text-info`에 수강 기간·길이 (예: `2026-09-26 00:00:00 ~ 2026-10-04 23:59:59, 43:13`)
  - `li.activity.modtype_assign`: 과제. 과목 페이지에는 기한이 안 보임
  - 그 외 `modtype_ubboard`(게시판), `modtype_ubfile`(파일), `modtype_url`, `modtype_label`
  - 섹션 제목에 주차와 날짜 (예: `5주차 [9월28일 - 10월04일]`)
- 과제 목록 `/mod/assign/index.php?id={courseId}`: `table.generaltable` → 주 | 과제 | 종료 일시 | 제출 | 성적
- 온라인출석부 `/report/ubcompletion/progress.php?id={courseId}`
  - `table.user_progress_table` → 주차 | 강의 자료 | 총 학습시간 | 출석 | 주차 출석
  - ⚠️ 페이지 상단 표에 학번·이름·전화번호가 있음. 이 표는 읽지 않는다.
- 수강률 = 출석부 학습 시간 ÷ 영상 길이

## 비교과 (hsportal.hansung.ac.kr, 스마트자기관리시스템)
- 코스모스 모듈 포함, e클래스 쪽 정보 요청(`/ko/process/coursemos/getCoursemosUrl`, `getBadges`)을 보냄 → 같은 업체 기반
- 프로그램 목록 `/ko/program/all?…` (GET, 서버 렌더링, 페이지당 12개)
  - `status`: all / scheduled(접수예정) / wait(접수대기) / open(접수중) / operation(운영중) / completed(마감)
  - `keyword`, `category1`(27 학습역량강화, 24 상담·심리, 25 진로·취업, 22 창업, 23 전공역량)
  - `operator1`: 운영 부서 코드 (예: PR 학생진로취업처, PN 교육혁신처)
  - `period`: 신청기간 1 금일등록 / 2 1주일내 등록 / 3 당일마감 / 4 1주일내 마감 / 5 직접입력
  - `time`: 교육시간 1 ~5시간 / 2 5~10 / 3 10~30 / 4 30시간~
  - `tags`: 태그 (예: AI활용)
  - 페이지: `/ko/program/all/list/0/{page}`
  - 카드: D-day 또는 임박/마감, 포인트(p5 등), 조회수, 부서, 제목, 회차 요약, 신청 기간, 운영 기간, 정원/신청(무제한, 승인필요)
- 상세 `/ko/program/all/view/{programId}`: 회차별 일정·포인트·정원·접수 상태, 장소, 모집 대상, 긴 비정형 안내문 → AI 요약 대상
- 캘린더 JSON: `POST /ko/process/schedule/getEvents`
  - body (form): `cid=eco`, `category=`, `start=YYYY-MM-DD`, `end=YYYY-MM-DD`, `start_year=YYYY-01-01`, `end_year=YYYY-12-31`
  - 응답: `{ success, events: [{ id, title, start, end, allDay, category_title, backgroundColor, … }] }`
  - title 예: "○○ 신청시작"
- 마이페이지
  - 나의 비교과프로그램 `/ko/mypage/programs/list/{wait|progress|complete|cancel}/{page}` (표가 아니라 목록 구조): 분류, 부서, 제목, 회차, 포인트, 시간, 이수여부(+이수일), 설문조사·확인증 버튼
  - 비교과 포인트 내역 `/ko/mypage/point` (페이지 로드 후 불러옴)
  - 한성인재인증 `/ko/mypage/confirm` (기준표는 이미지)
- 세션 유지 `POST /ko/process/member/loginKeep`, 알림 개수 `POST /ko/process/push/getCount`
- 불편 사항(보고서용): 미이수 원인 불명확, 교외활동 반려 사유는 마우스 오버로만 보임, 교외 배점표는 공지 첨부파일, 졸업예정자 포인트 기한(1/10)은 공지에만, 몇 년 전 대기 항목이 그대로 남음

## 종합정보시스템 (info.hansung.ac.kr)
- JSP 기반, **EUC-KR** → `new TextDecoder('euc-kr')`로 읽어야 함
- 개인시간표 화면 `/jsp_21/student/kyomu/dae_h_siganpyo.jsp`
  - 데이터: `POST /jsp_21/student/kyomu/dae_sigan_main_data.jsp` (페이지 스크립트가 보내는 값을 그대로 사용)
  - 응답 JSON 배열: `{ id, seq, start: "2026-10-01T18:00:00", end, title: "과목/교수/강의실", backgroundColor, … }`
- 신청서비스 메뉴 각 페이지에 "신청기간 : …" 문구 (평소엔 "기간이 아닙니다") → 학사 신청 알림 소스
- 수강포기·수업평가·교육만족도 페이지에도 기간 문구
- 성적조회(누적): 이수구분별 취득학점 → 졸업 진행률 (프로토타입에서는 제외)
- "비교과포인트조회" 메뉴는 hsportal로 가는 링크일 뿐 → 시스템 파편화 근거
- ⚠️ 일부 요청에 학생 식별값이 파라미터로 들어감. 확장은 **페이지가 쓰는 값만 그대로** 사용하고, 다른 값으로 바꿔 보는 실험은 하지 않는다.
