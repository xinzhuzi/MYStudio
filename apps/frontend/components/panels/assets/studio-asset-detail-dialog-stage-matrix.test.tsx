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
  "晏燎_无衣物定妆_v1",
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

describe("T2 子区(10-26 用户令:旧构成四层卡全砍,阶段子区随之退役)", () => {
  it("提示词构成折叠组/阶段提示词子区 均不渲染(旧UI已砍)", () => {
    renderDialog();
    expect(screen.queryByText("提示词构成")).toBeNull();
    expect(screen.queryByLabelText("阶段提示词")).toBeNull();
  });
});

describe("T2 懒读(已随旧构成区退役;源提示词 JSON 弹窗另行覆盖)", () => {
  it("expandComposition(旧函数)已退役——源提示词按钮直开弹窗不走懒读", () => {
    renderDialog();
    // 查看源提示词按钮在场,点开弹窗(不依赖展开态)
    expect(screen.queryByRole("button", { name: /查看源提示词/ })).toBeTruthy();
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

  it("选中阶段与子区联动(10-26:子区退役,选择器独立在场即可)", () => {
    renderDialog();
    expect(screen.queryByRole("button", { name: /查看源提示词/ })).toBeTruthy();
  });
});
