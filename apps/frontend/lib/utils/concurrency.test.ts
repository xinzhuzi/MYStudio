import { describe, expect, it } from "vitest";
import { runStaggered } from "./concurrency";

describe("runStaggered", () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "does not deadlock for invalid maxConcurrent=%s",
    async (maxConcurrent) => {
      const result = await runStaggered([async () => "ok"], maxConcurrent, 0);
      expect(result).toEqual([{ status: "fulfilled", value: "ok" }]);
    },
  );
});
