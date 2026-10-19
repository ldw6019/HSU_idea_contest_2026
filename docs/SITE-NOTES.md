# 사이트 분석 노트 (2026-09-28 ~ 10-20)

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
  - (10/18 확인) `div.title label.type`: 개인 / 팀 / 주제별 상이. `div.description`: 안내문
  - "프로그램 일정 | 마일리지 | 신청기간 | 신청현황" 목록 = **전체 회차**. `li.tbody`: `b` 회차 이름, `time` 4개(datetime 속성: 회차 시작·끝, 신청 시작·끝), `.mileage` "인재인증65", `.status` "N 명 / 무제한 … 신청완료"
  - 회차가 여러 개면 `input[name="tidx[]"]` type=checkbox, 하나면 hidden
  - 로그인 상태로 열면 위쪽 `div.info`에 이름이 보임 → 읽지 않음. "신청완료"는 내 회차 표시로만
  - 마이페이지 프로그램 번호 = 공개 상세 번호 (같은 프로그램)
  - 매주 모이는 프로그램은 회차 하나가 "11/4 10:00 ~ 11/25 13:00"처럼 여러 주에 걸침(시작·끝 요일·시각이 같음). 공모전도 우연히 같을 수 있어 안내문의 "매주/3시간*4회" 같은 말로 구분 (core/classify.js)
- 캘린더 JSON: `POST /ko/process/schedule/getEvents`
  - body (form): `cid=eco`, `category=`, `start=YYYY-MM-DD`, `end=YYYY-MM-DD`, `start_year=YYYY-01-01`, `end_year=YYYY-12-31`
  - 응답: `{ success, events: [{ id, title, start, end, allDay, category_title, backgroundColor, … }] }`
  - title 예: "○○ 신청시작"
- 마이페이지
  - 나의 비교과프로그램 `/ko/mypage/programs/list/{wait|progress|complete|cancel}/{page}` (표가 아니라 목록 구조): 분류, 부서, 제목, 회차, 포인트, 시간, 이수여부(+이수일), 설문조사·확인증 버튼
    - (10/20 확인) 시작 대기·진행 중 목록의 포인트 칸은 0으로 나옴(이수 뒤에 채워지는 듯). 공개 상세 화면의 회차 마일리지는 9건 모두 0보다 크고 한 프로그램 안 회차끼리 같았음 → 내 비교과 카드 포인트는 공개 상세 기준
  - 비교과 포인트 내역 `/ko/mypage/point` (페이지 로드 후 불러옴)
    - (10/14) 위쪽 `div.mileage` 6칸: 이번학기 취득 / 지난 학기 이월 / 다음 학기 이월 / 소멸 / 전체 누적 / 졸업 인정
    - (10/19) 아래 "비교과 포인트 내역" 목록 `li.tbody`: `.title`("[프로그램] 이수"), `.change`(+N), `.accumulation`, `.date`. 한 쪽 20줄, 2쪽부터 `/ko/mypage/point/{쪽}`
    - 확인(숫자는 보지 않고 같은지만): 이번학기 취득 = 9/1부터 내역 합계, 전체 누적 = 내역 전체 합계 = 졸업 인정, 지난 학기 이월 ≠ 1학기 합계(1학기에 200 넘게 모아 이월된 경우와 맞음)
    - 규칙(사용자): 한 학기 인정 최대 200, 넘친 점수는 다음 학기로 최대 200 이월(그 이상 소멸), 이월분이 다음 학기 칸을 먼저 채움
  - 시작 대기·진행 중 프로그램 화면 `/ko/mypage/programs/view/{번호}`: "프로그램 일정 | 상태 | 비고" = 내 회차만
  - 설문 `/ko/module/eco/@poll/write/{pidx}/{tidx}`: 이미 낸 설문은 답이 체크된 채로 열림 (설문 버튼은 낸 뒤에도 눌리는 상태라 버튼만으로는 모름)
- robots.txt: `Disallow: /` (10/14) → 서버가 직접 읽지 않음. 학생 본인 브라우저(확장)만 읽음
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

