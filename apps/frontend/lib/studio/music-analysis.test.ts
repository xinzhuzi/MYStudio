import { describe, expect, it } from "vitest";
import {
  buildAnalysisMessages,
  extractAudioFeatures,
  extractStylePhrases,
  parseAnalysisDraft,
  type AudioBufferLike,
} from "./music-analysis";

function fakeBuffer(channels: Float32Array[], sampleRate: number): AudioBufferLike {
  return {
    numberOfChannels: channels.length,
    length: channels[0]!.length,
    sampleRate,
    getChannelData: (channel: number) => channels[channel]!,
  };
}

/** 120 BPM 节拍轨:每 0.5s 一记 440Hz 短 ping(指数衰减),节拍间静音。 */
function clickTrack(sampleRate = 44100, durationS = 20): Float32Array {
  const samples = new Float32Array(sampleRate * durationS);
  const beatInterval = Math.round(sampleRate * 0.5);
  const pingLength = Math.round(sampleRate * 0.03);
  for (let beat = 0; beat * beatInterval < samples.length; beat++) {
    const base = beat * beatInterval;
    for (let k = 0; k < pingLength && base + k < samples.length; k++) {
      const envelope = Math.exp(-k / (pingLength / 4));
      samples[base + k]! = 0.8 * envelope * Math.sin((2 * Math.PI * 440 * k) / sampleRate);
    }
  }
  return samples;
}

describe("music-analysis(AI 参照曲解析)", () => {
  it("120 BPM 节拍轨:实测 BPM 命中,特征齐全", () => {
    const features = extractAudioFeatures(fakeBuffer([clickTrack()], 44100));
    expect(features.bpm).not.toBeNull();
    expect(Math.abs((features.bpm ?? 0) - 120)).toBeLessThanOrEqual(2);
    expect(features.bpmConfidence ?? 0).toBeGreaterThanOrEqual(1.25);
    expect(features.durationS).toBeCloseTo(20, 1);
    expect(features.channels).toBe(1);
    expect(features.stereoWidth).toBeNull();
    expect(features.energyProfile).toHaveLength(12);
    expect(features.brightness).toBeGreaterThanOrEqual(0);
    expect(features.brightness).toBeLessThanOrEqual(1);
    expect(features.loudnessDb).toBeGreaterThan(-60);
    expect(features.loudnessDb).toBeLessThan(0);
  });

  it("静音轨:BPM 不可检测,响度贴底,能量轨迹平", () => {
    const features = extractAudioFeatures(fakeBuffer([new Float32Array(44100 * 5)], 44100));
    expect(features.bpm).toBeNull();
    expect(features.loudnessDb).toBe(-60);
    expect(features.energyProfile.every((v) => v === 0.5)).toBe(true);
  });

  it("立体声:同相双声道贴 0,反相贴 1", () => {
    const left = clickTrack(44100, 8);
    const right = new Float32Array(left.length);
    for (let i = 0; i < left.length; i++) right[i]! = -left[i]!;
    const inPhase = extractAudioFeatures(fakeBuffer([left, new Float32Array(left)], 44100));
    const outOfPhase = extractAudioFeatures(fakeBuffer([left, right], 44100));
    expect(inPhase.stereoWidth ?? 1).toBeLessThan(0.05);
    expect(outOfPhase.stereoWidth ?? 0).toBeGreaterThan(0.95);
  });

  it("消息组装:系统消息嵌技能全文与输出契约,用户消息带实测数据", () => {
    const features = extractAudioFeatures(fakeBuffer([clickTrack()], 44100));
    const { system, user } = buildAnalysisMessages({
      fileName: "reference-国风.mp3",
      features,
      notes: "女声版更接近目标",
    });
    expect(system).toContain("Musical DNA");
    expect(system).toContain("六维度");
    expect(system).toContain("【风格短语】");
    expect(system).toContain("说怎么做,不说像谁");
    expect(user).toContain("reference-国风.mp3");
    expect(user).toContain("120");
    expect(user).toContain("20.0 秒");
    expect(user).toContain("女声版更接近目标");
  });

  it("parseAnalysisDraft 剥代码栅栏", () => {
    expect(parseAnalysisDraft("```markdown\n## 一句话 DNA\n空灵\n```")).toBe("## 一句话 DNA\n空灵");
    expect(parseAnalysisDraft("  ## 一句话 DNA\n")).toBe("## 一句话 DNA");
  });

  it("extractStylePhrases:优先【风格短语】,缺段回退一句话 DNA,双缺为 null", () => {
    const full = [
      "## 一句话 DNA",
      "空灵国风女声叙事曲",
      "## 【风格短语】",
      "- ethereal female vocals",
      "- guzheng and dizi lead, gentle percussion",
      "## 能量轨迹读数",
      "前段弱起后段推高",
    ].join("\n");
    expect(extractStylePhrases(full)).toBe("ethereal female vocals, guzheng and dizi lead, gentle percussion");

    const noPhrases = "## 一句话 DNA\n空灵国风女声叙事曲\n## 六维度解析\n……";
    expect(extractStylePhrases(noPhrases)).toBe("空灵国风女声叙事曲");

    expect(extractStylePhrases("毫无结构的内容")).toBeNull();
  });
});
