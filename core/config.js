// HSU Plus 설정 (배포할 때 여기만 고친다)
//
// AI 서버(Cloudflare Worker) 주소. 비어 있으면 AI를 쓰지 않고 브라우저 안 기본 답변만 한다.
//  예: "https://hsuplus-ai.<내-계정>.workers.dev"  (docs/AI-SETUP.md 7단계)
//  어떤 회사·모델을 쓰는지는 확장이 모른다 → 모델을 바꿔도 확장은 그대로 (worker/wrangler.toml의 AI_PRESET)
// 11/22: 대회 뒤 공개판은 AI를 끔(사용자 결정). 비워 두면 AI 서버에 아무것도 보내지 않고,
//  AI 탭은 추천 버튼(브라우저 안 기본 답변)만, 직접 입력칸·공지 → 일정 칸은 숨긴다. 다시 켜려면 주소만 되돌리면 됨
export const AI_ENDPOINT = "";
