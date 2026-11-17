import { describe, expect, it } from "vitest";
import { isCronAuthorized } from "../cron-auth";

describe("cron secret check", () => {
  const secret = "hex-secret-123";

  it("accepts the exact bearer token", () => {
    expect(isCronAuthorized(`Bearer ${secret}`, secret)).toBe(true);
  });

  it("rejects missing, malformed or wrong credentials", () => {
    expect(isCronAuthorized(null, secret)).toBe(false);
    expect(isCronAuthorized("Bearer wrong-secret", secret)).toBe(false);
    expect(isCronAuthorized("Bearer short", secret)).toBe(false);
    expect(isCronAuthorized(`Basic ${secret}`, secret)).toBe(false);
    expect(isCronAuthorized(`Bearer ${secret}`, "")).toBe(false);
    expect(isCronAuthorized(`Bearer ${secret}`, undefined)).toBe(false);
  });
});
