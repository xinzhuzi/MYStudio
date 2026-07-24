// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContinuityAssetVersion, StoryboardItem } from "@/types/studio";
import {
  createHumanContinuityAssetApproval,
  normalizeContinuityAssetVersion,
  storyboardShotSemanticsFingerprint,
  visualContinuityFingerprint,
} from "@/lib/studio/visual-continuity";
import { VisualContinuityReviewPanel } from "./VisualContinuityReviewPanel";

afterEach(cleanup);

function storyboard(index: number): StoryboardItem {
  const versions = continuityVersions();
  const item: StoryboardItem = {
    id: `sb-${index}`,
    episodeId: "chapter-001",
    index,
    trackKey: "dock",
    trackId: "track-dock",
    duration: 4,
    prompt: `镜头 ${index}`,
    videoDesc: `码头动作 ${index}`,
    assetIds: ["character:dugu", "scene:dock"],
    mediaRef: { kind: "image", path: `/frames/sb-${index}.png` },
    state: "ready",
    shotSemantics: {
      sceneViewpointId: "dock-main-axis",
      personFree: false,
      visibleCharacters: [{
        name: "独孤剑尘",
        position: "中景",
        orientation: "朝右",
        actionIn: "迈步",
        actionOut: "继续迈步",
      }],
      visibleProps: [{
        name: "三层油布剑包",
        position: "背部中景",
        state: "背负完整",
      }],
      actionIn: index > 1 ? "承接上一镜" : "建立场景",
      actionOut: "继续向右",
    },
    orderedReferenceManifest: versions.map((version, order) => ({
      order: order + 1,
      assetId: version.assetId,
      assetName: version.label,
      assetKind: version.assetKind,
      versionId: version.versionId,
      imagePath: version.referenceImagePaths[0],
      referenceImagePaths: version.referenceImagePaths,
      referenceViewTypes: version.referenceViewTypes,
      referenceRole: version.assetKind === "scene" ? "scene-viewpoint" : version.assetKind === "prop" ? "prop-state" : "canonical",
      wardrobeVersion: version.wardrobeVersion,
      sceneViewpointId: version.sceneViewpointId,
      identityAnchors: version.identityAnchors,
      contentFingerprint: version.contentFingerprint,
      approvalFingerprint: version.approvalFingerprint,
      approved: version.approved,
    })),
    continuityState: {
      groupId: "chapter-001:dock:1-3",
      previousStoryboardId: index > 1 ? `sb-${index - 1}` : undefined,
      sceneVersionId: "dock:morning",
      sceneViewpointId: "dock-main-axis",
      lighting: "冷青晨雾",
      palette: "墨青灰蓝",
      actionIn: index > 1 ? "承接上一镜" : "建立场景",
      actionOut: "继续向右",
      characters: [{
        characterId: "dugu",
        versionId: "dugu:base",
        position: "中景",
        orientation: "朝右",
        actionIn: "迈步",
        actionOut: "继续迈步",
      }],
      sourceSemanticsFingerprint: "",
      inputFingerprint: "",
    },
  };
  item.continuityState!.sourceSemanticsFingerprint = storyboardShotSemanticsFingerprint(item.shotSemantics);
  item.continuityState!.inputFingerprint = visualContinuityFingerprint(item);
  return item;
}

