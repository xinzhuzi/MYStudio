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

// 10-27 用户令:阶段选择器随区头整行删除——金丹期交互两测随迁移除
// (dispatchTypeShot 的 stage 参数与 activeStage 派发语义仍在源内,UI 入口已无)
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



  it("选中阶段与子区联动(10-26:子区退役,选择器独立在场即可)", () => {
    renderDialog();
    expect(screen.queryByRole("button", { name: /查看源提示词/ })).toBeTruthy();
  });
});
