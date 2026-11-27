import { describe, expect, it } from "vitest";
import { classifyConnectionError } from "../connection-error";

describe("classifyConnectionError", () => {
  it("recognises authentication failures from imapflow and nodemailer", () => {
    expect(classifyConnectionError(Object.assign(new Error("Command failed"), { authenticationFailed: true }))).toBe("auth");
    expect(classifyConnectionError(Object.assign(new Error("Invalid login"), { code: "EAUTH", responseCode: 535 }))).toBe("auth");
    expect(classifyConnectionError(new Error("[AUTHENTICATIONFAILED] Authentication failed."))).toBe("auth");
  });

  it("recognises DNS, refused, timeout and TLS problems", () => {
    expect(classifyConnectionError(Object.assign(new Error("getaddrinfo ENOTFOUND imap.example"), { code: "ENOTFOUND" }))).toBe("host");
    expect(classifyConnectionError(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }))).toBe("refused");
    expect(classifyConnectionError(Object.assign(new Error("Connection timeout"), { code: "ETIMEDOUT" }))).toBe("timeout");
    expect(classifyConnectionError(Object.assign(new Error("ssl3_get_record:wrong version number"), { code: "EPROTO" }))).toBe("tls");
    expect(classifyConnectionError(Object.assign(new Error("socket hang up"), { code: "ESOCKET" }))).toBe("tls");
  });

  it("falls back to unknown and follows error causes", () => {
    expect(classifyConnectionError("nope")).toBe("unknown");
    expect(classifyConnectionError(new Error("Something odd"))).toBe("unknown");
    expect(classifyConnectionError(new Error("wrapped", { cause: Object.assign(new Error("x"), { code: "ENOTFOUND" }) }))).toBe("host");
  });
});
