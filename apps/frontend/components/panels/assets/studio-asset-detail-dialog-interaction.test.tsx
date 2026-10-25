// @vitest-environment jsdom
/**
 * 10-24 布局重造批1 · 复审 M2 补件:对话框级保全项(#12-17)render+click 交互测试
 * + 元信息折叠开关与 localStorage 态记忆交互测试(原仅源码字符串断言,复审要求补齐)。
 * 桥/生成编排/润色走 vi.mock 控制桩,弹窗与表单全真实渲染。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioAssetDetailDialog } from "./StudioAssetDetailDialog";
import { toRoleSpeakerId } from "@/lib/tts/role-speaker-id";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useProjectStore } from "@/stores/project/project-store";
import { useTtsStore } from "@/stores/tts/tts-store";
import type { StudioAssetSummary } from "@/types/studio-assets";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  delete: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  generateAsset: vi.fn(),
  polishAssetPrompt: vi.fn(),
  typeShot: vi.fn(),
  expressionSheet: vi.fn(),
  saveImageToLibrary: vi.fn(),
}));

vi.mock("@/lib/bridge/studio-assets", () => ({
  getStudioAssetsBridge: () => ({
    update: mocks.update,
    delete: mocks.delete,
    get: mocks.get,
    list: mocks.list,
  }),
}));

vi.mock("@/lib/studio/asset-generation-orchestrator", () => ({
  generateAsset: mocks.generateAsset,
}));

// 批3(10-24):按型出图 service 打桩(generateAssetTypeShot 桩;型档案/队列计划保真源),
// 表情差分 service 与持久化落库同步打桩——一键补缺队列交互测试可控驱动。
// 10-25 分层面板役:表情差分桩改 importOriginal 透传(弹窗直读九宫格指令常量
// EXPRESSION_I2I_INSTRUCTION 入指令卡,全量 factory 桩会缺该导出)。
vi.mock("@/lib/studio/asset-type-shot", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/studio/asset-type-shot")>();
  return { ...original, generateAssetTypeShot: mocks.typeShot };
});

vi.mock("@/lib/studio/asset-expression-sheet", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/studio/asset-expression-sheet")>();
  return { ...original, generateAssetExpressionSheet: mocks.expressionSheet };
});

vi.mock("./studio-asset-generation-persistence", () => ({
  persistGeneratedAssetPromptToLibrary: vi.fn().mockResolvedValue(true),
  saveGeneratedAssetImageToLibrary: mocks.saveImageToLibrary,
}));

// 批2(10-24):大图预览 MediaPreviewModal 打桩——本文件只断言「预览序列=当前节
// 图集」的装配契约(节内 url 序+节内局部序),缩放/翻页交互属 Modal 自件不重测。
vi.mock("@/components/ui/media-preview-modal", () => ({
  ImagePreviewModal: (props: { imageUrls: string[]; initialIndex: number }) => (
    <div
      data-testid="asset-preview-modal"
      data-urls={(props.imageUrls ?? []).join(",")}
      data-initial-index={String(props.initialIndex ?? 0)}
    />
  ),
}));

vi.mock("@/lib/ai/prompt-polisher", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/ai/prompt-polisher")>();
  return { ...original, polishAssetPrompt: mocks.polishAssetPrompt };
});

function roleAsset(overrides: Partial<StudioAssetSummary> = {}): StudioAssetSummary {
  return {
    id: "role-1",
    source: "manying-local",
    type: "role",
    name: "玄止",
    description: "北境剑修",
    ...overrides,
  };
}

function renderDialog(asset: StudioAssetSummary = roleAsset(), onOpenChange = vi.fn()) {
  const view = render(
    <StudioAssetDetailDialog asset={asset} open onOpenChange={onOpenChange} />,
  );
  return { ...view, onOpenChange };
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.update.mockReset().mockResolvedValue({ id: "role-1" });
  mocks.delete.mockReset().mockResolvedValue(true);
  mocks.get.mockReset().mockResolvedValue(null);
  mocks.list.mockReset().mockResolvedValue({ items: [] });
  mocks.generateAsset.mockReset().mockResolvedValue({ phase: "failed", error: "stub-fail" });
  mocks.polishAssetPrompt.mockReset().mockResolvedValue({ status: "success", prompt: "润色后的提示词" });
  mocks.typeShot.mockReset().mockResolvedValue({ phase: "failed", error: "stub-fail" });
  mocks.expressionSheet.mockReset().mockResolvedValue({ phase: "failed", error: "stub-fail" });
  mocks.saveImageToLibrary.mockReset().mockResolvedValue(true);
  useStudioStore.setState({
    workflowConfig: { ...useStudioStore.getState().workflowConfig, visualManualId: undefined },
  });
  useTtsStore.setState({ activeProjectId: null, projects: {}, voiceProfiles: {} });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("StudioAssetDetailDialog 交互(10-24 批1 复审 M2:对话框级保全项 render+click)", () => {
  it("#14 保存:编辑名字后点保存,草稿四字段经桥 update 落库", async () => {
    const { onOpenChange } = renderDialog();

    const nameInput = screen.getByPlaceholderText("主名字;副名字1;副名字2");
    fireEvent.change(nameInput, { target: { value: "玄止;玄公子" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    // Phase C(10-25 追加令):保存随带按型主体句槽(已水合=空表照写清槽;
    // 补检1 修复:未水合窗口该键缺席防清库——两形皆合法,放宽为部分匹配)
    expect(mocks.update).toHaveBeenCalledWith({
      id: "role-1",
      updates: expect.objectContaining({ name: "玄止;玄公子", description: "北境剑修", prompt: "", setting: "" }),
    });
    // 保存不关弹窗(继续编辑语义)
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("#15 删除资产:确认后经桥 delete 关弹窗", async () => {
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmSpy);
    const { onOpenChange } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() => expect(mocks.delete).toHaveBeenCalledWith("role-1"));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    vi.unstubAllGlobals();
  });

  it("#15 删除资产:取消确认零副作用", () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    const { onOpenChange } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    expect(mocks.delete).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("#12 一键生成:无视觉手册禁用,有则点击派发 generateAsset(character 轨)", async () => {
    renderDialog();
    const button = screen.getByRole("button", { name: /一键生成资产生图/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    cleanup();

    useStudioStore.setState({
      workflowConfig: { ...useStudioStore.getState().workflowConfig, visualManualId: "vm-test" },
    });
    renderDialog();
    const enabled = screen.getByRole("button", { name: /一键生成资产生图/ }) as HTMLButtonElement;
    expect(enabled.disabled).toBe(false);
    fireEvent.click(enabled);

    await waitFor(() => expect(mocks.generateAsset).toHaveBeenCalledTimes(1));
    expect(mocks.generateAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "role-1",
        assetType: "character",
        name: "玄止",
        skipPolish: false,
        existingPrompt: undefined,
      }),
      expect.any(Function),
    );
  });

  it("#13 润色提示词:点击走 polishAssetPrompt,回填出图提示词", async () => {
    useStudioStore.setState({
      workflowConfig: { ...useStudioStore.getState().workflowConfig, visualManualId: "vm-test" },
    });
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "润色提示词" }));

    await waitFor(() => expect(mocks.polishAssetPrompt).toHaveBeenCalledTimes(1));
    expect(mocks.polishAssetPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ assetType: "character", name: "玄止", visualManualId: "vm-test" }),
    );
    await waitFor(() => expect(screen.getByDisplayValue("润色后的提示词")).toBeTruthy());
  });

  it("#16 更换音色:未分配卡点击打开选音频弹窗(搜索框可见)", async () => {
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: /尚未分配音色/ }));

    expect(await screen.findByPlaceholderText("搜索音频名称或文件名")).toBeTruthy();
  });

  it("#16/#17 已绑定态:更换音色入口与试听按钮同卡可达,试听点击不炸", () => {
    const speakerId = toRoleSpeakerId("role-1");
    // 绑定须落在 RoleVoiceAssignDialog 挂载效应会切到的 tts 活动项目上
    // (其 setActiveProjectId=scopeTtsStateToProject 会整表重指到 project-store 的 activeProjectId)
    const ttsProjectId = useProjectStore.getState().activeProjectId ?? "default-project";
    useTtsStore.setState({
      activeProjectId: ttsProjectId,
      projects: {
        [ttsProjectId]: {
          voiceLines: {},
          bindings: {
            [speakerId]: { speakerId, profileId: "prof-1", defaultEngine: "qwen", defaultModelSize: "medium" },
          },
        },
      },
      voiceProfiles: {
        "prof-1": {
          id: "prof-1",
          name: "少年音",
          type: "preset",
          language: "zh",
          defaultEngine: "qwen",
          presetVoiceId: "voice-1",
          createdAt: 1,
          updatedAt: 1,
        },
      },
    });
    renderDialog();

    expect(screen.getByText("更换音色")).toBeTruthy();
    const previewButton = screen.getByRole("button", { name: "试听音色" }) as HTMLButtonElement;
    expect(previewButton.disabled).toBe(false);
    fireEvent.click(previewButton);
    expect(screen.getByRole("button", { name: "试听音色" })).toBeTruthy();
  });

  it("元信息折叠开关:点选隐藏四行网格留摘要+保存/删除,localStorage 记忆跨渲染", async () => {
    renderDialog();

    // 缺省展开:四行网格字段可见(10-25 分层面板:「出图提示词」区改造为「提示词」
    // 区,标签随迁为「提示词」+「主体句」)
    expect(screen.getByPlaceholderText("主名字;副名字1;副名字2")).toBeTruthy();
    expect(screen.getByText("主体句")).toBeTruthy();
    expect(window.localStorage.getItem("asset-dialog-meta-collapsed")).toBe("0");

    fireEvent.click(screen.getByRole("button", { name: /元信息/ }));

    // 折叠:字段隐、摘要(资产名,与标题同名并存)+保存/删除仍在
    expect(screen.queryByPlaceholderText("主名字;副名字1;副名字2")).toBeNull();
    expect(screen.queryByText("主体句")).toBeNull();
    expect(screen.getAllByText("玄止").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "保存" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "删除" })).toBeTruthy();
    expect(window.localStorage.getItem("asset-dialog-meta-collapsed")).toBe("1");

    // 态记忆:重开(重新渲染)仍折叠,不需再点
    cleanup();
    renderDialog();
    expect(screen.queryByPlaceholderText("主名字;副名字1;副名字2")).toBeNull();
    expect(screen.getByRole("button", { name: /元信息/ }).getAttribute("aria-expanded")).toBe("false");

    // 再点展开还原,localStorage 回 "0"
    fireEvent.click(screen.getByRole("button", { name: /元信息/ }));
    expect(screen.getByPlaceholderText("主名字;副名字1;副名字2")).toBeTruthy();
    expect(window.localStorage.getItem("asset-dialog-meta-collapsed")).toBe("0");
  });
});

describe("StudioAssetDetailDialog · 批2(10-24):放大钮预览序列=当前节图集(节内上下张)", () => {
  /** 同节三图(人物多视图=_三视图_+_正视图_,10-25 裁定正视图并入)+无标记图(早期未分类)。 */
  function typedRoleAsset(): StudioAssetSummary {
    return roleAsset({
      images: [
        { name: "晏燎_练气期_三视图_v1", filePath: "role/a1.png", url: "media://a1" },
        { name: "晏燎_筑基期_三视图_v2", filePath: "role/a2.png", url: "media://a2" },
        { name: "晏燎_练气期_正视图_v1", filePath: "role/a3.png", url: "media://a3" },
        { name: "主图", filePath: "role/a5.png", url: "media://a5" },
      ],
    });
  }

  it("点节内首张(多视图 v1):序列=该节图集,initial=节内局部序 0", () => {
    renderDialog(typedRoleAsset());

    fireEvent.click(screen.getByRole("button", { name: "全屏预览 晏燎_练气期_三视图_v1" }));

    const modal = screen.getByTestId("asset-preview-modal");
    expect(modal.getAttribute("data-urls")).toBe("media://a1,media://a2,media://a3");
    expect(modal.getAttribute("data-initial-index")).toBe("0");
  });

  it("点节内次张(多视图 v2,全局位 1):initial=节内局部序 1(根除全局下标错位)", () => {
    renderDialog(typedRoleAsset());

    fireEvent.click(screen.getByRole("button", { name: "全屏预览 晏燎_筑基期_三视图_v2" }));

    const modal = screen.getByTestId("asset-preview-modal");
    expect(modal.getAttribute("data-urls")).toBe("media://a1,media://a2,media://a3");
    expect(modal.getAttribute("data-initial-index")).toBe("1");
  });

  it("点节内三张(正视图,10-25 并入多视图):initial=节内局部序 2", () => {
    renderDialog(typedRoleAsset());

    fireEvent.click(screen.getByRole("button", { name: "全屏预览 晏燎_练气期_正视图_v1" }));

    const modal = screen.getByTestId("asset-preview-modal");
    expect(modal.getAttribute("data-urls")).toBe("media://a1,media://a2,media://a3");
    expect(modal.getAttribute("data-initial-index")).toBe("2");
  });

  it("点早期未分类节图:序列=仅该节图集", () => {
    renderDialog(typedRoleAsset());

    fireEvent.click(screen.getByRole("button", { name: "全屏预览 主图" }));

    const modal = screen.getByTestId("asset-preview-modal");
    expect(modal.getAttribute("data-urls")).toBe("media://a5");
    expect(modal.getAttribute("data-initial-index")).toBe("0");
  });

  it("scene 单节(非角色轨):预览序列=全展示序,行为不变", () => {
    renderDialog(roleAsset({
      type: "scene",
      images: [
        { name: "山门远景", filePath: "scene/s1.png", url: "media://s1" },
        { name: "山门近景", filePath: "scene/s2.png", url: "media://s2" },
      ],
    }));

    fireEvent.click(screen.getByRole("button", { name: "全屏预览 山门近景" }));

    const modal = screen.getByTestId("asset-preview-modal");
    expect(modal.getAttribute("data-urls")).toBe("media://s1,media://s2");
    expect(modal.getAttribute("data-initial-index")).toBe("1");
  });
});

