// HSU Plus 설정 (배포할 때 여기만 고친다)
//
// AI 서버(Cloudflare Worker) 주소. 비어 있으면 AI를 쓰지 않고 브라우저 안 기본 답변만 한다.
//  예: "https://hsuplus-ai.<내-계정>.workers.dev"  (docs/AI-SETUP.md 7단계)
//  어떤 회사·모델을 쓰는지는 확장이 모른다 → 모델을 바꿔도 확장은 그대로 (worker/wrangler.toml의 AI_PRESET)
export const AI_ENDPOINT = "https://hsuplus-ai.yeee222241.workers.dev";
