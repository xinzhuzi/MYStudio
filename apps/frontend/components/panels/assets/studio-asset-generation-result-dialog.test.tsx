// @vitest-environment jsdom
/**
 * R5 生成结果弹窗接线测试(10-26 用户令:每次点生成完成后自动弹出):
 * 桥/生成编排/按型出图 service 走 vi.mock 控制桩(沿 prompt-inspect 范式),
 * 弹窗全真实渲染;ui/select 换常驻渲染替身(沿 stage-matrix 范式,汇总弹窗
 * records>1 的 Select 选择器可交互断言)。定时钟钉 2026年10月25日(产物命名
 * 断言确定性;假钟下耗时恒显「0.0 秒」)。
 * - 机制钉死:弹窗触发只挂 result.phase==='done',与 get/updated/savedToLibrary
 *   无关——写回失败(get 返 null)弹窗照弹+②段降级文案,非「不弹」;
 * - 孤儿防护双闸(blocking#1 钉):宿主关后回调不弹;宿主关闭复位后重开不残留。
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioAssetDetailDialog } from "./StudioAssetDetailDialog";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useTtsStore } from "@/stores/tts/tts-store";
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

// ui/select 测试替身(沿 stage-matrix 范式):常驻渲染选项按钮+context 传递
// onValueChange/当前值(汇总弹窗 records>1 的记录选择器可点击切换断言)。
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
const I2I_WORKFLOW_JSON = JSON.stringify({
  "10": { class_type: "LoadImage", inputs: { image: "ref.png" } },
  "400": { class_type: "PrimitiveStringMultiline", inputs: { value: "终稿指令全文(引擎实收)" } },
  "6:4011": { class_type: "MyQi21PromptAssembly", inputs: { 锁层A全文: "美术风格底座注入层全文", 主体句负面: "" } },
  "7:7014": { class_type: "PrimitiveInt", inputs: { value: 1317923666 } },
});

/** 定钟日期段(命名断言钉;vi.setSystemTime(2026-09-25)=2026年10月25日)。 */
const DATE_SUFFIX = "2026年10月25日";

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

/** 多视图✓ 人脸✓ 在场 → 队列计划=[无衣物定妆, 人物海报, 表情差分](核心节序)。 */
function partiallyCompleteRole(): StudioAssetSummary {
  return roleAsset({
    images: [
      { name: "玄止_练气期_三视图_v1", filePath: "role/a1.png", url: "media://a1" },
      { name: "玄止_练气期_人脸_2026年10月21日", filePath: "role/a4.png", url: "media://a4" },
    ],
  });
}

function renderDialog(asset: StudioAssetSummary = roleAsset(), onOpenChange = vi.fn()) {
  return render(<StudioAssetDetailDialog asset={asset} open onOpenChange={onOpenChange} />);
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

describe("R5 生成结果弹窗(单发:每次生成完成自动弹出,三段确认)", () => {
  it("typeShot done:get 回新产物→①②③三段在场,②段自发读新产物 tEXt", async () => {
    mocks.typeShot.mockResolvedValue({ phase: "done", imageLocalPath: "local-image://characters/fullbody.png" });
    mocks.get.mockResolvedValue({ id: "role-1", filePath: "role/new.png", previewUrl: "media://new", images: [] });
    mocks.readImagePromptText.mockResolvedValue({ ok: true, text: I2I_WORKFLOW_JSON });
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "生成无衣物定妆" }));

    expect(await screen.findByText("生成结果 · 无衣物定妆")).toBeTruthy();
    // ① 输入提示词:t2i 路=描述回退链(subjectText),型徽章在场
    const inputSection = screen.getByLabelText("输入提示词");
    expect(within(inputSection).getByText("北境剑修")).toBeTruthy();
    expect(within(inputSection).getByText("无衣物定妆")).toBeTruthy();
    // ② 实发终稿:对刚产物 managedFilePath 自发桥读→parse 解构终稿
    expect(await screen.findByText("终稿指令全文(引擎实收)")).toBeTruthy();
    expect(mocks.readImagePromptText).toHaveBeenCalledWith({ filePath: "role/new.png" });
    // ③ 生成结果:预览图+文件名+全链耗时(假钟下恒 0.0 秒)
    expect(screen.getByText("0.0 秒")).toBeTruthy();
    const img = document.querySelector('img[src="media://new"]');
    expect(img).not.toBeNull();
    expect(screen.getAllByText(`玄止_无衣物定妆_${DATE_SUFFIX}`).length).toBeGreaterThanOrEqual(1);
  });

  it("写回后 get 返 null(机制钉死):弹窗照弹+②段降级文案+零 IPC(非「不弹」)", async () => {
    mocks.typeShot.mockResolvedValue({ phase: "done", imageLocalPath: "local-image://characters/fullbody.png" });
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "生成无衣物定妆" }));

    expect(await screen.findByText("生成结果 · 无衣物定妆")).toBeTruthy();
    expect(await screen.findByText("产物未写回资产库,无法读取实发终稿")).toBeTruthy();
    expect(mocks.readImagePromptText).not.toHaveBeenCalled();
  });

  it("tEXt 降级:产物 no-texr→②段显降级矩阵文案(禁编造终稿)", async () => {
    mocks.typeShot.mockResolvedValue({ phase: "done", imageLocalPath: "local-image://characters/fullbody.png" });
    mocks.get.mockResolvedValue({ id: "role-1", filePath: "role/new.png", previewUrl: "media://new", images: [] });
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "生成无衣物定妆" }));

    expect(await screen.findByText("生成结果 · 无衣物定妆")).toBeTruthy();
    expect(await screen.findByText("该图无提示词元数据")).toBeTruthy();
  });
});