function continuityVersion(
  assetKind: ContinuityAssetVersion["assetKind"],
  approved = true,
): ContinuityAssetVersion {
  const assetId = assetKind === "character" ? "character:dugu" : assetKind === "scene" ? "scene:dock" : "prop:sword-wrap";
  const versionId = assetKind === "character" ? "dugu:base" : assetKind === "scene" ? "dock:morning" : "sword-wrap:intact";
  const reviewEvidencePaths = assetKind === "character"
    ? ["/bible/dugu-front_thumb.png", "/bible/dugu-three-quarter_thumb.png", "/bible/dugu-side_thumb.png"]
    : [`/bible/${assetKind}_thumb.png`];
  const version = normalizeContinuityAssetVersion({
    assetId,
    versionId,
    assetKind,
    label: assetKind === "character" ? "grey-town" : assetKind === "scene" ? "码头晨雾主轴" : "三层油布剑包",
    referenceImagePaths: assetKind === "character"
      ? ["/bible/dugu-front.png", "/bible/dugu-three-quarter.png", "/bible/dugu-side.png"]
      : [`/bible/${assetKind}.png`],
    reviewEvidencePaths,
    reviewEvidenceSha256: reviewEvidencePaths.map(() => "a".repeat(64)),
    reviewEvidenceVerifiedAt: approved ? 10 : undefined,
    referenceViewTypes: assetKind === "character" ? ["front", "three-quarter", "side"] : undefined,
    identityAnchors: assetKind === "character"
      ? { faceShape: "清瘦长脸", hairStyle: "银白长发半束", uniqueMarks: ["背负三层油布剑包"] }
      : undefined,
    negativePrompt: assetKind === "character" ? { avoid: ["腰悬完整剑"] } : undefined,
    wardrobeVersion: assetKind === "character" ? "grey-town" : undefined,
    sceneViewpointId: assetKind === "scene" ? "dock-main-axis" : undefined,
    spatialLayout: assetKind === "scene" ? "河岸、栈桥与仓棚位置固定" : undefined,
    lightingDesign: assetKind === "scene" ? "冷青晨雾" : undefined,
    colorPalette: assetKind === "scene" ? "墨青灰蓝" : undefined,
    structurallyComplete: true,
    contentFingerprint: "",
    approved: false,
    source: "test-bible",
  });
  return approved
    ? createHumanContinuityAssetApproval(version, {
        status: "approved",
        evidencePaths: version.reviewEvidencePaths!,
        reviewedAt: 10,
      })
    : version;
}

function continuityVersions(approveCharacter = true) {
  return [continuityVersion("character", approveCharacter), continuityVersion("scene"), continuityVersion("prop")];
}

