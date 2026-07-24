import { describe, expect, it } from "vitest";
import { formatBytes, formatSizeMb } from "./local-tts-formatters";

describe("local TTS formatters", () => {
  it("formats model sizes using the existing MB/GB thresholds", () => {
    expect(formatSizeMb()).toBe("未知");
    expect(formatSizeMb(512)).toBe("512 MB");
    expect(formatSizeMb(1024)).toBe("1.00 GB");
    expect(formatSizeMb(10 * 1024)).toBe("10.0 GB");
  });

  it("formats download byte counts with stable units and precision", () => {
    expect(formatBytes()).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
  });
});
