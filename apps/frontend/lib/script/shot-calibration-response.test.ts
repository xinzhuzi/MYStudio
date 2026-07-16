import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseShotCalibrationResponse } from "./shot-calibration-response";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("parseShotCalibrationResponse", () => {
  it("parses fenced JSON and ignores surrounding prose", () => {
    const result = parseShotCalibrationResponse(
      'prefix\n```json\n{"shots":{"shot_1":{"visualDescription":"画面"}}}\n```\nsuffix',
    );

    expect(result.shot_1).toMatchObject({ visualDescription: "画面" });
  });

  it("returns an empty record when the response omits shots", () => {
    expect(parseShotCalibrationResponse('{"message":"ok"}')).toEqual({});
  });

  it("recovers complete shot objects from a truncated response", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const result = parseShotCalibrationResponse(
      '{"shots":{"shot_1":{"visualDescription":"画面","meta":{"ok":true}},"shot_2":',
    );

    expect(result.shot_1).toMatchObject({
      visualDescription: "画面",
      meta: { ok: true },
    });
  });

  it("throws the compatibility error when no shot can be recovered", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => parseShotCalibrationResponse("not-json")).toThrow("解析 AI 响应失败");
  });
});
