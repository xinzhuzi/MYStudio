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
  agentWorkData: [] as Array<Record<string, unknown>>,
}));
vi.mock("@/stores/studio/studio-store", () => ({
  useStudioStore: { getState: () => studioState },
}));
const projectFilesBridge = vi.hoisted(() => ({
  getAbsolutePath: vi.fn(),
}));
vi.mock("@/lib/bridge/project-files", () => ({
  getProjectFilesBridge: () => projectFilesBridge,
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
  ensureStoryboardDerivedAssetsLanded,
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
  studioState.agentWorkData = [];
  projectFilesBridge.getAbsolutePath.mockReset();
  useSceneStore.setState({ scenes: [] } as never);
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

// ─── 1117 C2 G3/G5:五级序触发/态行图导入/scene-unresolved/衍生落行 ──────────

describe("ensureStoryboardSceneAssetsLanded 1117 C2(G1 五级序+态行导入)", () => {
  it("五级序触发:sceneName 字段命中(S8-S12 落地驱动不再空转)", async () => {
    installScene("金水塾馆");
    await ensureStoryboardSceneAssetsLanded({
      id: "sb-1", index: 1, associateAssetsNames: ["独孤剑尘"], sceneName: "金水塾馆",
    } as never);
    expect(assetsBridge.getByName).toHaveBeenCalledWith({ type: "scene", name: "金水塾馆" });
    expect(assetsBridge.add).toHaveBeenCalledWith(expect.objectContaining({
      type: "scene", name: "金水塾馆",
    }));
  });

  it("态行带 referenceImage:优先导入既有图(免烧卡),generateAsset 零调用", async () => {
    useSceneStore.setState({
      scenes: [{
        id: "scene-mp381wo", name: "金水塾馆·夜内态：两盏油灯·墨板·盘坐孩童", location: "金水塾馆",
        time: "", atmosphere: "两盏油灯·墨板", projectId: "p1",
        referenceImage: "project-file://p1/media/ai-image/scene-state.png",
        createdAt: 0, updatedAt: 0,
      } as never],
    });
    projectFilesBridge.getAbsolutePath.mockResolvedValue("/managed/media/ai-image/scene-state.png");
    await ensureStoryboardSceneAssetsLanded({ id: "sb-1", index: 1, sceneName: "金水塾馆·夜内态：两盏油灯·墨板·盘坐孩童" } as never);
    expect(assetsBridge.add).toHaveBeenCalledWith(expect.objectContaining({
      type: "scene",
      name: "金水塾馆·夜内态：两盏油灯·墨板·盘坐孩童",
      sourceFilePath: "/managed/media/ai-image/scene-state.png",
    }));
    expect(generateAssetMock).not.toHaveBeenCalled();
  });

  it("态行图导入既有行:replaceImage 换主图而非建行", async () => {
    useSceneStore.setState({
      scenes: [{
        id: "scene-mp381wo", name: "金水塾馆·夜内态", location: "金水塾馆",
        referenceImage: "project-file://p1/media/s.png", createdAt: 0, updatedAt: 0,
      } as never],
    });
    projectFilesBridge.getAbsolutePath.mockResolvedValue("/managed/media/s.png");
    assetsBridge.getByName.mockResolvedValue({ id: "asset-row", type: "scene", name: "金水塾馆·夜内态" });
    assetsBridge.replaceImage.mockResolvedValue({ id: "asset-row", type: "scene" } as never);
    await ensureStoryboardSceneAssetsLanded({ id: "sb-1", index: 1, sceneName: "金水塾馆·夜内态" } as never);
    expect(assetsBridge.replaceImage).toHaveBeenCalledWith({
      assetId: "asset-row", sourceFilePath: "/managed/media/s.png",
    });
    expect(assetsBridge.add).not.toHaveBeenCalled();
    expect(generateAssetMock).not.toHaveBeenCalled();
  });

  it("场景链全断:scene-unresolved 留痕(与门A 拒发双痕互证),零建行零烧卡", async () => {
    const { logEvent } = await import("@/lib/diagnostics/logger");
    await ensureStoryboardSceneAssetsLanded({ id: "sb-1", index: 1, associateAssetsNames: ["不存在"] } as never);
    const sceneUnresolved = vi.mocked(logEvent).mock.calls
      .some((call) => JSON.stringify(call[0]?.context ?? {}).includes("scene-unresolved"));
    expect(sceneUnresolved).toBe(true);
    expect(assetsBridge.add).not.toHaveBeenCalled();
    expect(generateAssetMock).not.toHaveBeenCalled();
  });
});

describe("ensureStoryboardDerivedAssetsLanded(G5② 衍生落行管道)", () => {
  const plan = () => {
    studioState.agentWorkData = [{
      id: "work-1", key: "directorPlan", episodeId: "chapter-001",
      data: [
        "## ⑦ 衍生资产预划清单",
        "| 资产名 | 衍生状态 | 原因 |",
        "| 晏燎·夜课少年 | 基础态锁定：灰布短褐袖口短一截 | Sc3 |",
        "| 金水塾馆·夜 | 场景时间态（院门朽匾） | Sc3 |",
      ].join("\n"),
      createdAt: 1, updatedAt: 1,
    }];
  };

  it("角色衍生态 assets:add 只建行不烧卡;场景态走三库零动作", async () => {
    plan();
    await ensureStoryboardDerivedAssetsLanded({ id: "sb-1", index: 1, episodeId: "chapter-001" } as never);
    expect(assetsBridge.getByName).toHaveBeenCalledWith({ type: "role", name: "晏燎·夜课少年" });
    expect(assetsBridge.add).toHaveBeenCalledTimes(1);
    expect(assetsBridge.add).toHaveBeenCalledWith(expect.objectContaining({
      type: "role", name: "晏燎·夜课少年",
      description: expect.stringContaining("灰布短褐袖口短一截"),
      // 1118 E3:着装态=视觉事实,stateText 逐字落 prompt 列(禁只写 description 留空雷)
      prompt: "基础态锁定：灰布短褐袖口短一截",
    }));
    expect(generateAssetMock).not.toHaveBeenCalled();
  });

  it("幂等:库内已有行跳过;同会话第二镜零重复建行", async () => {
    plan();
    assetsBridge.getByName.mockResolvedValue({ id: "d1", type: "role", name: "晏燎·夜课少年" });
    await ensureStoryboardDerivedAssetsLanded({ id: "sb-1", index: 1, episodeId: "chapter-001" } as never);
    expect(assetsBridge.add).not.toHaveBeenCalled();
    assetsBridge.getByName.mockResolvedValue(null);
    await ensureStoryboardDerivedAssetsLanded({ id: "sb-2", index: 2, episodeId: "chapter-001" } as never);
    expect(assetsBridge.add).not.toHaveBeenCalled();
  });

  it("无规划/桥异常 fail-open:不抛错不阻断主链", async () => {
    await expect(
      ensureStoryboardDerivedAssetsLanded({ id: "sb-1", index: 1 } as never),
    ).resolves.toBeUndefined();
    expect(assetsBridge.add).not.toHaveBeenCalled();
  });
});
