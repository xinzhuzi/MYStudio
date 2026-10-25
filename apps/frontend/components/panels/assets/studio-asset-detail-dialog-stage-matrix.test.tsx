// @vitest-environment jsdom
/**
 * 10-25-asset-stage-prompt-matrix T2/T3 接线测试(阶段提示词子区+生成路阶段选择器):
 * 桥/生成编排/按型出图 service 走 vi.mock 控制桩(沿 studio-asset-detail-dialog-
 * prompt-inspect.test.tsx 范式),弹窗与提示词区全真实渲染;ui/select 换常驻渲染
 * 替身(Radix Select 在 jsdom 需指针捕获,沿 ApiSettingsContainer.test.tsx 范式)。
 * - T2:子区渲染守卫(晏燎 32 实名→十境下拉;独孤剑尘零阶段→子区与选择器均不渲染);
 * - T2 懒读:不展开零 IPC;展开=当前阶段每型 latest 各一发(≤3);切换阶段只读新键;
 *      失败走既有降级文案;全文仅型卡展开渲染;
 * - T3:阶段选择器→executeTypeShot 传参断言(命名=资产名_{阶段}_{型名}_中文日期,
 *      不再锚轮播图名);i2i 参考图锚=阶段组内最新一张(任意型)——service 桩位
 *      task.referenceImage 即 aiManager referenceImages 单源(asset-type-shot.ts
 *      `referenceImages: [task.referenceImage!]`),resultImageName 经
 *      saveGeneratedAssetImageToLibrary 桩位断言;t2i 路仅命名带阶段;「无」默认
 *      走既有命名(原图名_{型名}_日期)与轮播当前参考图。
 *
 * fixture 真源:晏燎 32 实名/独孤剑尘 4 实名逐字自 T1 asset-stage-prompts.test.ts
 * (assets.db 只读实测内嵌,保留实库序);url 为测试注入的展示序标记。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioAssetDetailDialog } from "./StudioAssetDetailDialog";
import { REALM_LADDER } from "@/lib/studio/asset-stage-prompts";
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
    readImagePromptText: mocks.readImagePromptText,
  }),
}));

vi.mock("@/lib/studio/asset-generation-orchestrator", () => ({
  generateAsset: mocks.generateAsset,
}));

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

// ui/select 测试替身:常驻渲染选项按钮+context 传递 onValueChange/当前值(保住
// 被测弹窗的真实状态流:选值→生成派发;两处 Select 各自持 context,互不串扰)。
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const selectContext = React.createContext<{ value: string; onValueChange?: (value: string) => void }>({ value: "" });
  type SelectProps = { children?: React.ReactNode; value?: string; onValueChange?: (value: string) => void };
  return {
    Select: ({ children, value, onValueChange }: SelectProps) => (
      <selectContext.Provider value={{ value: value ?? "", onValueChange }}>{children}</selectContext.Provider>
    ),
    SelectTrigger: ({ children, ...props }: SelectProps & Record<string, unknown>) => <div {...props}>{children}</div>,
    SelectValue: () => {
      const context = React.useContext(selectContext);
      return <span>{context.value || ""}</span>;
    },
    SelectContent: ({ children }: SelectProps) => <div>{children}</div>,
    SelectItem: ({ value, children }: { value: string; children?: React.ReactNode }) => {
      const context = React.useContext(selectContext);
      return (
        <button type="button" data-testid={`option-${value}`} onClick={() => context.onValueChange?.(value)}>
          {children}
        </button>
      );
    },
  };
});

/** 最小 i2i 工作流(与 prompt-inspect 测试同源;终稿串带可辨标记)。 */
const FINAL_TEXT = "终稿指令全文(引擎实收)";
const I2I_WORKFLOW_JSON = JSON.stringify({
  "10": { class_type: "LoadImage", inputs: { image: "ref.png" } },
  "400": { class_type: "PrimitiveStringMultiline", inputs: { value: FINAL_TEXT } },
  "6:4011": { class_type: "MyQi21PromptAssembly", inputs: { 锁层A全文: "美术风格底座注入层全文", 主体句负面: "" } },
  "7:7014": { class_type: "PrimitiveInt", inputs: { value: 1317923666 } },
});

