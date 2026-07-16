import { describe, expect, it } from "vitest";
import type { StoryboardItem } from "@/types/studio";
import {
  approvedVisualReview,
  createHumanContinuityAssetApproval,
  normalizeContinuityAssetVersion,
  visualContinuityFingerprint,
  visualReviewInputFingerprint,
} from "@/lib/studio/visual-continuity";
import { auditDaojieVisualContinuityState } from "./audit-daojie-visual-continuity";

function approvedFixture() {
  const scene = createHumanContinuityAssetApproval(normalizeContinuityAssetVersion({
    assetId: "scene:dock",
    versionId: "scene:dock:main:v1",
    assetKind: "scene",
    label: "码头主轴",
    referenceImagePaths: ["/dock.png"],
    reviewEvidencePaths: ["/dock_thumb.png"],
    reviewEvidenceSha256: ["a".repeat(64)],
    reviewEvidenceVerifiedAt: 1,
    sceneViewpointId: "dock-main-axis",
    spatialLayout: "河岸、石阶、缆绳和船只位置固定",
    lightingDesign: "冷青晨雾",
    colorPalette: "墨青灰蓝",
    source: "test",
  }), {
    status: "approved",
    reviewedAt: 1,
    evidencePaths: ["/dock_thumb.png"],
  });
  const storyboard: StoryboardItem = {
    id: "sb-chapter-001-001",
    episodeId: "chapter-001",
    index: 1,
    trackKey: "chapter-001-scene-1",
    trackId: "track-1",
    duration: 4,
    prompt: "码头建立镜头",
    videoDesc: "码头建立镜头",
    assetIds: [scene.assetId],
    mediaRef: { kind: "image", path: "/shot-001.png" },
    state: "ready",
    orderedReferenceManifest: [{
      order: 1,
      assetId: scene.assetId,
      versionId: scene.versionId,
      imagePath: scene.referenceImagePaths[0]!,
      assetKind: "scene",
      referenceRole: "scene-viewpoint",
      sceneViewpointId: scene.sceneViewpointId,
      contentFingerprint: scene.contentFingerprint,
      approvalFingerprint: scene.approvalFingerprint,
      approved: scene.approved,
    }],
    continuityState: {
      groupId: "dock",
      sceneVersionId: scene.versionId,
      sceneViewpointId: scene.sceneViewpointId!,
      lighting: "冷青晨雾",
      palette: "墨青灰蓝",
      actionIn: "建立场景",
      actionOut: "继续向右",
      characters: [],
      inputFingerprint: "",
    },
  };
  storyboard.continuityState!.inputFingerprint = visualContinuityFingerprint(storyboard);
  storyboard.visualReview = approvedVisualReview({
    reviewedAt: 2,
    evidencePaths: [storyboard.mediaRef!.path],
    sceneChecks: [{ sceneVersionId: scene.versionId, passed: true }],
    propChecks: [],
    transitionChecks: [],
    textWatermarkCheck: { passed: true },
    inputFingerprint: visualReviewInputFingerprint(storyboard),
  });
  return { scene, storyboard };
}

describe("Daojie direct-video visual preflight", () => {
  it("accepts only current human-approved storyboards and asset versions", () => {
    const { scene, storyboard } = approvedFixture();
    expect(auditDaojieVisualContinuityState({
      storyboards: [storyboard],
      continuityAssetVersions: [scene],
    })).toMatchObject({ ok: true, storyboards: 1, approved: 1, pending: 0 });
  });

  it("blocks a pending storyboard before direct media generation", () => {
    const { scene, storyboard } = approvedFixture();
    storyboard.visualReview = undefined;
    expect(() => auditDaojieVisualContinuityState({
      storyboards: [storyboard],
      continuityAssetVersions: [scene],
    })).toThrow("approved=0, pending=1");
  });
});
