// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiManager } from "@/lib/ai/ai-manager";
import { logEvent } from "@/lib/diagnostics/logger";
import { saveImageToLocal } from "@/lib/media/image-storage";
import { polishAssetPrompt, selectDaojiePaletteSchemeForAsset } from "@/lib/ai/prompt-polisher";
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import { useAppSettingsStore } from "@/stores/app/app-settings-store";
import { useProjectStore } from "@/stores/project/project-store";
import { usePropsLibraryStore } from "@/stores/library/props-library-store";
import { useSceneStore } from "@/stores/library/scene-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import {
  applyMatchedAssets,
  generateAsset,
  type AssetGenerationTask,
  type AssetGenerationProgress,
} from "./asset-generation-orchestrator";

vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: {
    image: vi.fn().mockResolvedValue({ imageUrl: "https://example.com/prop.png" }),
  },
}));

vi.mock("@/lib/diagnostics/logger", () => ({
  createOperationId: (prefix: string) => `${prefix}-test`,
  logEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/ai/prompt-polisher", () => ({
  selectDaojiePaletteSchemeForAsset: vi.fn().mockResolvedValue(null),
  sanitizeExtendedManualPrompt: vi.fn((text: string) => text.replace(/电影质感/g, "工笔成片质感").replace(/宣纸肌理|宣纸质感/g, "浅净平涂底")),
  polishAssetPrompt: vi.fn().mockResolvedValue({
    status: "success",
    prompt: "polished prop prompt",
    negativePrompt: "avoid modern plastic",
  }),
}));

vi.mock("@/lib/media/image-storage", () => ({
  saveImageToLocal: vi
    .fn()
    .mockResolvedValue("local-image://props/prop-1.png"),
}));

