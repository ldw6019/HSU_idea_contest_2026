// 어댑터가 던지는 오류 종류. 화면은 종류에 따라 다른 안내를 보여준다.

/** 해당 사이트에 로그인되어 있지 않음 → "로그인 필요" 안내 */
export class LoginRequiredError extends Error {
  constructor(site) {
    super(`${site} 로그인 필요`);
    this.name = "LoginRequiredError";
    this.site = site;
  }
}

/** 페이지 구조가 예상과 다름 (학교 사이트 개편 등) → "불러오기 실패" 안내 */
export class ParseError extends Error {
  constructor(message) {
    super(message);
    this.name = "ParseError";
  }
}

/** 화면으로 보낼 수 있는 단순한 형태로 바꾼다 (메시지로 Error 객체를 그대로 못 보냄) */
export function toPlainError(err) {
  if (!err) return null;
  return {
    kind: err.name === "LoginRequiredError" ? "login" : err.name === "ParseError" ? "parse" : "network",
    site: err.site || null,
    message: String(err.message || err),
  };
}
