import { describe, expect, it } from "vitest";
import { emailSendSchema, extractAddress } from "../schemas";

const accountId = "00000000-0000-4000-8000-000000000001";

describe("emailSendSchema", () => {
  it("accepts display-name recipients and keeps only the address", () => {
    const parsed = emailSendSchema.parse({
      accountId,
      to: ["Ana Souza <ana@example.com>", " bob@example.com "],
      cc: ["Carl <carl@example.com>"],
    });
    expect(parsed.to).toEqual(["ana@example.com", "bob@example.com"]);
    expect(parsed.cc).toEqual(["carl@example.com"]);
  });

  it("treats null and empty optional fields as absent", () => {
    const parsed = emailSendSchema.parse({
      accountId,
      to: ["ana@example.com"],
      cc: null,
      subject: null,
      inReplyTo: null,
      logRecordId: "",
      logRecordType: null,
    });
    expect(parsed.cc).toEqual([]);
    expect(parsed.subject).toBe("");
    expect(parsed.inReplyTo).toBeUndefined();
    expect(parsed.logRecordId).toBeUndefined();
    expect(parsed.logRecordType).toBeUndefined();
  });

  it("still rejects malformed addresses", () => {
    expect(emailSendSchema.safeParse({ accountId, to: ["not-an-email"] }).success).toBe(false);
  });

  it("extractAddress leaves bare addresses alone", () => {
    expect(extractAddress("x@y.com")).toBe("x@y.com");
    expect(extractAddress("X <x@y.com>")).toBe("x@y.com");
  });
});
