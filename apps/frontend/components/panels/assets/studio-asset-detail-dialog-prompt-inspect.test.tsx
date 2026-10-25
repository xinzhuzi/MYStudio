// @vitest-environment jsdom
/**
 * 10-25-asset-prompt-layered-panel 收官接线交互测试(A-2③ 实发终稿/B-3 查词/A-3 润色还原):
 * 桥/生成编排/润色/按型出图 service 走 vi.mock 控制桩(沿 studio-asset-detail-dialog-
 * interaction.test.tsx 范式),弹窗与提示词区全真实渲染。
 * - ③:探针状态机(idle/no-products/unreadable/ready)+末位回溯+族兄弟产物弹层标注;
 * - B-3:图片卡 hover 工具条「查词」→共用弹层降级矩阵;
 * - A-3:一键生成润色覆写前快照→「还原上次润色前」回滚 draftPrompt(手编后再还原
 *   仍回快照=「撤销上次润色」语义,PRD §4.1 A-3 边界)。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioAssetDetailDialog } from "./StudioAssetDetailDialog";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useTtsStore } from "@/stores/tts/tts-store";
import type { FamilyImageEntry } from "@/lib/studio/asset-family-images";
import type { StudioAssetSummary } from "@/types/studio-assets";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  delete: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  readImagePromptText: vi.fn(),
  /** 桥缺席推演:true=getStudioAssetsBridge 不带 readImagePromptText(旧 preload/非桌面)。 */
  bridgeMissing: false,
  generateAsset: vi.fn(),
  polishAssetPrompt: vi.fn(),
  typeShot: vi.fn(),
  expressionSheet: vi.fn(),
  saveImageToLibrary: vi.fn(),
}));

vi.mock("@/lib/bridge/studio-assets", () => ({
  getStudioAssetsBridge: () => {
    const bridge: Record<string, unknown> = {
      update: mocks.update,
      delete: mocks.delete,
      get: mocks.get,
      list: mocks.list,
    };
    if (!mocks.bridgeMissing) bridge.readImagePromptText = mocks.readImagePromptText;
    return bridge;
  },
}));

vi.mock("@/lib/studio/asset-generation-orchestrator", () => ({
  generateAsset: mocks.generateAsset,
}));

// 按型出图/表情差分 service 打桩(型档案/指令常量保真源透传,弹窗直读指令卡数据)。
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

vi.mock("@/components/ui/media-preview-modal", () => ({
  ImagePreviewModal: () => <div data-testid="asset-preview-modal" />,
}));

vi.mock("@/lib/ai/prompt-polisher", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/ai/prompt-polisher")>();
  return { ...original, polishAssetPrompt: mocks.polishAssetPrompt };
});

