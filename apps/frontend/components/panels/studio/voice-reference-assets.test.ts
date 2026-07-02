import { describe, expect, it } from "vitest";
import { buildVoiceReferenceAssets } from "./voice-reference-assets";
import type { StudioMaterial } from "@/types/studio";
import type { StudioAssetSummary } from "@/types/studio-assets";

describe("buildVoiceReferenceAssets", () => {
  it("uses audio assets as cloneable voice references", () => {
    const materials: StudioMaterial[] = [
      material("a1", "少年独白", "audio", "/project/audio/boy.wav"),
      material("v1", "片段", "video", "/project/video/clip.mp4"),
      material("a2", "空路径", "audio", "   "),
    ];
    const runtimeAssets: StudioAssetSummary[] = [
      {
        id: "runtime-audio",
        source: "toonflow-runtime",
        type: "audio",
        name: "女声旁白",
        description: "这是一段资产库识别出的中文台词。",
        previewUrl: "file:///project/audio/girl.wav",
        filePath: "audio/girl.wav",
        sourcePath: "/project/audio/girl.wav",
      },
      {
        id: "runtime-scene",
        source: "toonflow-runtime",
        type: "scene",
        name: "场景",
        filePath: "/project/scene.png",
      },
      {
        id: "duplicate-audio",
        source: "toonflow-runtime",
        type: "audio",
        name: "重复音频",
        filePath: "/project/audio/boy.wav",
      },
    ];

    expect(buildVoiceReferenceAssets(materials, runtimeAssets)).toEqual([
      {
        id: "material:a1",
        name: "少年独白",
        filePath: "/project/audio/boy.wav",
        referenceText: "少年独白",
        sourceLabel: "少年独白.wav",
      },
      {
        id: "runtime-audio",
        name: "女声旁白",
        filePath: "/project/audio/girl.wav",
        referenceText: "这是一段资产库识别出的中文台词。",
        sourceLabel: "girl.wav",
      },
    ]);
  });

  it("uses short file names for source labels to keep the selector readable", () => {
    const materials: StudioMaterial[] = [
      material("a1", "深路径音色", "audio", "/project/audio/deep/path/voice.wav", "/project/audio/deep/path/voice.wav"),
    ];

    expect(buildVoiceReferenceAssets(materials, [])).toEqual([
      {
        id: "material:a1",
        name: "深路径音色",
        filePath: "/project/audio/deep/path/voice.wav",
        referenceText: "深路径音色",
        sourceLabel: "voice.wav",
      },
    ]);
  });

  it("uses runtime audio filePath when sourcePath is absent", () => {
    const runtimeAssets: StudioAssetSummary[] = [
      {
        id: "file-path-audio",
        source: "manying-local",
        type: "audio",
        name: "青年男声",
        filePath: "/project/audio/voice.wav",
      },
    ];

    expect(buildVoiceReferenceAssets([], runtimeAssets)).toEqual([
      {
        id: "file-path-audio",
        name: "青年男声",
        filePath: "/project/audio/voice.wav",
        referenceText: "青年男声",
        sourceLabel: "voice.wav",
      },
    ]);
  });
});

function material(
  id: string,
  name: string,
  kind: StudioMaterial["kind"],
  localPath: string,
  sourceName = `${name}.wav`,
): StudioMaterial {
  return {
    id,
    name,
    kind,
    localPath,
    sourceName,
    size: 1024,
    importedAt: 1,
  };
}