## 학교 홈페이지 학사일정 (www.hansung.ac.kr, 공개, 10/20 확인)
- 화면: `/hansung/6096/subview.do` (학부학사일정). 월간·연간 보기와 ICS 다운로드(POST 폼)가 있음
- 연간 목록: `GET /schdulMng/hansung/39/yearSchdul.do?year=YYYY` → 1~12월. `div.desc > dl`: `dt span` "2026.11.02(Mon) ~ 2026.11.20(Fri)" 또는 하루, `dd a` 일정 이름
  - 달 경계에 걸친 일정은 두 달 모두에 나옴 → 날짜+이름으로 중복 제거
  - 예(2026-2): 휴·복학 신청, 수강신청(학년별)·정정·포기, 등록 기간, 조기졸업·학점포기 신청, 다전공 취소, 중간·기말고사, 수업평가 중간·기말조사, 일반 전과·트랙선택 신청, 학위취득 유예신청, 재입학 신청
- robots.txt: `/*/*Mngr`, 로그인 경로만 막음 → 허용. 확장은 쿠키 없이(credentials omit) 하루 한 번 읽음
- 종합정보 "신청서비스" 메뉴마다 흩어진 신청 기간을 한곳에서 보는 소스로 이걸 씀(#19)

## 학교 서버 부담 (10/20 가짜 데이터로 측정, adapters 구조 기준)
- 패널을 처음 열 때(캐시 없음): e클래스 과목당 4번(과목 화면·과제·퀴즈·출석부) × 과목 수, 비교과 = 접수 중 목록 쪽수 + 처음 한 번 상세(프로그램 수, 12시간 보관) + 마이페이지 목록 3 + 포인트 1~2 + 내 프로그램 화면 수 + 설문 확인 수, 종합정보 2~3, 학교 홈페이지 1
  - 가짜 데이터(과목 6, 접수 중 5, 내 비교과 8): e클래스 24 + 비교과 32 + 종합정보 3 + 홈페이지 1
  - 실제 규모 추정(과목 6, 접수 중 42, 내 비교과 9): 처음 하루 첫 열기 약 100번, 이후엔 캐시 시간(e클래스 30분, 내 비교과 1시간, 비교과 목록 3시간, 상세 12시간, 시간표·학사일정 24시간)이 지난 것만
- 캐시가 살아 있을 때 다시 열기: 로그인 확인 2번(비교과·종합정보)뿐
- 동시 요청은 2~3개로 제한(core/limit.js), 모두 GET

## 학교 AI 플랫폼 (HSU AI HUB → AI Helpy Chat, 2026-10-07 확인)
- 운영: 엘리스(elice)의 기관용 생성형 AI 솔루션 "AI헬피챗". 주소 u-hs.elice.io (학교 로그인 필요)
- 담당 부서: AI·SW융합교육센터 (02-760-4294)
- 모델: GPT, Claude(Haiku 4.5 포함), Gemini(Flash 계열 포함), 자체 헬피 모델. 기본 모델 외에는 채팅 전용
- 토큰: 기관 공용 월 815M 토큰 + 학생 개인 한도(4M). 개인 한도를 다 쓰면 기관 토큰이 남아도 다음 갱신일까지 사용 불가
- 에이전트: "기관 에이전트"(기관이 배포)와 "내 에이전트"(사용자가 직접 생성) 있음. 마켓플레이스 분류에 "내부 지원·안내"가 있음
- 개발자 연동: 사용자 화면에는 API 키·개발자 메뉴 없음(계정 관리, 결제 내역, 언어 설정, 고객 센터뿐). 엘리스는 기관 대상으로 Elice Cloud ML API 연동을 제공한다고 홍보함 → 기관 계약 차원에서만 가능할 것으로 추정, 학교 확인 필요
- 원칙: 확장 프로그램이 학생 로그인으로 헬피챗을 자동 조작해 쓰지 않는다(약관·개인 한도 문제). 시연은 우리 서버, 학교 플랫폼 연동은 공식화 제안으로만.