/** 最小 i2i 工作流(B-2 实盘键形,与弹层组件测试同源;终稿串带可辨标记)。 */
const I2I_WORKFLOW_JSON = JSON.stringify({
  "10": { class_type: "LoadImage", inputs: { image: "ref.png" } },
  "400": { class_type: "PrimitiveStringMultiline", inputs: { value: "终稿指令全文(引擎实收)" } },
  "6:4011": { class_type: "MyQi21PromptAssembly", inputs: { 锁层A全文: "美术风格底座注入层全文", 主体句负面: "" } },
  "7:7014": { class_type: "PrimitiveInt", inputs: { value: 1317923666 } },
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

function renderDialog(
  asset: StudioAssetSummary = roleAsset(),
  onOpenChange = vi.fn(),
  familyImages?: FamilyImageEntry[],
) {
  return render(
    <StudioAssetDetailDialog
      asset={asset}
      open
      onOpenChange={onOpenChange}
      familyImages={familyImages}
    />,
  );
}

function finalDraftButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "查看实发终稿" }) as HTMLButtonElement;
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.bridgeMissing = false;
  mocks.update.mockReset().mockResolvedValue({ id: "role-1" });
  mocks.delete.mockReset().mockResolvedValue(true);
  mocks.get.mockReset().mockResolvedValue(null);
  mocks.list.mockReset().mockResolvedValue({ items: [] });
  mocks.readImagePromptText.mockReset().mockResolvedValue({ ok: false, reason: "no-texr" });
  mocks.generateAsset.mockReset().mockResolvedValue({ phase: "failed", error: "stub-fail" });
  mocks.polishAssetPrompt.mockReset().mockResolvedValue({ status: "success", prompt: "润色后的提示词" });
  mocks.typeShot.mockReset().mockResolvedValue({ phase: "failed", error: "stub-fail" });
  mocks.expressionSheet.mockReset().mockResolvedValue({ phase: "failed", error: "stub-fail" });
  mocks.saveImageToLibrary.mockReset().mockResolvedValue(true);
  useStudioStore.setState({
    workflowConfig: { ...useStudioStore.getState().workflowConfig, visualManualId: "vm-test" },
  });
  useTtsStore.setState({ activeProjectId: null, projects: {}, voiceProfiles: {} });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("③ 查看实发终稿(A-2③):探针状态机+末位回溯+弹层", () => {
  it("通用态(无 focusKind)置灰,注明「点击任一生成按钮聚焦某型后可查」", () => {
    renderDialog(roleAsset({
      images: [{ name: "晏燎_全身定妆_v1", filePath: "role/f1.png", url: "media://f1" }],
    }));

    expect(finalDraftButton().disabled).toBe(true);
    expect(screen.getByText("点击任一生成按钮聚焦某型后可查")).toBeTruthy();
  });

  it("聚焦型有产物且 tEXt ok:按钮解禁,弹层展示正向终稿+注入层全文+脚注", async () => {
    mocks.readImagePromptText.mockResolvedValue({ ok: true, text: I2I_WORKFLOW_JSON });
    renderDialog(roleAsset({
      images: [{ name: "晏燎_全身定妆_v1", filePath: "role/f1.png", url: "media://f1" }],
    }));

    // 节头生成钮点击即聚焦(与生成派发同帧;typeShot 桩失败不影响聚焦态)
    fireEvent.click(screen.getByRole("button", { name: "生成全身定妆" }));

    await waitFor(() => expect(finalDraftButton().disabled).toBe(false));
    fireEvent.click(finalDraftButton());

    expect(await screen.findByText("全身定妆 · 实发终稿")).toBeTruthy();
    expect(screen.getByText("终稿指令全文(引擎实收)")).toBeTruthy();
    expect(screen.getByText("锁层A全文")).toBeTruthy();
    expect(screen.getByText("美术风格底座注入层全文")).toBeTruthy();
    // 底部小字(PRD 钉的固定句)
    expect(screen.getAllByText("来自该型最近产物的引擎实收,非本次预演").length).toBeGreaterThanOrEqual(1);
  });

  it("组内末位无 tEXt→向前回溯同型上一张(数组序倒排,首个 ok 命中)", async () => {
    mocks.readImagePromptText.mockImplementation(async ({ filePath }: { filePath: string }) =>
      filePath === "role/f2.png"
        ? { ok: false, reason: "no-texr" }
        : { ok: true, text: I2I_WORKFLOW_JSON },
    );
    renderDialog(roleAsset({
      images: [
        { name: "晏燎_全身定妆_v1", filePath: "role/f1.png", url: "media://f1" },
        { name: "晏燎_全身定妆_v2", filePath: "role/f2.png", url: "media://f2" },
      ],
    }));

    fireEvent.click(screen.getByRole("button", { name: "生成全身定妆" }));

    await waitFor(() => expect(finalDraftButton().disabled).toBe(false));
    // 回溯链:末位 v2 无 tEXt→v1 ok(两条候选都读过)
    await waitFor(() => expect(mocks.readImagePromptText).toHaveBeenCalledTimes(2));
    expect(mocks.readImagePromptText).toHaveBeenNthCalledWith(1, { filePath: "role/f2.png" });
    expect(mocks.readImagePromptText).toHaveBeenNthCalledWith(2, { filePath: "role/f1.png" });
    fireEvent.click(finalDraftButton());
    expect(await screen.findByText("终稿指令全文(引擎实收)")).toBeTruthy();
  });

  it("聚焦型组空(该型尚无产物)→置灰注明", async () => {
    renderDialog(roleAsset({
      images: [{ name: "随手草图", filePath: "role/x.png", url: "media://x" }],
    }));

    fireEvent.click(screen.getByRole("button", { name: "生成全身定妆" }));

    await waitFor(() => expect(finalDraftButton().disabled).toBe(true));
    expect(screen.getByText("该型尚无产物")).toBeTruthy();
  });

  it("组内全无 tEXt→置灰注明「未携带提示词元数据」", async () => {
    mocks.readImagePromptText.mockResolvedValue({ ok: false, reason: "no-texr" });
    renderDialog(roleAsset({
      images: [
        { name: "晏燎_全身定妆_v1", filePath: "role/f1.png", url: "media://f1" },
        { name: "晏燎_全身定妆_v2", filePath: "role/f2.png", url: "media://f2" },
      ],
    }));

    fireEvent.click(screen.getByRole("button", { name: "生成全身定妆" }));

    await waitFor(() => expect(mocks.readImagePromptText).toHaveBeenCalledTimes(2));
    expect(finalDraftButton().disabled).toBe(true);
    expect(screen.getByText("该型最近产物未携带提示词元数据")).toBeTruthy();
  });

  it("桥缺席(旧 preload/非桌面)→置灰注明「当前环境不支持读取」", async () => {
    mocks.bridgeMissing = true;
    renderDialog(roleAsset({
      images: [{ name: "晏燎_全身定妆_v1", filePath: "role/f1.png", url: "media://f1" }],
    }));

    fireEvent.click(screen.getByRole("button", { name: "生成全身定妆" }));

    await waitFor(() => expect(finalDraftButton().disabled).toBe(true));
    expect(screen.getByText("当前环境不支持读取提示词元数据")).toBeTruthy();
    expect(mocks.readImagePromptText).not.toHaveBeenCalled();
  });

  it("族兄弟产物计入:弹层标注「来自同族资产 {名}」(族聚显口径)", async () => {
    mocks.readImagePromptText.mockResolvedValue({ ok: true, text: I2I_WORKFLOW_JSON });
    const sibling: FamilyImageEntry = {
      name: "二哥_全身定妆_v1",
      filePath: "role/s1.png",
      url: "media://s1",
      assetId: "role-2",
      assetName: "晏燎二哥",
    };
    renderDialog(roleAsset(), undefined, [sibling]);

    fireEvent.click(screen.getByRole("button", { name: "生成全身定妆" }));

    await waitFor(() => expect(finalDraftButton().disabled).toBe(false));
    fireEvent.click(finalDraftButton());

    expect(await screen.findByText("来自同族资产 晏燎二哥")).toBeTruthy();
    expect(screen.getByText("终稿指令全文(引擎实收)")).toBeTruthy();
  });
});