/** 晏燎 32 实名(实库序逐字自 T1 测试件;url=展示序标记 media://y1..y32)。 */
const YANLIAO_NAMES = [
  "晏燎_元婴期_三视图_v1", "晏燎_元婴期_正视图_v1", "晏燎_元婴期_海报_v1",
  "晏燎_共主期_三视图_v1", "晏燎_共主期_正视图_v1", "晏燎_共主期_海报_v1",
  "晏燎_化神期_三视图_v1", "晏燎_化神期_正视图_v1", "晏燎_化神期_海报_v1",
  "晏燎_合体期_三视图_v1", "晏燎_合体期_正视图_v1", "晏燎_合体期_海报_v1",
  "晏燎_全身定妆_v1",
  "晏燎_大乘期_三视图_v1", "晏燎_大乘期_正视图_v1", "晏燎_大乘期_海报_v1",
  "晏燎_渡劫期_三视图_v1", "晏燎_渡劫期_正视图_v1", "晏燎_渡劫期_海报_v1",
  "晏燎_炼虚期_三视图_v1", "晏燎_炼虚期_正视图_v1", "晏燎_炼虚期_海报_v1",
  "晏燎_筑基期_三视图_v1", "晏燎_筑基期_正视图_v1", "晏燎_筑基期_海报_v1",
  "晏燎_练气期_三视图_v1", "晏燎_练气期_正视图_v1", "晏燎_练气期_海报_v1",
  "晏燎_表情差分_v1",
  "晏燎_金丹期_三视图_v1", "晏燎_金丹期_正视图_v1", "晏燎_金丹期_海报_v1",
] as const;

const YANLIAO_IMAGES = YANLIAO_NAMES.map((name, index) => ({
  name,
  filePath: `role/晏燎/${name}.png`,
  url: `media://y${index + 1}`,
}));

/** 独孤剑尘 4 实名(配角零阶段段,逐字自 T1 测试件)。 */
const DUGU_IMAGES = [
  { name: "独孤剑尘_高清大脸_2026年10月21日", filePath: "role/独孤剑尘/独孤剑尘_高清大脸_2026年10月21日.png" },
  { name: "独孤剑尘_人物图_2026年10月21日", filePath: "role/独孤剑尘/独孤剑尘_人物图_2026年10月21日.png" },
  { name: "独孤剑尘_多视图_2026年10月21日", filePath: "role/独孤剑尘/独孤剑尘_多视图_2026年10月21日.png" },
  { name: "独孤剑尘_参考图", filePath: "role/独孤剑尘/1.独孤剑尘.png" },
];

function roleAsset(overrides: Partial<StudioAssetSummary> = {}): StudioAssetSummary {
  return {
    id: "role-1",
    source: "manying-local",
    type: "role",
    name: "晏燎",
    description: "北境剑修",
    ...overrides,
  };
}