describe("VisualContinuityReviewPanel", () => {
  it("shows previous/current/next evidence and requires every current-shot check before approval", () => {
    const onReview = vi.fn();
    render(<VisualContinuityReviewPanel
      storyboards={[storyboard(1), storyboard(2), storyboard(3)]}
      continuityAssetVersions={continuityVersions()}
      onReview={onReview}
      onReviewAsset={vi.fn()}
    />);

    expect(screen.getByRole("img", { name: "当前镜第 1 镜画面" }).getAttribute("src")).toBe("file:///frames/sb-1.png");
    expect(screen.getByRole("img", { name: "下一镜第 2 镜画面" })).toBeTruthy();
    expect(screen.getAllByText(/批准指纹：/)).toHaveLength(3);
    const approve = screen.getByRole("button", { name: "批准第 1 镜" }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);

    fireEvent.click(screen.getByRole("checkbox", { name: /角色 dugu/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /场景 dock:morning/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /道具 prop:sword-wrap/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /文字与水印/ }));
    expect(approve.disabled).toBe(false);
    fireEvent.click(approve);

    expect(onReview).toHaveBeenCalledWith("sb-1", expect.objectContaining({
      status: "approved",
      evidencePaths: ["/frames/sb-1.png"],
      characterChecks: [{ characterId: "dugu", passed: true }],
      sceneChecks: [{ sceneVersionId: "dock:morning", passed: true }],
      propChecks: [{ assetId: "prop:sword-wrap", versionId: "sword-wrap:intact", passed: true }],
      transitionChecks: [],
      textWatermarkCheck: { passed: true },
    }));
  });

  it("requires a reason for rejection and resets checks when navigating", () => {
    const onReview = vi.fn();
    render(<VisualContinuityReviewPanel
      storyboards={[storyboard(1), storyboard(2)]}
      continuityAssetVersions={continuityVersions()}
      onReview={onReview}
      onReviewAsset={vi.fn()}
    />);

    const rejectFirst = screen.getByRole("button", { name: "驳回第 1 镜" }) as HTMLButtonElement;
    expect(rejectFirst.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("驳回原因"), { target: { value: "独孤剑尘服装颜色变化" } });
    fireEvent.click(rejectFirst);
    expect(onReview).toHaveBeenCalledWith("sb-1", expect.objectContaining({
      status: "rejected",
      reasons: ["独孤剑尘服装颜色变化"],
    }));

    fireEvent.click(screen.getByRole("button", { name: "审核下一镜" }));
    expect((screen.getByRole("button", { name: "批准第 2 镜" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("checkbox", { name: /与上一镜 sb-1/ }).getAttribute("data-state")).toBe("unchecked");
    expect((screen.getByLabelText("驳回原因") as HTMLTextAreaElement).value).toBe("");
  });

  it("shows ordered canonical evidence and blocks shot approval until every asset is human-approved", () => {
    const onReviewAsset = vi.fn();
    render(<VisualContinuityReviewPanel
      storyboards={[storyboard(1)]}
      continuityAssetVersions={continuityVersions(false)}
      onReview={vi.fn()}
      onReviewAsset={onReviewAsset}
    />);

    expect(screen.getByRole("img", { name: "grey-town front 参考图" })).toBeTruthy();
    expect(screen.getByText(/背负三层油布剑包/)).toBeTruthy();
    expect(screen.getByText("待人工审核")).toBeTruthy();
    expect((screen.getByRole("button", { name: "批准第 1 镜" }) as HTMLButtonElement).disabled).toBe(true);

    const approveAsset = screen.getByRole("button", { name: "批准资产 character:dugu dugu:base" }) as HTMLButtonElement;
    expect(approveAsset.disabled).toBe(true);
    expect(screen.getByText(/请使用单资产安全推广命令/)).toBeTruthy();
    fireEvent.click(approveAsset);
    expect(onReviewAsset).not.toHaveBeenCalled();
  });

  it("blocks shot approval when the continuity input fingerprint is stale", () => {
    const item = storyboard(1);
    item.continuityState!.inputFingerprint = "stale-continuity-fingerprint";
    render(<VisualContinuityReviewPanel
      storyboards={[item]}
      continuityAssetVersions={continuityVersions()}
      onReview={vi.fn()}
      onReviewAsset={vi.fn()}
    />);

    fireEvent.click(screen.getByRole("checkbox", { name: /角色 dugu/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /场景 dock:morning/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /道具 prop:sword-wrap/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /文字与水印/ }));

    expect(screen.getByText(/连续性输入指纹已失效/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "批准第 1 镜" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables asset approval when safe thumbnail evidence is missing", () => {
    const versions = continuityVersions(false);
    versions[0] = normalizeContinuityAssetVersion({ ...versions[0]!, reviewEvidencePaths: [] });
    render(<VisualContinuityReviewPanel
      storyboards={[storyboard(1)]}
      continuityAssetVersions={versions}
      onReview={vi.fn()}
      onReviewAsset={vi.fn()}
    />);

    expect(screen.getByText(/缺少逐图安全缩略证据/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "批准资产 character:dugu dugu:base" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("requires a concrete reason before rejecting a continuity asset", () => {
    const onReviewAsset = vi.fn();
    render(<VisualContinuityReviewPanel
      storyboards={[storyboard(1)]}
      continuityAssetVersions={continuityVersions(false)}
      onReview={vi.fn()}
      onReviewAsset={onReviewAsset}
    />);

    const reject = screen.getByRole("button", { name: "驳回资产 character:dugu dugu:base" }) as HTMLButtonElement;
    expect(reject.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("资产审核说明 character:dugu dugu:base"), {
      target: { value: "背部未出现三层油布剑包" },
    });
    expect(reject.disabled).toBe(false);
    fireEvent.click(reject);
    expect(onReviewAsset).toHaveBeenCalledWith("character:dugu", "dugu:base", {
      status: "rejected",
      reason: "背部未出现三层油布剑包",
      evidencePaths: ["/bible/dugu-front_thumb.png", "/bible/dugu-three-quarter_thumb.png", "/bible/dugu-side_thumb.png"],
    });
  });
});
