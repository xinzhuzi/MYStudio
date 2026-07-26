import { describe, expect, it } from "vitest";
import { formatTimeCode as fromFacade, parseTimeCode as parseFacade } from "./time";
import {
  formatTimeCode as fromCanonical,
  parseTimeCode as parseCanonical,
} from "./studio/editing/timecode";

describe("time root facade", () => {
  it("exports the same timecode helpers as the canonical module", () => {
    expect(fromFacade).toBe(fromCanonical);
    expect(parseFacade).toBe(parseCanonical);
  });
});