function renderDialog(
  asset: StudioAssetSummary = roleAsset({ images: YANLIAO_IMAGES }),
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

/** 展开「提示词构成」折叠组(阶段提示词子区住其内,懒读由此触发)。 */
function expandComposition() {
  fireEvent.click(screen.getByRole("button", { name: /提示词构成/ }));
}

beforeEach(() => {
  window.localStorage.clear();
  // 定时钟(命名断言钉 2026年10月25日);shouldAdvanceTime 保 waitFor 计时器照走
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 9, 25, 12, 0, 0));
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
  vi.useRealTimers();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("T2 子区渲染守卫(PRD §3.1/§六:≥2 阶段才渲染,配角零变化)", () => {
  it("晏燎 32 实名:展开「提示词构成」后子区在场,下拉=十境全量(聚类阶梯序选项)", () => {
    renderDialog();

    // 未展开:子区住折叠组内,不渲染
    expect(screen.queryByLabelText("阶段提示词")).toBeNull();
    expandComposition();

    expect(screen.getByLabelText("阶段提示词")).toBeTruthy();
    // 十境全量选项(子区 Select+生成路 Select 两处各一份)
    for (const stage of REALM_LADDER) {
      expect(screen.getAllByTestId(`option-${stage}`).length).toBe(2);
    }
  });

  it("独孤剑尘 4 实名(零阶段段):子区与「阶段」选择器均不渲染,展开后零 IPC", () => {
    renderDialog(roleAsset({ images: DUGU_IMAGES }));

    // 生成路「阶段」选择器不渲染(头部行)
    expect(screen.queryByLabelText("阶段")).toBeNull();
    expandComposition();

    expect(screen.queryByLabelText("阶段提示词")).toBeNull();
    expect(screen.queryByLabelText("阶段")).toBeNull();
    expect(screen.queryByTestId("option-__stage_none__")).toBeNull();
    expect(mocks.readImagePromptText).not.toHaveBeenCalled();
  });

  it("生成路「阶段」选择器在场(晏燎):「无」默认,与子区下拉并存", () => {
    renderDialog();

    const headerStageSelect = screen.getByLabelText("阶段");
    expect(headerStageSelect).toBeTruthy();
    // 「无」选项仅在生成路选择器(子区下拉无「无」项)
    expect(screen.getAllByTestId("option-__stage_none__").length).toBe(1);
    // 子区下拉默认=聚类末位(最高境界 共主期);未展开时子区不渲染,只此一份共主期选项
    expect(screen.getAllByTestId("option-共主期").length).toBe(1);
    expect(screen.queryByLabelText("阶段提示词·阶段")).toBeNull();
  });
});

describe("T2 懒读(PRD §3.2:展开才发 IPC,当前阶段每型 latest 各一发,按阶段+型缓存)", () => {
  it("在飞期 probing 占位(复审#3 补):桥桩悬停不决时型卡渲染「正在读取…」,正文区不空白", async () => {
    const releasers: Array<(v: { ok: boolean; reason?: string }) => void> = [];
    mocks.readImagePromptText.mockReset().mockImplementation(
      () => new Promise((resolve) => { releasers.push(resolve as (v: { ok: boolean; reason?: string }) => void); }),
    );
    renderDialog();
    expandComposition();
    await waitFor(() => {
      expect(screen.getAllByText("正在读取该型产物提示词…").length).toBeGreaterThan(0);
    });
    // 全部作业放行后,占位被终态覆盖(默认阶段两型各一发)
    for (const release of releasers.splice(0)) release({ ok: false, reason: "no-texr" });
    await waitFor(() => {
      expect(screen.queryByText("正在读取该型产物提示词…")).toBeNull();
    });
  });

  it("不展开零调用;展开=默认阶段(共主期)每型 latest 各一发(共 2 发,人物海报+人物多视图)", async () => {
    renderDialog();

    expect(mocks.readImagePromptText).not.toHaveBeenCalled();
    expandComposition();

    await waitFor(() => expect(mocks.readImagePromptText).toHaveBeenCalledTimes(2));
    const calledPaths = mocks.readImagePromptText.mock.calls.map(([task]) => task.filePath);
    // 每型 latest:海报组=海报_v1;多视图组=正视图_v1(实库序三视图在前正视图在后)
    expect(calledPaths).toEqual(
      expect.arrayContaining(["role/晏燎/晏燎_共主期_海报_v1.png", "role/晏燎/晏燎_共主期_正视图_v1.png"]),
    );
  });

  it("切换阶段只读新阶段未缓存键;切回已缓存阶段零重读(按 阶段__型 缓存)", async () => {
    renderDialog();
    expandComposition();
    await waitFor(() => expect(mocks.readImagePromptText).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getAllByTestId("option-金丹期")[0]);
    await waitFor(() => expect(mocks.readImagePromptText).toHaveBeenCalledTimes(4));
    expect(mocks.readImagePromptText.mock.calls.map(([task]) => task.filePath)).toEqual(
      expect.arrayContaining(["role/晏燎/晏燎_金丹期_海报_v1.png", "role/晏燎/晏燎_金丹期_正视图_v1.png"]),
    );

    // 切回共主期:缓存命中,零新增调用(子区下拉值随 selectedStage 联动回共主期)
    fireEvent.click(screen.getAllByTestId("option-共主期")[0]);
    await waitFor(() =>
      expect(screen.getByLabelText("阶段提示词·阶段").textContent).toContain("共主期"),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocks.readImagePromptText).toHaveBeenCalledTimes(4);
  });

  it("失败走既有降级文案(no-texr):型卡注明「该图无提示词元数据」", async () => {
    renderDialog();
    expandComposition();

    expect(await screen.findAllByText("该图无提示词元数据")).toHaveLength(2);
  });

  it("读取成功:字数徽标在场;全文仅型卡展开渲染(收起态零长文)", async () => {
    mocks.readImagePromptText.mockResolvedValue({ ok: true, text: I2I_WORKFLOW_JSON });
    renderDialog();
    expandComposition();

    expect(await screen.findAllByText(`${FINAL_TEXT.length}字`)).toHaveLength(2);
    // 收起态:终稿全文不渲染(仅展开渲染)
    expect(screen.queryByText(FINAL_TEXT)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "共主期人物海报终稿全文展开" }));
    expect(screen.getByText(FINAL_TEXT)).toBeTruthy();
    // 另一型卡保持收起:全文仅一份
    expect(screen.getAllByText(FINAL_TEXT)).toHaveLength(1);
  });

  it("查词/重掷两钮构造既有弹层目标(含 imageUrl;零新动作)", async () => {
    mocks.readImagePromptText.mockResolvedValue({ ok: true, text: I2I_WORKFLOW_JSON });
    renderDialog();
    expandComposition();
    await waitFor(() => expect(mocks.readImagePromptText).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole("button", { name: "查词 晏燎_共主期_海报_v1(阶段提示词)" }));
    expect(await screen.findByText("查词 · 晏燎_共主期_海报_v1")).toBeTruthy();
    // B-4 重掷链路在场(共用壳的「用此词重掷」钮可達)
    expect(await screen.findByRole("button", { name: /用此词重掷/ })).toBeTruthy();

    // 关弹层后再开重掷(弹层在场时背景 aria-hidden,角色查询只见顶层弹层)
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByText("查词 · 晏燎_共主期_海报_v1")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "重掷 晏燎_共主期_海报_v1(阶段提示词)" }));
    expect(await screen.findByText("重掷 · 晏燎_共主期_海报_v1")).toBeTruthy();
  });

  it("复审竞态修:懒读在飞时 images 异步回填(familyImages)不丢结果,型卡正文不静默空白", async () => {
    // 复审场景:compositionOpen 持久,懒读在飞期间任何 images 刷新(此处=家长件
    // familyImages 异步回填;同类还有重开弹窗 bridge.get 的 setImages/生成完成回填)
    // 都换 activeStageCluster 身份触发 effect 重跑——旧轮在飞结果若被 cleanup 的
    // cancelled 旗整批丢弃,而新轮 pending 又滤掉在飞键,作业完成后无人再触发 effect,
    // 该阶段型卡正文区静默空白(entry=undefined 时三分支全不渲染)。修复=会话代隔离
    // (依赖重跑不换代,在飞结果照常落缓存),本测试钉该路径。
    const resolvers: Array<(value: { ok: boolean; text: string }) => void> = [];
    mocks.readImagePromptText.mockImplementation(
      () => new Promise((resolve) => { resolvers.push(resolve); }),
    );
    const baseAsset = roleAsset({ images: YANLIAO_IMAGES });
    const { rerender } = renderDialog(baseAsset);
    expandComposition();
    await waitFor(() => expect(mocks.readImagePromptText).toHaveBeenCalledTimes(2));

    // 在飞期间 familyImages 异步回填(同图集,仅换 displayImages 身份)
    const familyEntries: FamilyImageEntry[] = YANLIAO_IMAGES.map((img) => ({
      ...img,
      assetId: "role-1",
      assetName: "晏燎",
    }));
    rerender(
      <StudioAssetDetailDialog
        asset={baseAsset}
        open
        onOpenChange={vi.fn()}
        familyImages={familyEntries}
      />,
    );
    await act(async () => { await Promise.resolve(); });
    // 重跑轮 pending 滤掉在飞键:零新增 IPC(在飞去重保持)
    expect(mocks.readImagePromptText).toHaveBeenCalledTimes(2);

    // 在飞读取完成:结果须落缓存并渲染字数徽标(修复前此处被 cancelled 丢弃→
    // 正文区静默空白,无 loader/无降级/无终稿)
    await act(async () => {
      for (const resolve of resolvers) resolve({ ok: true, text: I2I_WORKFLOW_JSON });
    });
    expect(await screen.findAllByText(`${FINAL_TEXT.length}字`)).toHaveLength(2);
  });
});

