import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { TimelineRenderPlan } from "@/types/editing";
import { sha256CanonicalJson } from "@/lib/studio/remotion/canonical-json";
import type { RemotionShotPlanV1 } from "@/lib/studio/remotion/shot-plan";
import { makeChapterManifestV2 } from "@/lib/studio/remotion/remotion-workspace-test-fixtures";
import { RemotionPreviewService } from "./remotion-preview-service";

describe("RemotionPreviewService", () => {
  it("returns capability-only composition media and revokes it on release", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-remotion-preview-"));
    const imagePath = path.join(root, "shot.png");
    fs.writeFileSync(imagePath, "preview-bytes", "utf8");
    const service = new RemotionPreviewService({ resolveSourcePath: () => imagePath });

    try {
      const preview = await service.create(plan(imagePath));
      const source = preview.composition.visualClips[0]?.src;
      expect(source).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{64}\/[a-f0-9]{64}$/);
      expect(JSON.stringify(preview)).not.toContain(imagePath);
      await expect(fetch(source!)).resolves.toMatchObject({ status: 200 });

      await service.release(preview.sessionId);
      await expect(fetch(source!)).rejects.toThrow();
      await expect(service.release(preview.sessionId)).rejects.toThrow("未找到 Remotion 预览 session");
    } finally {
      await service.dispose();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("projects a StoryboardShot plan into Player props with only capability URLs", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-remotion-shot-preview-"));
    const imagePath = path.join(root, "shot.png");
    const audioPath = path.join(root, "shot.wav");
    fs.writeFileSync(imagePath, "preview-image", "utf8");
    fs.writeFileSync(audioPath, "preview-audio", "utf8");
    const service = new RemotionPreviewService({
      resolveSourcePath: (source) => source.endsWith("images/shot-001.png") ? imagePath : audioPath,
    });
    const chapter = await makeChapterManifestV2();
    const shotPlan: RemotionShotPlanV1 = {
      schemaVersion: 1,
      target: "shot",
      projectId: chapter.projectId,
      chapterId: chapter.chapterId,
      chapterRevision: chapter.revision,
      sourceSnapshotHash: chapter.sourceSnapshotHash,
      renderSettings: chapter.renderSettings,
      visualKind: "image",
      shot: chapter.shots[0]!,
      inputHash: await sha256CanonicalJson({
        schemaVersion: 1,
        target: "shot",
        projectId: chapter.projectId,
        chapterId: chapter.chapterId,
        renderSettings: chapter.renderSettings,
        visualKind: "image",
        shot: chapter.shots[0],
      }),
    };

    try {
      const preview = await service.createShot(shotPlan);
      expect(preview.composition.target).toBe("shot");
      expect(preview.composition.visualClips[0]?.src).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{64}\/[a-f0-9]{64}$/);
      expect(preview.composition.audioClips[0]?.src).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{64}\/[a-f0-9]{64}$/);
      expect(JSON.stringify(preview)).not.toContain(root);
      await service.release(preview.sessionId);
    } finally {
      await service.dispose();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

function plan(sourcePath: string): TimelineRenderPlan {
  return {
    jobId: "preview-job",
    renderSettings: { width: 1080, height: 1920, fps: 30 },
    clips: [{
      id: "visual-1",
      trackKind: "video",
      source: { kind: "storyboardImage", path: sourcePath },
      startUs: 0,
      durationUs: 1_000_000,
      trimStartUs: 0,
      speed: 1,
      volume: 0,
      muted: true,
    }],
    transitions: [],
    effects: [],
  } as unknown as TimelineRenderPlan;
}
