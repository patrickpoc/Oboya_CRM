import { describe, expect, it } from "vitest";
import { IN_CHUNK_SIZE, chunk, fetchInChunks } from "@/lib/crm/repositories/chunk";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);

describe("chunk", () => {
  it("splits into slices of at most 200", () => {
    expect(IN_CHUNK_SIZE).toBe(200);
    expect(chunk(ids(5000)).map((c) => c.length)).toEqual(Array(25).fill(200));
    expect(chunk(ids(450)).map((c) => c.length)).toEqual([200, 200, 50]);
    expect(chunk([])).toEqual([]);
    expect(() => chunk([1], 0)).toThrow();
  });
});

describe("fetchInChunks", () => {
  it("queries distinct ids in chunks and concatenates the rows", async () => {
    const calls: number[] = [];
    const rows = await fetchInChunks([...ids(500), "id-0", "id-1"], async (part) => {
      calls.push(part.length);
      return part.map((id) => ({ id }));
    });
    expect(calls).toEqual([200, 200, 100]);
    expect(rows).toHaveLength(500);
  });

  it("skips the query when there are no ids", async () => {
    let called = false;
    expect(await fetchInChunks([], async () => ((called = true), []))).toEqual([]);
    expect(called).toBe(false);
  });

  it("propagates errors", async () => {
    await expect(fetchInChunks(["a"], async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
  });
});