describe("StudioAssetDetailDialog · 批3(10-24):一键补缺顺序队列交互", () => {
  /** 多视图✓ 人脸✓ 在场 → 队列计划=[全身定妆, 人物海报, 表情差分](核心节序)。 */
  function partiallyCompleteRole(): StudioAssetSummary {
    return roleAsset({
      images: [
        { name: "晏燎_练气期_三视图_v1", filePath: "role/a1.png", url: "media://a1" },
        { name: "晏燎_练气期_人脸_2026年10月21日", filePath: "role/a4.png", url: "media://a4" },
      ],
    });
  }

  it("一键补缺:缺失核心型按节序顺序派发(型驱动路+表情差分既有路),逐型完成落库", async () => {
    mocks.typeShot.mockImplementation(async (task: { kind: string }) => ({
      phase: "done",
      imageLocalPath: `local-image://characters/${task.kind}.png`,
    }));
    mocks.expressionSheet.mockResolvedValue({ phase: "done", imageLocalPath: "local-image://characters/expression.png" });

    renderDialog(partiallyCompleteRole());
    fireEvent.click(screen.getByRole("button", { name: "一键补缺" }));

    await waitFor(() => {
      expect(mocks.typeShot).toHaveBeenCalledTimes(2);
      expect(mocks.expressionSheet).toHaveBeenCalledTimes(1);
    });
    // 派发型名=队列计划(route 分流:全身定妆/人物海报走型驱动件)
    expect(mocks.typeShot.mock.calls.map(([task]) => task.kind)).toEqual(["全身定妆", "人物海报"]);
    // 顺序队列:全身定妆 → 人物海报 → 表情差分(invocationCallOrder 钉序)
    const [firstShot, secondShot] = mocks.typeShot.mock.invocationCallOrder;
    const [expressionCall] = mocks.expressionSheet.mock.invocationCallOrder;
    expect(firstShot).toBeLessThan(secondShot);
    expect(secondShot).toBeLessThan(expressionCall);
    // 逐型完成落库(写回资产库主图位)
    expect(mocks.saveImageToLibrary).toHaveBeenCalledTimes(3);
  });

  it("队列失败即停:首型失败后后续型零派发(Phase1 队列策略,候 Round 3 裁定)", async () => {
    mocks.typeShot.mockResolvedValue({ phase: "failed", error: "引擎不在驾" });

    renderDialog(partiallyCompleteRole());
    fireEvent.click(screen.getByRole("button", { name: "一键补缺" }));

    await waitFor(() => expect(mocks.typeShot).toHaveBeenCalledTimes(1));
    // 失败即停:第二型/表情差分路零派发
    expect(mocks.typeShot).toHaveBeenCalledTimes(1);
    expect(mocks.expressionSheet).not.toHaveBeenCalled();
    expect(mocks.saveImageToLibrary).not.toHaveBeenCalled();
  });

  it("节头生成钮直达:点「生成全身定妆」派发型驱动路(型名单一参数)", async () => {
    mocks.typeShot.mockResolvedValue({ phase: "done", imageLocalPath: "local-image://characters/fullbody.png" });

    renderDialog(roleAsset({
      images: [{ name: "主图", filePath: "role/main.png", url: "media://main" }],
    }));
    fireEvent.click(screen.getByRole("button", { name: "生成全身定妆" }));

    await waitFor(() => expect(mocks.typeShot).toHaveBeenCalledTimes(1));
    expect(mocks.typeShot.mock.calls[0][0]).toMatchObject({
      assetId: "role-1",
      assetName: "玄止",
      kind: "全身定妆",
      referenceImage: "media://main",
    });
  });
});