describe("B-3 查词(图片卡 hover 工具条→共用弹层)", () => {
  it("点「查词」读该图原图 tEXt;无 tEXt→降级文案「该图无提示词元数据」", async () => {
    mocks.readImagePromptText.mockResolvedValue({ ok: false, reason: "no-texr" });
    renderDialog(roleAsset({
      images: [{ name: "晏燎_全身定妆_v1", filePath: "role/f1.png", url: "media://f1" }],
    }));

    fireEvent.click(screen.getByRole("button", { name: "查词 晏燎_全身定妆_v1" }));

    expect(await screen.findByText("查词 · 晏燎_全身定妆_v1")).toBeTruthy();
    expect(await screen.findByText("该图无提示词元数据")).toBeTruthy();
    // 查词不带 ③ 脚注
    expect(screen.queryByText("来自该型最近产物的引擎实收,非本次预演")).toBeNull();
  });

  it("族兄弟图查词:标注所属资产名", async () => {
    mocks.readImagePromptText.mockResolvedValue({ ok: true, text: I2I_WORKFLOW_JSON });
    const sibling: FamilyImageEntry = {
      name: "二哥_全身定妆_v1",
      filePath: "role/s1.png",
      url: "media://s1",
      assetId: "role-2",
      assetName: "晏燎二哥",
    };
    renderDialog(roleAsset(), undefined, [sibling]);

    fireEvent.click(screen.getByRole("button", { name: "查词 二哥_全身定妆_v1" }));

    expect(await screen.findByText("来自同族资产 晏燎二哥")).toBeTruthy();
    expect(screen.getByText("终稿指令全文(引擎实收)")).toBeTruthy();
  });

  it("JPEG 产物查词→降级文案「仅引擎 PNG 产物携带提示词元数据」", async () => {
    mocks.readImagePromptText.mockResolvedValue({ ok: false, reason: "not-png" });
    renderDialog(roleAsset({
      images: [{ name: "外部导入图", filePath: "role/imp.jpg", url: "media://imp" }],
    }));

    fireEvent.click(screen.getByRole("button", { name: "查词 外部导入图" }));

    expect(await screen.findByText("仅引擎 PNG 产物携带提示词元数据")).toBeTruthy();
  });
});

