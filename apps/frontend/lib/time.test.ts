import { describe, expect, it } from "vitest";
import { formatTimeCode, parseTimeCode } from "./time";

describe("timecode helpers", () => {
  it("formats seconds into frame-accurate HH:MM:SS:FF values", () => {
    expect(formatTimeCode(65.5, "HH:MM:SS:FF", 30)).toBe("00:01:05:15");
    expect(formatTimeCode(65.5, "MM:SS", 30)).toBe("01:05");
    expect(formatTimeCode(65.5, "SS", 30)).toBe("65");
  });

  it("clamps invalid input to zero while formatting", () => {
    expect(formatTimeCode(-5)).toBe("00:00:00:00");
    expect(formatTimeCode(Number.NaN)).toBe("00:00:00:00");
  });

  it("parses supported timecode formats and rejects malformed values", () => {
    expect(parseTimeCode("00:01:05:15", "HH:MM:SS:FF", 30)).toBe(65.5);
    expect(parseTimeCode("01:05", "MM:SS")).toBe(65);
    expect(parseTimeCode("65.5", "SS")).toBe(65.5);

    expect(parseTimeCode("00:00:00:30", "HH:MM:SS:FF", 30)).toBeNull();
    expect(parseTimeCode("01:-1", "MM:SS")).toBeNull();
    expect(parseTimeCode("", "SS")).toBeNull();
  });
});