describe("T3 生成路阶段选择器(PRD §3.3:命名与参考图锚定)", () => {
  it("默认「无」:按型出图走既有命名(原图名_型名_日期)与轮播当前参考图", async () => {
    mocks.typeShot.mockResolvedValue({ phase: "done", imageLocalPath: "local-image://characters/poster.png" });
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "生成人物海报" }));
    await waitFor(() => expect(mocks.typeShot).toHaveBeenCalledTimes(1));

    const [task] = mocks.typeShot.mock.calls[0];
    expect(task.kind).toBe("人物海报");
    // 轮播当前=index 0(元婴期三视图)= 既有 resolveAssetGenerationReferenceImage 行为
    expect(task.referenceImage).toBe("media://y1");
    // 既有命名:i2i 锚轮播图名(不带阶段段)
    await waitFor(() =>
      expect(mocks.saveImageToLibrary).toHaveBeenCalledWith(
        "role-1",
        "local-image://characters/poster.png",
        undefined,
        "晏燎_元婴期_三视图_v1_人物海报_2026年10月25日",
      ),
    );
  });

  it("选金丹期→executeTypeShot 带阶段:i2i 命名=资产名_阶段_型名_日期(不锚轮播图名),参考图锚=金丹期组内最新一张(任意型)", async () => {
    mocks.typeShot.mockResolvedValue({ phase: "done", imageLocalPath: "local-image://characters/poster.png" });
    renderDialog();

    fireEvent.click(screen.getAllByTestId("option-金丹期")[0]);
    fireEvent.click(screen.getByRole("button", { name: "生成人物海报" }));
    await waitFor(() => expect(mocks.typeShot).toHaveBeenCalledTimes(1));

    // 命名段+参考图锚:金丹期组内最新(任意型)=实库序末位 晏燎_金丹期_海报_v1(media://y32)
    const [task] = mocks.typeShot.mock.calls[0];
    expect(task.kind).toBe("人物海报");
    expect(task.referenceImage).toBe("media://y32");
    await waitFor(() =>
      expect(mocks.saveImageToLibrary).toHaveBeenCalledWith(
        "role-1",
        "local-image://characters/poster.png",
        undefined,
        "晏燎_金丹期_人物海报_2026年10月25日",
      ),
    );
    // 轮播当前仍停 index 0(元婴期三视图)——阶段锚覆盖之,防旧图名/异阶段参考链式繁殖
    expect(task.referenceImage).not.toBe("media://y1");
  });

  it("t2i 路(设定卡)仅命名带阶段,无参考图语义", async () => {
    mocks.typeShot.mockResolvedValue({ phase: "done", imageLocalPath: "local-image://characters/card.png" });
    renderDialog();

    fireEvent.click(screen.getAllByTestId("option-金丹期")[0]);
    fireEvent.click(screen.getByRole("button", { name: "生成设定卡" }));
    await waitFor(() => expect(mocks.typeShot).toHaveBeenCalledTimes(1));

    const [task] = mocks.typeShot.mock.calls[0];
    expect(task.kind).toBe("设定卡");
    expect(task.referenceImage).toBeUndefined();
    await waitFor(() =>
      expect(mocks.saveImageToLibrary).toHaveBeenCalledWith(
        "role-1",
        "local-image://characters/card.png",
        undefined,
        "晏燎_金丹期_设定卡_2026年10月25日",
      ),
    );
  });

  it("选中阶段与子区下拉联动(共用 selectedStage):生成路选金丹期→子区聚焦金丹期", async () => {
    renderDialog();
    fireEvent.click(screen.getAllByTestId("option-金丹期")[0]);
    expandComposition();

    // 子区当前阶段=金丹期(懒读只发金丹期两型;默认共主期被联动覆盖)
    await waitFor(() => expect(mocks.readImagePromptText).toHaveBeenCalledTimes(2));
    expect(mocks.readImagePromptText.mock.calls.map(([task]) => task.filePath)).toEqual(
      expect.arrayContaining(["role/晏燎/晏燎_金丹期_海报_v1.png", "role/晏燎/晏燎_金丹期_正视图_v1.png"]),
    );
    expect(screen.getByLabelText("阶段提示词")).toBeTruthy();
  });
});
