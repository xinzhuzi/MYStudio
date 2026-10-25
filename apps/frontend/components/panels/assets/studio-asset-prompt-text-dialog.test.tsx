// @vitest-environment jsdom
/**
 * 10-25-asset-prompt-layered-panel A-2③/B-3 共用弹层(studio-asset-prompt-text-dialog)
 * 交互测试:B-1 桥打桩,覆盖分层展示(正向终稿/注入层/seed/路)、复制全文、族兄弟
 * 标注、③脚注、键位漂移降级(原始 tEXt 兜底)与 §4.4 降级矩阵文案。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  StudioAssetPromptTextDialog,
  type PromptTextInspectTarget,
} from "./studio-asset-prompt-text-dialog";

/** 桥桩:桥本体为可变对象,readImagePromptText 可整置 undefined 驱逐(桥缺席分支)。 */
const mocks = vi.hoisted(() => ({
  readImagePromptText: vi.fn(),
  bridge: {} as { readImagePromptText?: unknown },
}));

vi.mock("@/lib/bridge/studio-assets", () => ({
  getStudioAssetsBridge: () => mocks.bridge,
}));

/** 最小 i2i 工作流(B-2 解构器实盘键形:400 指令/6:4011 锁层/10 LoadImage/7:7014 seed)。 */
const i2iWorkflowJson = JSON.stringify({
  "10": { class_type: "LoadImage", inputs: { image: "ref.png" } },
  "400": { class_type: "PrimitiveStringMultiline", inputs: { value: "终稿指令全文(引擎实收)" } },
  "6:4011": { class_type: "MyQi21PromptAssembly", inputs: { 锁层A全文: "美术风格底座注入层全文", 主体句负面: "" } },
  "7:7014": { class_type: "PrimitiveInt", inputs: { value: 1317923666 } },
});

function makeTarget(overrides: Partial<PromptTextInspectTarget> = {}): PromptTextInspectTarget {
  return {
    imagePath: "role/f1.png",
    imageName: "晏燎_全身定妆_v1",
    title: "查词 · 晏燎_全身定妆_v1",
    ...overrides,
  };
}

function renderDialog(target: PromptTextInspectTarget) {
  return render(
    <StudioAssetPromptTextDialog open onOpenChange={vi.fn()} target={target} />,
  );
}

/** clipboard 桩(jsdom 无原生实现)。 */
function stubClipboard(): ReturnType<typeof vi.fn> {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return writeText;
}

beforeEach(() => {
  mocks.readImagePromptText = vi.fn();
  mocks.bridge.readImagePromptText = mocks.readImagePromptText;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("StudioAssetPromptTextDialog · 分层展示(B-2 解构结果)", () => {
  it("tEXt ok:i2i 全链按层展示(路/seed/正向终稿/注入层全文)+族兄弟标注+③脚注", async () => {
    mocks.readImagePromptText.mockResolvedValue({ ok: true, text: i2iWorkflowJson });

    renderDialog(
      makeTarget({
        title: "全身定妆 · 实发终稿",
        ownerNote: "来自同族资产 晏燎二哥",
        footnote: "来自该型最近产物的引擎实收,非本次预演",
      }),
    );

    expect(mocks.readImagePromptText).toHaveBeenCalledWith({ filePath: "role/f1.png" });
    expect(await screen.findByText("终稿指令全文(引擎实收)")).toBeTruthy();
    expect(screen.getByText("图生图")).toBeTruthy();
    expect(screen.getByText("seed 1317923666")).toBeTruthy();
    // 注入层:层名取键(锁层A全文)+全文
    expect(screen.getByText("锁层A全文")).toBeTruthy();
    expect(screen.getByText("美术风格底座注入层全文")).toBeTruthy();
    // i2i 实盘无可读负面(禁拼装)→显式空标注,不编造
    expect(screen.getByText("(无可读负面文本)")).toBeTruthy();
    // 族兄弟标注+③底部小字
    expect(screen.getByText("来自同族资产 晏燎二哥")).toBeTruthy();
    expect(screen.getByText("来自该型最近产物的引擎实收,非本次预演")).toBeTruthy();
  });

  it("复制全文:点击复制正向终稿(引擎实收终稿串)", async () => {
    const writeText = stubClipboard();
    mocks.readImagePromptText.mockResolvedValue({ ok: true, text: i2iWorkflowJson });

    renderDialog(makeTarget());
    fireEvent.click(await screen.findByRole("button", { name: /复制全文/ }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("终稿指令全文(引擎实收)"));
  });

  it("键位漂移(tEXt 在但解析抛错):降级展示原始 tEXt+漂移注记,可复制原始串", async () => {
    const writeText = stubClipboard();
    mocks.readImagePromptText.mockResolvedValue({ ok: true, text: "不是工作流JSON" });

    renderDialog(makeTarget());

    expect(await screen.findByText(/解析失败/)).toBeTruthy();
    expect(screen.getByText("不是工作流JSON")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /复制原始 tEXt/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("不是工作流JSON"));
  });
});

describe("StudioAssetPromptTextDialog · 降级矩阵(§4.4)", () => {
  it.each([
    ["no-texr", "该图无提示词元数据"],
    ["not-png", "仅引擎 PNG 产物携带提示词元数据"],
    ["file-missing", "原图文件不可读"],
    ["path-rejected", "原图文件不可读"],
    ["read-failed", "原图文件不可读"],
    ["oversize", "提示词元数据超出读取上限"],
  ] as const)("reason=%s → 文案「%s」", async (reason, label) => {
    mocks.readImagePromptText.mockResolvedValue({ ok: false, reason });
    renderDialog(makeTarget());
    expect(await screen.findByText(label)).toBeTruthy();
  });

  it("桥调用异常(reject)→ 按读失败降级", async () => {
    mocks.readImagePromptText.mockRejectedValue(new Error("ipc down"));
    renderDialog(makeTarget());
    expect(await screen.findAllByText("原图文件不可读")).toBeTruthy();
  });

  it("桥缺席(旧 preload/非桌面,无 readImagePromptText)→ 不支持读取文案", async () => {
    mocks.bridge.readImagePromptText = undefined;
    renderDialog(makeTarget());
    expect(await screen.findByText("当前环境不支持读取提示词元数据")).toBeTruthy();
  });
});
