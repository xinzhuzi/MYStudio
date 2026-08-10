import { describe, expect, it } from "vitest";
import { makeCurrentSlot } from "@/lib/studio/remotion/remotion-workspace-test-fixtures";
import type { StoryboardItem } from "@/types/studio";
import { buildVideoWorkflowChapterRunRequest } from "./chapter-run-request";

function storyboard(overrides: Partial<StoryboardItem> = {}): StoryboardItem {
  return {
    id: "shot-001",
    episodeId: "chapter-001",
    index: 1,
    duration: 2,
    durationTarget: 2,
    state: "ready",
    stale: false,
    ttsSpokenText: "这是当前口播文本",
    audioRef: { kind: "audio", path: "project-file://project-a/tts/shot-001.wav", contentSha256: "a".repeat(64) },
    ...overrides,
  } as StoryboardItem;
}

describe("buildVideoWorkflowChapterRunRequest", () => {
  it("rejects an invalidated storyboard before creating a reviewable video-use revision", async () => {
    await expect(buildVideoWorkflowChapterRunRequest({
      projectId: "project-a",
      chapterId: "chapter-001",
      revision: 2,
      storyboards: [storyboard({ stale: true, staleReason: "上游素材已替换" })],
      remotionShotSlots: [makeCurrentSlot()],
    })).rejects.toThrow("分镜 shot-001 已过期：上游素材已替换");
  });

  it("builds a request only from a valid Remotion StoryboardShot", async () => {
    const request = await buildVideoWorkflowChapterRunRequest({
      projectId: "project-a",
      chapterId: "chapter-001",
      revision: 2,
      storyboards: [storyboard()],
      remotionShotSlots: [makeCurrentSlot()],
    });

    expect(request.shots).toEqual([expect.objectContaining({
      shotId: "shot-001",
      sourceSha256: "c".repeat(64),
      audioSha256: "a".repeat(64),
    })]);
    expect(request.storyboardSourcePolicy).toBe("current-ready");
  });

  it("allows an explicitly selected existing storyboard while preserving the audit policy", async () => {
    const request = await buildVideoWorkflowChapterRunRequest({
      projectId: "project-a",
      chapterId: "chapter-001",
      revision: 2,
      storyboardSourcePolicy: "reuse-existing",
      storyboards: [storyboard({ stale: true, staleReason: "付费重生成暂缓" })],
      remotionShotSlots: [makeCurrentSlot()],
    });

    expect(request.storyboardSourcePolicy).toBe("reuse-existing");
    expect(request.shots).toHaveLength(1);
  });
});
