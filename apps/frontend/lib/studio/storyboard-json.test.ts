import { describe, expect, it } from "vitest";
import type { StoryboardItem } from "@/types/studio";
import {
  formatJsonDocument,
  formatRemotionStoryboardJson,
  formatStoryboardJson,
  validateStoryboardJson,
} from "./storyboard-json";

function makeShot(overrides: Partial<StoryboardItem> = {}): StoryboardItem {
  return {
    id: "sb-episode-1-001",
    episodeId: "episode-1",
    index: 1,
    trackKey: "episode-1-scene-1",
    trackId: "",
    duration: 2,
    prompt: "雨夜码头",
    videoDesc: "镜头向前推进",
    assetIds: ["scene-dock"],
    state: "ready",
    mediaRef: {
      kind: "image",
      path: "/project/media/generated-shot.png",
      contentSha256: "image-sha",
      imageWorkflowId: "workflow-1",
      imageWorkflowNodeId: "node-1",
    },
    audioRef: {
      kind: "audio",
      path: "/project/media/shot-voice.wav",
      contentSha256: "audio-sha",
    },
    ...overrides,
  } as StoryboardItem;
}

describe("storyboard JSON contracts", () => {
  it("formats a valid JSON document and reports syntax errors", () => {
    expect(formatJsonDocument('{"index":1}').value).toBe('{\n  "index": 1\n}');
    expect(formatJsonDocument("{bad").error).toContain("JSON 解析失败");
  });

  it("formats the canonical storyboard including generated media refs", () => {
    const json = formatStoryboardJson([makeShot({
      sourceEvidence: {
        source: "runtime",
        sourcePath: "/tmp/private-source.md",
      },
      voiceReferenceAudioPath: "/tmp/private-voice.wav",
    })]);
    expect(json).toContain('"mediaRef"');
    expect(json).toContain("generated-shot.png");
    expect(json).toContain("image-sha");
    expect(json).not.toContain("private-source.md");
    expect(json).not.toContain("private-voice.wav");
    expect(json).not.toContain("sourceEvidence");
  });

  it("accepts a valid current-chapter array", () => {
    const result = validateStoryboardJson(formatStoryboardJson([makeShot()]), "episode-1");
    expect(result.error).toBeUndefined();
    expect(result.items?.[0]?.mediaRef?.path).toContain("generated-shot.png");
  });

  it.each([
    ["not-json", "JSON 解析失败"],
    [JSON.stringify([makeShot(), makeShot({ id: "sb-episode-1-002" })]), "序号无效或重复"],
    [JSON.stringify([makeShot({ episodeId: "episode-2" })]), "不属于当前章节"],
    [JSON.stringify([makeShot({ duration: 0 })]), "时长无效"],
    [JSON.stringify([makeShot({ mediaRef: { kind: "image", path: "" } })]), "媒体引用无效"],
    [JSON.stringify([makeShot({ mediaRef: { kind: "image", path: "http://127.0.0.1:3000/session-token/asset" } })]), "运行时 URL"],
    [JSON.stringify([makeShot({ mediaRef: { kind: "image", path: "project-file://project-2/shot.png" } })]), "运行时 URL"],
  ])("rejects %s", (raw, message) => {
    expect(validateStoryboardJson(raw, "episode-1", message === "运行时 URL" ? "project-1" : undefined).error).toContain(message);
  });

  it("rejects runtime metadata fields instead of writing them back", () => {
    const raw = JSON.stringify([{
      ...makeShot(),
      sourceEvidence: { source: "runtime" },
    }]);
    expect(validateStoryboardJson(raw, "episode-1").error).toContain("不可编辑字段");
  });

  it("creates a read-only Remotion manifest without leaking absolute paths", () => {
    const manifest = JSON.parse(formatRemotionStoryboardJson({
      projectId: "project-1",
      episodeId: "episode-1",
      items: [makeShot()],
    })) as { projectId: string; shots: Array<{ media?: { fileName?: string; path?: string; contentSha256?: string } }> };
    expect(manifest.projectId).toBe("project-1");
    expect(manifest.shots[0]?.media?.fileName).toBe("generated-shot.png");
    expect(manifest.shots[0]?.media?.path).toBeUndefined();
    expect(manifest.shots[0]?.media?.contentSha256).toBe("image-sha");
  });
});
