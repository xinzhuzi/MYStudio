// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { StoryboardItem } from "@/types/studio";
import type { RemotionCurrentSlotV1, RemotionRenderJobV1 } from "@/types/remotion-workspace";
import {
  countCurrentShotSlots,
  isCurrentChapterReady,
  selectCurrentShotJobForStoryboard,
} from "./WorkbenchTab";

function storyboard(id: string, episodeId: string, outputVersion: number): StoryboardItem {
  return { id, episodeId, index: 1, outputVersion } as StoryboardItem;
}

function job(
  shotId: string,
  chapterId: string,
  shotRevision: number,
  status: RemotionRenderJobV1["status"],
  createdAt: number,
): RemotionRenderJobV1 {
  return {
    schemaVersion: 1,
    jobId: `job-${chapterId}-${shotId}-${shotRevision}-${createdAt}`,
    projectId: "project-a",
    target: { kind: "shot", chapterId, shotId, shotRevision },
    inputHash: "a".repeat(64),
    bundleContentHash: "b".repeat(64),
    renderSettingsHash: "c".repeat(64),
    templateVersion: "1.0.0",
    remotionVersion: "4.0.499",
    status,
    attempt: 1,
    progress: status === "succeeded" ? 1 : 0,
    createdAt,
  };
}

function slot(value: RemotionRenderJobV1): RemotionCurrentSlotV1 {
  return {
    schemaVersion: 1,
    projectId: value.projectId,
    target: value.target,
    job: value,
    evidence: { width: 1920, height: 1080 } as RemotionCurrentSlotV1["evidence"],
    jobPath: "/tmp/job.json",
    evidencePath: "/tmp/evidence.json",
    outputPath: "/tmp/output.mp4",
    publishedAt: value.createdAt,
  };
}

describe("WorkbenchTab split boundaries", () => {
  it("keeps the native Studio host free of legacy track-card rendering", () => {
    const tabSource = readFileSync(
      "frontend/components/panels/studio/WorkbenchTab.tsx",
      "utf8",
    );
    expect(tabSource).not.toContain('from "./WorkbenchTrackCard"');
    expect(tabSource).not.toContain("<CardHeader");
    expect(tabSource).not.toContain("<CardContent");
    expect(tabSource).toContain("章节共享音频配置");
    expect(tabSource).toContain("createRemotionChapterManifestFingerprint");
    expect(tabSource).toContain("selectAudioFile");
    expect(tabSource).toContain("对白 ducking");
    expect(tabSource).toContain("分镜音频操作");
    expect(tabSource).toContain("导入 SFX");
    expect(tabSource).toContain("重试分镜");
    expect(tabSource).toContain("取消分镜");
    expect(tabSource).toContain("useRemotionQueueScope");
    expect(tabSource).toContain("生成首镜横屏预览");
    expect(tabSource).toContain("当前槽位输出路径");
    expect(tabSource).toContain("在文件夹中显示");
    expect(tabSource).toContain("1920×1080");
    expect(tabSource).toContain("window.projectFiles?.getAbsolutePath");
    expect(tabSource).toContain("buildProjectFileUrl(projectId, `remotion/${relativeOutputPath}`)");
    expect(tabSource).toContain("requestVersion !== firstShotOutputRequestVersion.current");
    expect(tabSource).toContain("data-first-shot-preview-output");
    expect(tabSource).toContain("disabled={!firstShotAbsoluteOutputPath}");
  });

  it("counts only exact-revision succeeded slots from the current chapter", () => {
    const current = storyboard("shot-current", "chapter-001", 2);
    const otherChapter = storyboard("shot-other", "chapter-002", 1);
    const staleSlot = slot(job(current.id, "chapter-001", 1, "succeeded", 1));
    const currentSlot = slot(job(current.id, "chapter-001", 2, "succeeded", 2));

    expect(countCurrentShotSlots("chapter-001", [current, otherChapter], [staleSlot])).toBe(0);
    expect(isCurrentChapterReady("chapter-001", [current, otherChapter], [staleSlot])).toBe(false);
    expect(countCurrentShotSlots("chapter-001", [current, otherChapter], [staleSlot, currentSlot])).toBe(1);
    expect(isCurrentChapterReady("chapter-001", [current, otherChapter], [staleSlot, currentSlot])).toBe(true);
  });

  it("uses the exact current slot job before any matching historical job", () => {
    const current = storyboard("shot-current", "chapter-001", 2);
    const slotJob = job(current.id, "chapter-001", 2, "succeeded", 1);
    const newerHistorical = job(current.id, "chapter-001", 2, "running", 10);
    const wrongRevision = job(current.id, "chapter-001", 1, "failed", 20);

    expect(selectCurrentShotJobForStoryboard(current, [newerHistorical, wrongRevision], [slot(slotJob)]))
      .toBe(slotJob);
    expect(selectCurrentShotJobForStoryboard(current, [wrongRevision, newerHistorical], []))
      .toBe(newerHistorical);
  });
});
