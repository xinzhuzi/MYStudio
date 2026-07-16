import { beforeEach, describe, expect, it, vi } from "vitest";

const featureText = vi.hoisted(() => vi.fn());
const parseShotCalibrationResponse = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: { featureText },
}));
vi.mock("./shot-calibration-response", () => ({
  parseShotCalibrationResponse,
}));

import { callAIForShotCalibration } from "./shot-calibration-prompt-service";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("callAIForShotCalibration", () => {
  it("keeps the calibration prompt transport and parser contract", async () => {
    featureText.mockResolvedValue('{"shots":{}}');
    parseShotCalibrationResponse.mockReturnValue({
      "shot-1": { visualDescription: "雨夜城门" },
    });

    const result = await callAIForShotCalibration([
      {
        shotId: "shot-1",
        sourceText: "谢乘风在雨中抬头望向城门。",
        actionSummary: "谢乘风抬头",
        characterNames: ["谢乘风"],
        sceneLocation: "雨夜城门",
        sceneAtmosphere: "肃杀",
        sceneTime: "夜",
        sceneWeather: "雨",
        architectureStyle: "古城",
      },
    ], {
      apiKey: "compat-key",
      provider: "compat-provider",
      styleId: "cinematic",
    }, {
      title: "道劫",
      genre: "玄幻",
      outline: "劫火将起",
      characterBios: "谢乘风：玄衣青年",
      episodeTitle: "雨夜叩城",
      episodeSynopsis: "谢乘风抵达城门",
      currentEpisode: 3,
      totalEpisodes: 60,
    });

    expect(featureText).toHaveBeenCalledWith(
      "script_analysis",
      expect.stringContaining("剧名：《道劫》"),
      expect.stringContaining("【⭐ 主场景（绝对不可更改）】: 雨夜城门"),
      { maxTokens: 16384 },
    );
    expect(featureText.mock.calls[0]?.[2]).toContain("谢乘风在雨中抬头望向城门");
    expect(parseShotCalibrationResponse).toHaveBeenCalledWith('{"shots":{}}');
    expect(result).toEqual({ "shot-1": { visualDescription: "雨夜城门" } });
  });
});
