// @vitest-environment jsdom
/**
 * scene 落地驱动测试(1116,PRD §五.5/§九②):分镜批量生图前,关联场景走
 * 产品正路入库/出图——「放入资产库」(assets:add)+「立即生成」(generateAsset→
 * 收尾 replaceImage);禁直写 SQLite(仅桥面调用);幂等/会话失败熔断/fail-open。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const assetsBridge = vi.hoisted(() => ({
  getByName: vi.fn(),
  add: vi.fn(),
  replaceImage: vi.fn(),
}));
vi.mock("@/lib/bridge/studio-assets", () => ({
  getStudioAssetsBridge: () => assetsBridge,
}));
const generateAssetMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/studio/asset-generation-orchestrator", () => ({
  generateAsset: generateAssetMock,
}));
const studioState = vi.hoisted(() => ({
  workflowConfig: { visualManualId: "daojie_ink_guofeng" },
}));
vi.mock("@/stores/studio/studio-store", () => ({
  useStudioStore: { getState: () => studioState },
}));
vi.mock("@/stores/project/project-store", () => ({
  useProjectStore: { getState: () => ({ activeProjectId: "p1" }) },
}));
vi.mock("@/lib/diagnostics/logger", () => ({
  createOperationId: (name: string) => `op-${name}`,
  logEvent: vi.fn(async () => undefined),
}));

import { useSceneStore } from "@/stores/library/scene-store";
import {
  ensureStoryboardSceneAssetsLanded,
  resetSceneLandingSessionState,
} from "./storyboard-scene-landing";
import type { StoryboardItem } from "@/types/studio";

function shot(associateAssetsNames: string[]): Pick<StoryboardItem, "id" | "index" | "associateAssetsNames"> {
  return { id: "sb-1", index: 1, associateAssetsNames };
}

function installScene(name: string) {
  useSceneStore.setState({
    scenes: [{
      id: "scene-1", name, location: "地下矿道", time: "夜", atmosphere: "压抑",
      createdAt: 0, updatedAt: 0,
    } as never],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetSceneLandingSessionState();
  assetsBridge.getByName.mockResolvedValue(null);
  assetsBridge.add.mockResolvedValue({ id: "asset-new", type: "scene", name: "灵矿坑道葬玉" });
  assetsBridge.replaceImage.mockResolvedValue(null as never);
  generateAssetMock.mockResolvedValue({ phase: "done", imageLocalPath: "/tmp/scene.png" });
});

describe("ensureStoryboardSceneAssetsLanded(§五.5 产品正路)", () => {
  it("库内无行无图:assets:add 入库→generateAsset 出图→replaceImage 收尾(全桥面,零直写)", async () => {
    installScene("灵矿坑道葬玉");
    await ensureStoryboardSceneAssetsLanded(shot(["灵矿"]));
    // 入库=「放入资产库」产品路(storeRowInAssetLibrary 同款 payload)
    expect(assetsBridge.getByName).toHaveBeenCalledWith({ type: "scene", name: "灵矿坑道葬玉" });
    expect(assetsBridge.add).toHaveBeenCalledWith(expect.objectContaining({
      type: "scene", name: "灵矿坑道葬玉",
    }));
    // 出图=「立即生成」产品路(toGenerationTask 场景轨同款任务)
    expect(generateAssetMock).toHaveBeenCalledWith(expect.objectContaining({
      assetType: "scene", name: "灵矿坑道葬玉", visualManualId: "daojie_ink_guofeng",
    }));
    // 收尾自动入库=换主图(handleGenerateSingle L8 同款)
    expect(assetsBridge.replaceImage).toHaveBeenCalledWith({
      assetId: "asset-new", sourceFilePath: "/tmp/scene.png",
    });
  });

  it("库内已有图:幂等零动作(不建行不生成)", async () => {
    installScene("灵矿坑道葬玉");
    assetsBridge.getByName.mockResolvedValue({
      id: "asset-ok", type: "scene", name: "灵矿坑道葬玉", previewUrl: "file://scene.png",
    });
    await ensureStoryboardSceneAssetsLanded(shot(["灵矿"]));
    expect(assetsBridge.add).not.toHaveBeenCalled();
    expect(generateAssetMock).not.toHaveBeenCalled();
  });

  it("库内有行无图:不重复建行,仅出图", async () => {
    installScene("灵矿坑道葬玉");
    assetsBridge.getByName.mockResolvedValue({ id: "asset-row", type: "scene", name: "灵矿坑道葬玉" });
    await ensureStoryboardSceneAssetsLanded(shot(["灵矿"]));
    expect(assetsBridge.add).not.toHaveBeenCalled();
    expect(generateAssetMock).toHaveBeenCalledTimes(1);
    expect(assetsBridge.replaceImage).toHaveBeenCalledWith({
      assetId: "asset-row", sourceFilePath: "/tmp/scene.png",
    });
  });

  it("生成失败:本会话熔断不重试(后续镜零动作)", async () => {
    installScene("灵矿坑道葬玉");
    generateAssetMock.mockResolvedValue({ phase: "failed", error: "引擎拒绝" });
    await ensureStoryboardSceneAssetsLanded(shot(["灵矿"]));
    expect(generateAssetMock).toHaveBeenCalledTimes(1);
    await ensureStoryboardSceneAssetsLanded(shot(["灵矿"]));
    expect(generateAssetMock).toHaveBeenCalledTimes(1);
  });

  it("无场景匹配/桥缺席:零动作 fail-open", async () => {
    await ensureStoryboardSceneAssetsLanded(shot(["不存在场景"]));
    expect(assetsBridge.add).not.toHaveBeenCalled();
    expect(generateAssetMock).not.toHaveBeenCalled();
  });

  it("落地链异常:fail-open 不抛错(不阻断分镜生图主链)", async () => {
    installScene("灵矿坑道葬玉");
    assetsBridge.getByName.mockRejectedValue(new Error("桥炸了"));
    await expect(ensureStoryboardSceneAssetsLanded(shot(["灵矿"]))).resolves.toBeUndefined();
  });

  it("未选视觉手册:出图跳过但入库照走(出图属「立即生成」前置条件)", async () => {
    installScene("灵矿坑道葬玉");
    studioState.workflowConfig = { visualManualId: "" };
    try {
      await ensureStoryboardSceneAssetsLanded(shot(["灵矿"]));
      expect(assetsBridge.add).toHaveBeenCalledTimes(1);
      expect(generateAssetMock).not.toHaveBeenCalled();
    } finally {
      studioState.workflowConfig = { visualManualId: "daojie_ink_guofeng" };
    }
  });
});
