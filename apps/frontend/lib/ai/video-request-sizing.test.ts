import { describe, expect, it } from "vitest";
import { toRunwayRatio, toSoraSize, toVeoOpenAIVideoSize } from "./video-request-sizing";

describe("video request sizing", () => {
  it("maps every supported Runway ratio and preserves unknown values", () => {
    expect(toRunwayRatio("16:9")).toBe("1280:720");
    expect(toRunwayRatio("9:16")).toBe("720:1280");
    expect(toRunwayRatio("1:1")).toBe("720:720");
    expect(toRunwayRatio("4:3")).toBe("960:720");
    expect(toRunwayRatio("3:4")).toBe("720:960");
    expect(toRunwayRatio("21:9")).toBe("2048:880");
    expect(toRunwayRatio("custom")).toBe("custom");
  });

  it("maps Sora landscape and portrait sizes at 720p and 1080p", () => {
    expect(toSoraSize("16:9")).toBe("1280x720");
    expect(toSoraSize("9:16")).toBe("720x1280");
    expect(toSoraSize("16:9", "1080P")).toBe("1920x1080");
    expect(toSoraSize("3:4", "1080p")).toBe("1080x1920");
  });

  it("maps Veo OpenAI sizing by orientation", () => {
    expect(toVeoOpenAIVideoSize("16:9")).toBe("1920x1080");
    expect(toVeoOpenAIVideoSize("9:16")).toBe("1080x1920");
    expect(toVeoOpenAIVideoSize("3:4")).toBe("1080x1920");
  });
});