describe("R5 批量补缺队列(末尾汇总定死)", () => {
  it("两发完成+第三发中止:汇总标题+Select 选择器+两记录可切换,中止加注 abortedKind", async () => {
    mocks.typeShot.mockImplementation(async (task: { kind: string }) => ({
      phase: "done",
      imageLocalPath: `local-image://characters/${task.kind}.png`,
    }));
    // 第三发(表情差分)失败→队列中止:已完成 2/3 + abortedKind=表情差分
    mocks.expressionSheet.mockResolvedValue({ phase: "failed", error: "引擎不在驾" });
    // 渐进桩:首次(弹窗装载)=partial 态;其后(逐型收编后)=含定妆图+主图位
    // (表情差分锚「无衣物定妆图」须 get 回填后才可派发)
    let getCalls = 0;
    mocks.get.mockImplementation(async () => {
      getCalls += 1;
      const base = partiallyCompleteRole();
      if (getCalls <= 1) return base;
      return {
        ...base,
        filePath: "role/main.png",
        previewUrl: "media://main",
        images: [
          ...base.images ?? [],
          { name: `玄止_无衣物定妆_${DATE_SUFFIX}`, filePath: "role/fb.png", url: "media://fb" },
        ],
      };
    });

    renderDialog(partiallyCompleteRole());
    fireEvent.click(screen.getByRole("button", { name: "一键生图" }));

    await waitFor(() => expect(mocks.expressionSheet).toHaveBeenCalledTimes(1));
    // 末尾汇总:标题含 n/total 与中止型注
    expect(
      await screen.findByText(`一键补缺结果 · 玄止 · 已完成 2/3 · 表情差分中止`),
    ).toBeTruthy();
    // 两记录经 Select 选择器在场且可切换(默认选中首条=t2i 路,①段=描述回退句)
    expect(screen.getByTestId(`option-玄止_无衣物定妆_${DATE_SUFFIX}`)).toBeTruthy();
    expect(screen.getByTestId(`option-玄止_练气期_三视图_v1_人物海报_${DATE_SUFFIX}`)).toBeTruthy();
    const inputSection = screen.getByLabelText("输入提示词");
    expect(within(inputSection).getByText("北境剑修")).toBeTruthy();
    // 切到第二记录(i2i 路):①段换固定说明,③段文件名随动
    fireEvent.click(screen.getByTestId(`option-玄止_练气期_三视图_v1_人物海报_${DATE_SUFFIX}`));
    expect(
      await screen.findByText("人物海报走图生图:固定指令锚画面,主体句不参与"),
    ).toBeTruthy();
  });
});

describe("R5 孤儿防护双闸(blocking#1 钉:防未来回归)", () => {
  it("宿主关后回调不弹:点生成→rerender open=false→mock 才 resolve→零弹窗", async () => {
    let resolveShot: ((value: unknown) => void) | undefined;
    mocks.typeShot.mockImplementation(
      () => new Promise((resolve) => { resolveShot = resolve; }),
    );
    const view = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "生成无衣物定妆" }));
    // 宿主关(hostOpenRef 活取同步 false;!open effect 清结果态/累积池)
    view.rerender(<StudioAssetDetailDialog asset={roleAsset()} open={false} onOpenChange={vi.fn()} />);

    // 发车 promise 此后才 resolve:完成链照走(save/get 均达),回调被宿主闸拦
    await act(async () => {
      resolveShot?.({ phase: "done", imageLocalPath: "local-image://characters/fullbody.png" });
    });
    await waitFor(() => expect(mocks.saveImageToLibrary).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByText("生成结果 · 无衣物定妆")).toBeNull();
  });

  it("宿主关闭复位:结果窗开着→关主弹窗即随关→重开不残留", async () => {
    mocks.typeShot.mockResolvedValue({ phase: "done", imageLocalPath: "local-image://characters/fullbody.png" });
    const view = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "生成无衣物定妆" }));
    expect(await screen.findByText("生成结果 · 无衣物定妆")).toBeTruthy();

    view.rerender(<StudioAssetDetailDialog asset={roleAsset()} open={false} onOpenChange={vi.fn()} />);
    expect(screen.queryByText("生成结果 · 无衣物定妆")).toBeNull();

    view.rerender(<StudioAssetDetailDialog asset={roleAsset()} open onOpenChange={vi.fn()} />);
    expect(screen.queryByText("生成结果 · 无衣物定妆")).toBeNull();
  });
});