beforeEach(() => {
  vi.clearAllMocks();
  delete (window as any).projectFiles;
  useStudioStore.getState().resetStudioWorkflow();
  useProjectStore.setState({
    activeProjectId: "dao-project",
    activeProject: {
      id: "dao-project",
      name: "道劫",
      createdAt: 1,
      updatedAt: 1,
    },
  });
  vi.mocked(aiManager.image).mockResolvedValue({ imageUrl: "https://example.com/prop.png" });
  (usePropsLibraryStore as any).persist?.setOptions({
    storage: {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    },
  });
  usePropsLibraryStore.setState({
    items: [
      {
        id: "prop-1",
        name: "断剑",
        description: "一柄断裂的古剑",
        imageUrl: "",
        folderId: null,
        createdAt: 1,
      },
    ],
    folders: [],
    selectedFolderId: "all",
  });
  useCharacterLibraryStore.setState({
    characters: [
      {
        id: "char-1",
        name: "独孤剑尘",
        description: "白衣剑修",
        visualTraits: "",
        views: [],
        variations: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    folders: [],
    currentFolderId: null,
  });
  useSceneStore.setState({
    scenes: [
      {
        id: "scene-1",
        name: "矿场",
        location: "山谷",
        time: "夜",
        atmosphere: "冷雨",
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    folders: [],
    currentFolderId: null,
  });
  useAppSettingsStore.getState().setImageGenerationSettings({
    defaultAspectRatio: "16:9",
    defaultResolution: "2K",
    compatibilityRetryEnabled: true,
    compatibilityRetryAspectRatio: "1:1",
    compatibilityRetryResolution: "1K",
  });
});

describe("asset-generation-orchestrator", () => {
  it("writes generated prop prompt and image back to the props store", async () => {
    const result = await generateAsset({
      assetId: "prop-1",
      assetType: "prop",
      name: "断剑",
      description: "一柄断裂的古剑",
      isDerivative: false,
      visualManualId: "ink",
    });

    expect(result.phase).toBe("done");
    const prop = usePropsLibraryStore
      .getState()
      .items.find((item) => item.id === "prop-1");
    expect(prop?.visualPrompt).toBe("polished prop prompt");
    expect(prop?.promptState).toBe("ready");
    expect(prop?.imageUrl).toBe("local-image://props/prop-1.png");
  });

  it("defaults aspect ratio by asset type when not explicitly set (character 21:9, prop 1:1)", async () => {
    await generateAsset({
      assetId: "prop-1",
      assetType: "character",
      name: "林霜",
      description: "清冷出尘的女修",
      isDerivative: false,
      visualManualId: "ink",
    });
    expect(aiManager.image).toHaveBeenCalledWith(
      expect.objectContaining({ aspectRatio: "21:9" }),
      "character",
    );

    vi.mocked(aiManager.image).mockClear();
    await generateAsset({
      assetId: "prop-1",
      assetType: "prop",
      name: "断剑",
      description: "一柄断裂的古剑",
      isDerivative: false,
      visualManualId: "ink",
    });
    expect(aiManager.image).toHaveBeenCalledWith(
      expect.objectContaining({ aspectRatio: "1:1" }),
      "prop",
    );

    vi.mocked(aiManager.image).mockClear();
    await generateAsset({
      assetId: "prop-1",
      assetType: "prop",
      name: "断剑",
      description: "一柄断裂的古剑",
      isDerivative: false,
      visualManualId: "ink",
      aspectRatio: "3:2",
    });
    expect(aiManager.image).toHaveBeenCalledWith(
      expect.objectContaining({ aspectRatio: "3:2" }),
      "prop",
    );
  });

  it("saves generated workflow assets inside the active project when projectId is provided", async () => {
    usePropsLibraryStore.setState({
      items: [
        {
          id: "prop-parent",
          name: "断剑",
          description: "一柄断裂的古剑",
          imageUrl: "project-file://dao-project/workflow-images/assets/prop-parent.png",
          folderId: null,
          projectId: "dao-project",
          createdAt: 1,
        },
        {
          id: "prop-1",
          name: "断剑",
          category: "雨夜湿剑",
          description: "雨夜状态",
          imageUrl: "",
          folderId: null,
          parentId: "prop-parent",
          isDerivative: true,
          projectId: "dao-project",
          createdAt: 2,
        },
      ],
      folders: [],
      selectedFolderId: "all",
    });
    (window as any).projectFiles = {
      saveImage: vi.fn().mockResolvedValue({
        success: true,
        url: "project-file://dao-project/workflow-images/assets/prop-1.png",
        size: 1234,
      }),
    };

    const result = await generateAsset({
      assetId: "prop-1",
      assetType: "prop",
      projectId: "dao-project",
      name: "断剑",
      description: "一柄断裂的古剑",
      isDerivative: true,
      visualManualId: "ink",
      referenceImages: ["project-file://dao-project/workflow-images/assets/prop-parent.png"],
      imageWorkflowId: "flow-existing-prop-derivative",
    });

    expect(result.phase).toBe("done");
    expect(aiManager.image).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceImages: ["project-file://dao-project/workflow-images/assets/prop-parent.png"],
      }),
      "prop",
    );
    expect(window.projectFiles?.saveImage).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "dao-project",
      relativePath: expect.stringMatching(/^workflow-images\/assets\/prop\/prop-1-/),
      source: "https://example.com/prop.png",
    }));
    const prop = usePropsLibraryStore.getState().getPropById("prop-1");
    expect(prop?.imageUrl).toBe("project-file://dao-project/workflow-images/assets/prop-1.png");
    expect(prop?.imageWorkflowId).toBe("flow-existing-prop-derivative");
    expect(prop?.imageWorkflowNodeId).toBeTruthy();
    const graph = useStudioStore
      .getState()
      .imageWorkflows.find((item) => item.id === prop?.imageWorkflowId);
    expect(graph).toMatchObject({
      name: expect.stringContaining("道劫"),
      target: {
        kind: "asset",
        assetType: "prop",
        parentId: "prop-parent",
        id: "prop-1",
      },
    });
    expect(graph?.id).toBe("flow-existing-prop-derivative");
    expect(graph?.nodes.some((node) => node.type === "reference")).toBe(true);
    expect(graph?.nodes.some((node) => node.type === "generated")).toBe(true);
  });

  it("scopes chapter-exclusive derivative assets under the chapter directory and keeps base assets shared", async () => {
    usePropsLibraryStore.setState({
      items: [
        {
          id: "prop-parent",
          name: "断剑",
          description: "一柄断裂的古剑",
          imageUrl: "",
          folderId: null,
          projectId: "dao-project",
          createdAt: 1,
        },
        {
          id: "prop-ch1",
          name: "断剑",
          category: "雨夜湿剑",
          description: "雨夜状态",
          imageUrl: "",
          folderId: null,
          parentId: "prop-parent",
          isDerivative: true,
          projectId: "dao-project",
          createdAt: 2,
        },
      ],
      folders: [],
      selectedFolderId: "all",
    });
    const saveImage = vi.fn().mockResolvedValue({
      success: true,
      url: "project-file://dao-project/workflow-images/assets/chapter-001/prop/prop-ch1.png",
      size: 100,
    });
    (window as any).projectFiles = { saveImage };

    const derivative = await generateAsset({
      assetId: "prop-ch1",
      assetType: "prop",
      projectId: "dao-project",
      name: "断剑",
      description: "雨夜状态",
      isDerivative: true,
      chapterId: "chapter-001",
      visualManualId: "ink",
    });
    expect(derivative.phase).toBe("done");
    expect(saveImage).toHaveBeenCalledWith(expect.objectContaining({
      relativePath: expect.stringMatching(/^workflow-images\/assets\/chapter-001\/prop\/prop-ch1-/),
    }));

    saveImage.mockClear();
    const base = await generateAsset({
      assetId: "prop-parent",
      assetType: "prop",
      projectId: "dao-project",
      name: "断剑",
      description: "一柄断裂的古剑",
      isDerivative: false,
      chapterId: "chapter-001",
      visualManualId: "ink",
    });
    expect(base.phase).toBe("done");
    // 基类资产即使误传 chapterId 也必须留在共享目录(避免被章节删除误伤)
    expect(saveImage).toHaveBeenCalledWith(expect.objectContaining({
      relativePath: expect.stringMatching(/^workflow-images\/assets\/prop\/prop-parent-/),
    }));
  });

  it("keeps project asset generation failed when projectFiles.saveImage returns a failure", async () => {
    const saveImage = vi.fn().mockResolvedValue({
      success: false,
      error: "项目目录不可写",
    });
    (window as any).projectFiles = { saveImage };

    const result = await generateAsset(projectPropGenerationTask());

    expect(result).toMatchObject({
      phase: "failed",
      error: "项目目录不可写",
    });
    expect(saveImage).toHaveBeenCalledOnce();
    expect(saveImageToLocal).not.toHaveBeenCalled();
    expect(usePropsLibraryStore.getState().getPropById("prop-1")?.imageUrl).toBe("");
  });

  it("keeps project asset generation failed when projectFiles.saveImage rejects", async () => {
    const saveImage = vi.fn().mockRejectedValue(
      new Error("projectFiles.saveImage IPC rejected"),
    );
    (window as any).projectFiles = { saveImage };

    const result = await generateAsset(projectPropGenerationTask());

    expect(result).toMatchObject({
      phase: "failed",
      error: "projectFiles.saveImage IPC rejected",
    });
    expect(saveImage).toHaveBeenCalledOnce();
    expect(saveImageToLocal).not.toHaveBeenCalled();
    expect(usePropsLibraryStore.getState().getPropById("prop-1")?.imageUrl).toBe("");
  });

  it("keeps the project bridge unavailable error without falling back to local-image", async () => {
    const result = await generateAsset(projectPropGenerationTask());

    expect(result).toMatchObject({
      phase: "failed",
      error: "当前环境不支持项目内资产图片保存",
    });
    expect(saveImageToLocal).not.toHaveBeenCalled();
    expect(usePropsLibraryStore.getState().getPropById("prop-1")?.imageUrl).toBe("");
  });

  it("does not save derivative workflow assets to the global local-image library without projectId", async () => {
    const result = await generateAsset({
      assetId: "prop-1",
      assetType: "prop",
      name: "断剑",
      description: "一柄断裂的古剑",
      isDerivative: true,
      visualManualId: "ink",
    });

    expect(result).toMatchObject({
      phase: "failed",
      error: "衍生资产图片必须保存到当前项目",
    });
    expect(saveImageToLocal).not.toHaveBeenCalled();
    const prop = usePropsLibraryStore.getState().getPropById("prop-1");
    expect(prop?.imageUrl).toBe("");
  });

  it("reuses asset-library file URLs without rewriting them as local media paths", () => {
    const characterUrl = "file:///tmp/mystudio-assets/role/char.png";
    const sceneUrl = "file:///tmp/mystudio-assets/scene/mine.png";
    const propUrl = "file:///tmp/mystudio-assets/tool/sword.png";

    expect(applyMatchedAssets("character", [
      {
        id: "char-1",
        name: "独孤剑尘",
        assetDbData: { filePath: "role/char.png", thumbnailUrl: characterUrl },
      },
    ])).toBe(1);
    expect(applyMatchedAssets("scene", [
      {
        id: "scene-1",
        name: "矿场",
        assetDbData: { filePath: "scene/mine.png", thumbnailUrl: sceneUrl },
      },
    ])).toBe(1);
    expect(applyMatchedAssets("prop", [
      {
        id: "prop-1",
        name: "断剑",
        assetDbData: { filePath: "tool/sword.png", thumbnailUrl: propUrl },
      },
    ])).toBe(1);

    expect(useCharacterLibraryStore.getState().characters[0].thumbnailUrl).toBe(characterUrl);
    expect(useCharacterLibraryStore.getState().characters[0].views[0]?.imageUrl).toBe(characterUrl);
    expect(useSceneStore.getState().scenes[0].referenceImage).toBe(sceneUrl);
    expect(usePropsLibraryStore.getState().getPropById("prop-1")?.imageUrl).toBe(propUrl);
  });

  it("returns the polished prompt when image generation fails", async () => {
    vi.mocked(aiManager.image).mockRejectedValueOnce(new Error("Failed to fetch"));
    const progress: AssetGenerationProgress[] = [];

    const result = await generateAsset(
      {
        assetId: "prop-1",
        assetType: "prop",
        name: "断剑",
        description: "一柄断裂的古剑",
        isDerivative: false,
        visualManualId: "ink",
      },
      (item) => progress.push(item),
    );

    expect(result.phase).toBe("failed");
    expect(result.error).toBe("Failed to fetch");
    expect(result.polishResult?.prompt).toBe("polished prop prompt");
    expect(progress).toContainEqual(expect.objectContaining({
      phase: "generating",
      polishResult: expect.objectContaining({ prompt: "polished prop prompt" }),
    }));
  });

  it("uses the existing prompt directly when image generation skips polishing", async () => {
    const progress: AssetGenerationProgress[] = [];

    const result = await generateAsset(
      {
        assetId: "prop-1",
        assetType: "prop",
        name: "断剑",
        description: "一柄断裂的古剑",
        isDerivative: false,
        visualManualId: "ink",
        skipPolish: true,
        existingPrompt: "existing prop image prompt",
      },
      (item) => progress.push(item),
    );

    expect(result.phase).toBe("done");
    expect(polishAssetPrompt).not.toHaveBeenCalled();
    expect(aiManager.image).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "existing prop image prompt" }),
      "prop",
    );
    expect(progress.some((item) => item.phase === "polishing")).toBe(false);
  });

  it("uses global image size settings when an asset task omits size options", async () => {
    useAppSettingsStore.getState().setImageGenerationSettings({
      defaultAspectRatio: "3:2",
      defaultResolution: "2K",
    });

    await generateAsset({
      assetId: "prop-1",
      assetType: "prop",
      name: "断剑",
      description: "一柄断裂的古剑",
      isDerivative: false,
      visualManualId: "ink",
    });

    expect(aiManager.image).toHaveBeenCalledWith(
      expect.objectContaining({
        aspectRatio: "3:2",
        resolution: "2K",
      }),
      "prop",
    );
  });

  it("routes asset-library matching through the shared studio-assets bridge", () => {
    const source =
      readFileSync(join(process.cwd(), "frontend/lib/studio/asset-generation-orchestrator.ts"), "utf8") +
      readFileSync(join(process.cwd(), "frontend/lib/studio/asset-generation-store-writers.ts"), "utf8");

    expect(source).toContain(
      'import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";',
    );
    expect(source).toContain("getStudioAssetsBridge()?.batchMatch");
    expect(source).not.toContain("window.studioAssets");
  });

  describe("daojie ma-gongbi-v1 编译边界", () => {
    it("道劫润色结果经确定性编译后以 raw providerPrompt 直传", async () => {
      vi.mocked(polishAssetPrompt).mockResolvedValueOnce({
        status: "success",
        prompt: "人物题材正文:晏燎立于矿场入口,面容与剑修身份清晰。",
        negativePrompt: "水印",
      });

      const result = await generateAsset({
        assetId: "char-1",
        assetType: "character",
        name: "晏燎",
        description: "青衫剑修",
        isDerivative: false,
        visualManualId: "daojie_ink_guofeng",
      });

      expect(result.phase).toBe("done");
      const [params, kind] = vi.mocked(aiManager.image).mock.calls[0];
      expect(kind).toBe("character");
      expect(params.promptPolicy).toBe("raw");
      expect(params.negativePrompt).toBeUndefined();
      // 题材正文 + 自动层(底座/人物轨) + 唯一末尾 Avoid(作业负面+通用负面)
      expect(params.prompt).toContain("人物题材正文");
      expect(params.prompt).toContain("风格底座");
      expect(params.prompt).toContain("TRACK=person");
      expect(params.prompt.match(/Avoid:/g)).toHaveLength(1);
      expect(params.prompt).toContain("水印");
      expect(params.prompt).toContain("压缩伪影");
      expect(params.prompt).not.toContain("Negative constraints");
      expect(params.prompt).not.toContain("clean image");
      // 诊断日志:合同指纹+方案+长度可追溯,不含密钥
      const compileLog = vi.mocked(logEvent).mock.calls.find(
        ([entry]) => entry.message.includes("Daojie asset prompt compiled"),
      );
      expect(compileLog?.[0].context).toMatchObject({
        maTrack: "person",
        paletteSchemeId: null,
        contractVersion: "ma-gongbi-v1",
      });
      expect(String(compileLog?.[0].context?.contractSha256)).toMatch(/^[a-f0-9]{64}$/);
    });

    it("已有提示词复用仍进编译与长度门(skipPolish≠skipCompile),作业负面不丢", async () => {
      const result = await generateAsset({
        assetId: "prop-1",
        assetType: "prop",
        name: "断剑",
        description: "一柄断裂的古剑",
        isDerivative: false,
        visualManualId: "daojie_ink_guofeng",
        skipPolish: true,
        existingPrompt: "既有人物题材正文",
        negativePrompt: "签名",
      });

      expect(result.phase).toBe("done");
      expect(polishAssetPrompt).not.toHaveBeenCalled();
      const params = vi.mocked(aiManager.image).mock.calls[0][0];
      expect(params.promptPolicy).toBe("raw");
      expect(params.prompt).toContain("既有人物题材正文");
      expect(params.prompt).toContain("风格底座");
      expect(params.prompt).toContain("TRACK=prop");
      expect(params.prompt).toContain("签名");
    });

    it("超 800 字符在网络前 fail-closed,不触发 provider 请求", async () => {
      const result = await generateAsset({
        assetId: "prop-1",
        assetType: "prop",
        name: "断剑",
        description: "一柄断裂的古剑",
        isDerivative: false,
        visualManualId: "daojie_ink_guofeng",
        skipPolish: true,
        existingPrompt: "长".repeat(700),
      });

      expect(result.phase).toBe("failed");
      expect(result.error).toContain("800");
      expect(aiManager.image).not.toHaveBeenCalled();
      const rejectLog = vi.mocked(logEvent).mock.calls.find(
        ([entry]) => entry.message.includes("rejected before provider"),
      );
      expect(rejectLog?.[0].level).toBe("warn");
      expect(rejectLog?.[0].context?.totalChars).toBeGreaterThan(800);
    });

    it("参考图条件锁:有参考图追加降噪锁,无参考图不追加", async () => {
      await generateAsset({
        assetId: "prop-1",
        assetType: "prop",
        name: "断剑",
        description: "一柄断裂的古剑",
        isDerivative: false,
        visualManualId: "daojie_ink_guofeng",
        skipPolish: true,
        existingPrompt: "道具题材正文",
      });
      await generateAsset({
        assetId: "prop-1",
        assetType: "prop",
        name: "断剑",
        description: "一柄断裂的古剑",
        isDerivative: false,
        visualManualId: "daojie_ink_guofeng",
        skipPolish: true,
        existingPrompt: "道具题材正文",
        referenceImages: ["data:image/png;base64,aGVsbG8="],
      });

      const [withoutRef, withRef] = vi.mocked(aiManager.image).mock.calls;
      expect(withoutRef[0].prompt).not.toContain("参考图降噪");
      expect(withRef[0].prompt).toContain("参考图降噪");
    });

    it("AI 选配方案随编译进入 provider 正文(具体矿物色可见)", async () => {
      vi.mocked(polishAssetPrompt).mockResolvedValueOnce({
        status: "success",
        prompt: "焚香符修题材正文。",
        negativePrompt: "水印",
        daojie: { subjectBody: "焚香符修题材正文。", schemeId: "person.02" },
      });

      const result = await generateAsset({
        assetId: "char-1",
        assetType: "character",
        name: "焚香符修",
        description: "主持仪式",
        isDerivative: false,
        visualManualId: "daojie_ink_guofeng",
      });

      expect(result.phase).toBe("done");
      const params = vi.mocked(aiManager.image).mock.calls[0][0];
      expect(params.prompt).toContain("配料方案（朱砂法脉）");
      expect(params.prompt).toContain("主色用朱砂");
    });

    it("已有提示词直出链同口径清洗:违禁词改写为工笔等效表达", async () => {
      const result = await generateAsset({
        assetId: "prop-1",
        assetType: "prop",
        name: "归元断剑",
        description: "断裂的归元剑",
        isDerivative: false,
        visualManualId: "daojie_ink_guofeng",
        skipPolish: true,
        existingPrompt: "断剑一柄，宣纸质感底，电影质感成片，剑身斜断。",
      });

      expect(result.phase).toBe("done");
      const params = vi.mocked(aiManager.image).mock.calls[0][0];
      expect(params.prompt).not.toContain("宣纸质感");
      expect(params.prompt).not.toContain("电影质感");
      expect(params.prompt).toContain("浅净平涂底");
      expect(params.prompt).toContain("工笔成片质感");
    });

    it("题材正文带风险措辞时 warn 软检查日志,不阻断生成", async () => {
      const result = await generateAsset({
        assetId: "prop-1",
        assetType: "prop",
        name: "断剑",
        description: "一柄断裂的古剑",
        isDerivative: false,
        visualManualId: "daojie_ink_guofeng",
        skipPolish: true,
        existingPrompt: "断剑一柄,剑身裂痕斜贯,刻满上古文字;工艺边缘清晰。",
      });
      expect(result.phase).toBe("done");
      const riskLog = [...vi.mocked(logEvent).mock.calls].reverse()
        .find(([e]) => e.message.includes("risk phrases"));
      expect(riskLog?.[0].level).toBe("warn");
      expect(riskLog?.[0].context?.risks).toEqual(expect.arrayContaining(["clothing-damage-invite", "text-render-invite"]));
    });

    it("skipPolish 再生成补一次 AI 选配,与首次生成配色行为一致", async () => {
      vi.mocked(selectDaojiePaletteSchemeForAsset).mockResolvedValueOnce("prop.05");

      const result = await generateAsset({
        assetId: "prop-1",
        assetType: "prop",
        name: "碧玉药鼎",
        description: "盛放灵药的玉鼎",
        isDerivative: false,
        visualManualId: "daojie_ink_guofeng",
        skipPolish: true,
        existingPrompt: "碧玉药鼎,玉石材质,鼎身刻云纹,单体居中。",
      });

      expect(result.phase).toBe("done");
      // 选配收到已有题材正文(色彩信号可见)
      const pickCall = vi.mocked(selectDaojiePaletteSchemeForAsset).mock.calls[0];
      expect(pickCall?.[0].subjectBody).toContain("碧玉药鼎");
      const params = vi.mocked(aiManager.image).mock.calls[0][0];
      expect(params.prompt).toContain("配料方案（碧玉灵材）");
      expect(params.prompt).toContain("主色用碧玉");
    });

    it("显式 task.paletteSchemeId 覆盖润色期选配,跨轨方案网络前 fail-closed", async () => {
      vi.mocked(polishAssetPrompt).mockResolvedValueOnce({
        status: "success",
        prompt: "矿场题材正文。",
        negativePrompt: "",
        daojie: { subjectBody: "矿场题材正文。", schemeId: "scene.01" },
      });
      const overridden = await generateAsset({
        assetId: "scene-1",
        assetType: "scene",
        name: "矿场入口",
        description: "夜雨矿场",
        isDerivative: false,
        visualManualId: "daojie_ink_guofeng",
        paletteSchemeId: "prop.01",
      });
      expect(overridden.phase).toBe("failed");
      expect(overridden.error).toContain("配色方案不可用");
      expect(aiManager.image).not.toHaveBeenCalled();
    });

    it("非道劫手册不进编译链,保持 enhanced 直传", async () => {
      await generateAsset({
        assetId: "prop-1",
        assetType: "prop",
        name: "断剑",
        description: "一柄断裂的古剑",
        isDerivative: false,
        visualManualId: "ink",
        skipPolish: true,
        existingPrompt: "existing prop image prompt",
      });

      const params = vi.mocked(aiManager.image).mock.calls[0][0];
      expect(params.prompt).toBe("existing prop image prompt");
      expect(params.promptPolicy).toBeUndefined();
      expect(params.prompt).not.toContain("风格底座");
    });
  });
});

function projectPropGenerationTask(): AssetGenerationTask {
  return {
    assetId: "prop-1",
    assetType: "prop",
    projectId: "dao-project",
    name: "断剑",
    description: "一柄断裂的古剑",
    isDerivative: true,
    visualManualId: "ink",
  };
}
