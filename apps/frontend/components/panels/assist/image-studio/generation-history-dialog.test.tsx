// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as any).Element.prototype.scrollTo ??= () => {};

import { GenerationHistoryDialog } from "./generation-history-dialog";
import {
  __resetCanvasCommandBusForTests,
  registerCanvasDispatcher,
  type CanvasCommand,
} from "@/lib/studio/canvas-commands";
import { useFreedomStore, type HistoryEntry } from "@/stores/assist/freedom-store";

/**
 * 09-03 生成记录弹窗:全面展示+一键复原(ops restore-generation)。
 * jsdom 无 projectFiles 桥 → ledger 读取回落空,只用 localStorage 记录驱动。
 */

const BENIGN_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
const toastErrorMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { error: toastErrorMock, success: toastSuccessMock, info: vi.fn(), warning: vi.fn() },
}));

afterEach(() => {
  cleanup();
  __resetCanvasCommandBusForTests();
  useFreedomStore.setState(useFreedomStore.getState(), true);
  localStorage.clear();
  vi.clearAllMocks();
});

function seedHistory() {
  const enriched: HistoryEntry = {
    id: "rec_new",
    type: "image",
    prompt: "水墨仙山,云雾缭绕",
    model: "krea2-turbo",
    resultUrl: BENIGN_PNG,
    params: {
      source: "image-studio-canvas",
      references: ["project-file://p1/media/ai-image/2026-09/ref.png"],
      negativePrompt: "模糊,水印",
      aspectRatio: "1:1",
      resolution: "2K",
      count: 2,
      batchUrls: [BENIGN_PNG, "data:image/png;base64,second"],
    },
    createdAt: 200,
    mediaId: "m1",
  };
  const legacy: HistoryEntry = {
    id: "rec_old",
    type: "image",
    prompt: "旧记录",
    model: "gpt-image-2",
    resultUrl: BENIGN_PNG,
    params: { source: "image-studio-canvas" },
    createdAt: 100,
  };
  useFreedomStore.setState({ imageHistory: [legacy, enriched] });
}

describe("GenerationHistoryDialog(09-03 弹窗)", () => {
  it("全面展示:列表+详情含提示词全文/反向词/画幅/参考图条/落盘路径/批量张数", () => {
    seedHistory();
    render(<GenerationHistoryDialog open onOpenChange={() => {}} />);
    // 列表两卡,新记录自动选中(提示词同文出现在列表卡与详情区,用 getAll 断言)
    expect(screen.getAllByText("水墨仙山,云雾缭绕").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("旧记录")).toBeTruthy();
    expect(screen.getByText("反向提示词")).toBeTruthy();
    expect(screen.getByText("模糊,水印")).toBeTruthy();
    expect(screen.getByText("参考图 1")).toBeTruthy();
    expect(screen.getByText("2 张(批量组)")).toBeTruthy();
    expect(screen.getByText("图片工作室画布")).toBeTruthy();
    expect((document.querySelector("input[readonly]") as HTMLInputElement)?.value).toBe(BENIGN_PNG);
  });

  it("复原到画布:单条 restore-generation 指令带全量输入快照并关弹窗", () => {
    seedHistory();
    const dispatched: CanvasCommand[] = [];
    const onClose = vi.fn();
    registerCanvasDispatcher("image-studio", (command) => {
      dispatched.push(command);
      return { ok: true, detail: { nodeId: "gen-x", promptNodeId: "prompt-x" } };
    });
    render(<GenerationHistoryDialog open onOpenChange={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /复原到画布/ }));
    expect(dispatched.map((command) => command.kind)).toEqual(["restore-generation"]);
    const command = dispatched[0] as Extract<CanvasCommand, { kind: "restore-generation" }>;
    expect(command).toMatchObject({
      surface: "image-studio",
      prompt: "水墨仙山,云雾缭绕",
      negativePrompt: "模糊,水印",
      model: "krea2-turbo",
      aspectRatio: "1:1",
      references: ["project-file://p1/media/ai-image/2026-09/ref.png"],
      batchImageUrls: [BENIGN_PNG, "data:image/png;base64,second"],
      generatedAt: 200,
      result: { imageUrl: BENIGN_PNG, mediaId: "m1" },
    });
    expect(toastSuccessMock).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledWith(false);
  });

  it("旧记录降级复原(无输入快照);复原失败原因如实 toast", () => {
    seedHistory();
    const dispatched: CanvasCommand[] = [];
    let failMode = false;
    registerCanvasDispatcher("image-studio", (command) => {
      dispatched.push(command);
      return failMode
        ? { ok: false, reason: "画布未就绪" }
        : { ok: true, detail: { nodeId: "gen-x" } };
    });
    render(<GenerationHistoryDialog open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByText("旧记录"));
    fireEvent.click(screen.getByRole("button", { name: /复原到画布/ }));
    const command = dispatched[dispatched.length - 1] as Extract<
      CanvasCommand,
      { kind: "restore-generation" }
    >;
    expect(command.prompt).toBe("旧记录");
    expect(command.references).toBeUndefined();
    expect(command.batchImageUrls).toBeUndefined();

    failMode = true;
    fireEvent.click(screen.getByRole("button", { name: /复原到画布/ }));
    expect(toastErrorMock).toHaveBeenCalledWith("复原失败:画布未就绪");
  });
});
