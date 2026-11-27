/**
 * Maps a mail-provider failure (imapflow / nodemailer / Node socket errors) to a
 * small fixed vocabulary the browser can translate. Raw server text, host names
 * and credentials never leave the server; only the code does.
 */
export type ConnectionErrorCode = "auth" | "host" | "refused" | "timeout" | "tls" | "unknown";

type ErrorLike = {
  code?: unknown;
  authenticationFailed?: unknown;
  responseCode?: unknown;
  response?: unknown;
  message?: unknown;
  cause?: unknown;
};

const AUTH_CODES = new Set(["EAUTH", "AUTHENTICATIONFAILED", "AUTHENTICATION_FAILED", "AuthenticationFailed"]);
const HOST_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_NONAME", "EAI_FAIL", "EDNS"]);
const REFUSED_CODES = new Set(["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "ECONNECTION"]);
const TIMEOUT_CODES = new Set(["ETIMEDOUT", "ETIMEOUT", "ESOCKETTIMEDOUT", "ConnectionTimeout", "GreetingTimeout", "SocketTimeout"]);

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function classifyConnectionError(error: unknown): ConnectionErrorCode {
  if (!error || typeof error !== "object") return "unknown";
  const err = error as ErrorLike;
  const code = text(err.code);
  const message = `${text(err.message)} ${text(err.response)}`.toLowerCase();
  const responseCode = typeof err.responseCode === "number" ? err.responseCode : Number.NaN;

  if (err.authenticationFailed === true || AUTH_CODES.has(code) || responseCode === 535 || responseCode === 534) return "auth";
  if (/\bauthenticat|invalid credentials|login failed|\[authenticationfailed\]|username and password not accepted/.test(message)) return "auth";

  if (HOST_CODES.has(code) || /getaddrinfo|enotfound|eai_again/.test(message)) return "host";
  if (REFUSED_CODES.has(code) || /econnrefused|ehostunreach/.test(message)) return "refused";
  if (TIMEOUT_CODES.has(code) || /timed? ?out/.test(message)) return "timeout";

  if (
    code.startsWith("ERR_TLS") ||
    code.startsWith("ERR_SSL") ||
    code === "EPROTO" ||
    code === "ESOCKET" ||
    code === "ECONNRESET" ||
    /ssl|tls|certificate|wrong version number|handshake|starttls|econnreset|epipe/.test(message)
  ) {
    return "tls";
  }

  if (err.cause && err.cause !== error) return classifyConnectionError(err.cause);
  return "unknown";
}