describe("A-3 润色还原(一键生成 applyPolishedPrompt 快照)", () => {
  it("未润色→钮禁用;润色覆写→解禁;点击回滚 draftPrompt 到润色前值并复禁", async () => {
    // 首查(挂载)=润色前库值;生成完成复查=已润色库值(镜像 persist 落库后的真实序)
    let getCalls = 0;
    mocks.get.mockImplementation(async () => {
      getCalls += 1;
      return roleAsset({ prompt: getCalls === 1 ? "润色前的旧词" : "润色后的提示词" });
    });
    mocks.generateAsset.mockResolvedValue({
      phase: "done",
      polishResult: { status: "success", prompt: "润色后的提示词" },
      imageLocalPath: "local-image://characters/x.png",
    });
    renderDialog(roleAsset({ prompt: "润色前的旧词" }));

    // 挂载 get 刷新后:草稿=库值旧词;未润色过(prePolishPrompt=null)→钮禁用
    await waitFor(() => expect(screen.getByDisplayValue("润色前的旧词")).toBeTruthy());
    const restoreButton = screen.getByRole("button", { name: /还原上次润色前/ }) as HTMLButtonElement;
    expect(restoreButton.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /一键生成资产生图/ }));
    await waitFor(() => expect(screen.getByDisplayValue("润色后的提示词")).toBeTruthy());
    expect(restoreButton.disabled).toBe(false);

    fireEvent.click(restoreButton);
    // 回滚:draftPrompt 回润色前快照;当前值=存值→钮复禁
    await waitFor(() => expect(screen.getByDisplayValue("润色前的旧词")).toBeTruthy());
    expect(restoreButton.disabled).toBe(true);
  });

  it("润色后手编再还原→仍回润色前快照(语义=撤销上次润色,非撤销全部编辑)", async () => {
    let getCalls = 0;
    mocks.get.mockImplementation(async () => {
      getCalls += 1;
      return roleAsset({ prompt: getCalls === 1 ? "润色前的旧词" : "润色后的提示词" });
    });
    mocks.generateAsset.mockResolvedValue({
      phase: "done",
      polishResult: { status: "success", prompt: "润色后的提示词" },
      imageLocalPath: "local-image://characters/x.png",
    });
    renderDialog(roleAsset({ prompt: "润色前的旧词" }));

    await waitFor(() => expect(screen.getByDisplayValue("润色前的旧词")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /一键生成资产生图/ }));
    await waitFor(() => expect(screen.getByDisplayValue("润色后的提示词")).toBeTruthy());

    // 手编偏离润色值
    const textarea = screen.getByPlaceholderText("暂无出图提示词");
    fireEvent.change(textarea, { target: { value: "手编新词" } });
    const restoreButton = screen.getByRole("button", { name: /还原上次润色前/ }) as HTMLButtonElement;
    expect(restoreButton.disabled).toBe(false);

    fireEvent.click(restoreButton);
    // 照常还原到润色前快照(非手编前)
    await waitFor(() => expect(screen.getByDisplayValue("润色前的旧词")).toBeTruthy());
  });
});
