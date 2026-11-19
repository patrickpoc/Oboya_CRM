import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { decodeMailSubject } from "../subject";

const title = "AI 会议统计分析报告（2026-11-09 至 2026-11-15）";
const header = (subject: string) => Buffer.from(`Subject: ${subject}\r\n\r\n`, "utf8");

describe("mail subject decoding", () => {
  it("decodes UTF-8 MIME words and keeps literal Unicode subjects", async () => {
    await expect(decodeMailSubject(header(`=?UTF-8?B?${Buffer.from(title).toString("base64")}?=`))).resolves.toBe(title);
    await expect(decodeMailSubject(header(title))).resolves.toBe(title);
    await expect(decodeMailSubject(undefined, title)).resolves.toBe(title);
  });

  it("repairs UTF-8 bytes labelled GBK, which produce the reported Chinese mojibake", async () => {
    for (const charset of ["GBK", "gb2312", "GB18030"]) {
      await expect(decodeMailSubject(header(`=?${charset}?B?${Buffer.from(title).toString("base64")}?=`))).resolves.toBe(title);
    }
  });

  it("handles Q encoding and folded words even when a UTF-8 sequence straddles words", async () => {
    const bytes = Buffer.from(title);
    const q = [...bytes].map((byte) => `=${byte.toString(16).padStart(2, "0")}`).join("");
    await expect(decodeMailSubject(header(`=?GB2312?Q?${q}?=`))).resolves.toBe(title);
    const split = 5; // inside the first Chinese character
    await expect(decodeMailSubject(header(
      `=?GBK?B?${bytes.subarray(0, split).toString("base64")}?=\r\n\t=?GBK?B?${bytes.subarray(split).toString("base64")}?=`
    ))).resolves.toBe(title);
  });

  it("preserves genuine GBK and GB18030 instead of forcing their bytes through UTF-8", async () => {
    for (const charset of ["GBK", "GB18030"]) {
      await expect(decodeMailSubject(header(`=?${charset}?B?1tDOxA==?=`))).resolves.toBe("中文");
    }
    // GBK C2 A3 means 拢, although those bytes also form the UTF-8 symbol £.
    await expect(decodeMailSubject(header("=?GBK?B?wqM=?="))).resolves.toBe("拢");
    await expect(decodeMailSubject(Buffer.concat([Buffer.from("Subject: "), Buffer.from("d6d0cec4", "hex"), Buffer.from("\r\n\r\n")]))).resolves.toBe("中文");
  });

  it("preserves other charsets, reply prefixes and missing subjects", async () => {
    await expect(decodeMailSubject(header("Re: =?ISO-8859-1?Q?Ol=E1?="))).resolves.toBe("Re: Olá");
    await expect(decodeMailSubject(Buffer.from("From: buyer@example.com\r\n\r\n"), "Fallback")).resolves.toBe("Fallback");
    await expect(decodeMailSubject(undefined)).resolves.toBe("");
  });
});
