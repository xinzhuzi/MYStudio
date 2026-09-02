// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as any).Element.prototype.scrollTo ??= () => {};

import { GenerationHistoryDialog } from "./generation-history-dialog";
import {
  __resetCanvasCommandBusForTests,
  registerCanvasDispatcher,
  type CanvasCommand,
} from "@/lib/studio/canvas-commands";
import { useFreedomStore, type HistoryEntry } from "@/stores/assist/freedom-store";
import { useProjectStore } from "@/stores/project/project-store";

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
  useProjectStore.setState({ activeProjectId: null });
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

  it("落盘位置:展开显示完整地址+主进程解析的绝对路径;换选中自动收起", async () => {
    seedHistory();
    const windowMock = window as unknown as {
      projectFiles?: { getAbsolutePath: (url: string) => Promise<string | null> };
    };
    windowMock.projectFiles = {
      getAbsolutePath: vi.fn(async () => "/Users/who/Projects/IP-MA/media/ai-image/2026-09/a.png"),
    };
    const view = render(<GenerationHistoryDialog open onOpenChange={() => {}} />);
    try {
      // 收起态:只见截断输入框,无「应用内地址」标签
      expect(screen.queryByText("应用内地址")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /展开完整路径/ }));
      expect(await screen.findByText("应用内地址")).toBeTruthy();
      expect(await screen.findByText(/IP-MA\/media\/ai-image/)).toBeTruthy();
      // 换选中自动收起
      fireEvent.click(screen.getByText("旧记录"));
      await waitForGone(view);
    } finally {
      delete windowMock.projectFiles;
      view.unmount();
    }
  });

  it("删除=清理完毕(09-03):ledger 行可删,台账条目+图文件全清,本地行不受牵连", async () => {
    useProjectStore.setState({ activeProjectId: "p1" });
    seedHistory();
    const ledgerJson = JSON.stringify([
      { ts: 300, prompt: "磁盘台账记录", model: "krea2-turbo", file: "2026-09/led.png" },
    ]);
    const fileDeletes: Array<{ projectId: string; relativePath: string }> = [];
    const writes: Array<{ key: string; value: string }> = [];
    const windowMock = window as unknown as {
      projectFiles?: {
        readText: (payload: { projectId: string; relativePath: string }) => Promise<string>;
        writeText: (key: string, value: string) => Promise<void>;
        deleteFile: (payload: { projectId: string; relativePath: string }) => Promise<{ success: boolean }>;
        getAbsolutePath: (url: string) => Promise<string | null>;
      };
    };
    windowMock.projectFiles = {
      // 只本月有台账(readLedgerEntries 会拉本月+上月两个月,全给会渲染成两行)
      readText: vi.fn(async (payload) =>
        payload.relativePath === "media/ai-image/2026-09/ledger.json" ? ledgerJson : "",
      ),
      writeText: vi.fn(async (key, value) => {
        writes.push({ key, value });
      }),
      deleteFile: vi.fn(async (payload) => {
        fileDeletes.push(payload);
        return { success: true };
      }),
      getAbsolutePath: vi.fn(async () => null),
    };
    const view = render(<GenerationHistoryDialog open onOpenChange={() => {}} />);
    try {
      // ledger 行出现后手动选中(选中锚定首条 local,后到的 ledger 不会夺走);
      // 列表+详情两处同文=详情已切到 ledger 行,此时点删除才删的是台账行
      expect(await screen.findByText("磁盘台账记录")).toBeTruthy();
      fireEvent.click(screen.getByText("磁盘台账记录"));
      expect((await screen.findAllByText("磁盘台账记录")).length).toBeGreaterThanOrEqual(2);
      fireEvent.click(screen.getByRole("button", { name: /删除记录/ }));
      await waitFor(() => {
        expect(fileDeletes).toEqual([
          { projectId: "p1", relativePath: "media/ai-image/2026-09/led.png" },
        ]);
      });
      expect(writes.map((write) => write.key)).toEqual(["_p/p1/media/ai-image/2026-09/ledger.json"]);
      expect(JSON.parse(writes[0].value)).toEqual([]);
      expect(toastSuccessMock).toHaveBeenCalledWith("已清理完毕:记录+台账+图文件 1 张");
      // 台账行消失,本地行仍在
      await waitFor(() => expect(screen.queryByText("磁盘台账记录")).toBeNull());
      expect(screen.getAllByText("水墨仙山,云雾缭绕").length).toBeGreaterThanOrEqual(1);
    } finally {
      delete windowMock.projectFiles;
      view.unmount();
    }
  });

  it("删除 local 行:项目内成图+批量组文件全删,本地条目移除;无 ledger 不写盘", async () => {
    useProjectStore.setState({ activeProjectId: "p1" });
    useFreedomStore.setState({
      imageHistory: [
        {
          id: "rec_pf",
          type: "image",
          prompt: "项目内成图",
          model: "m",
          resultUrl: "project-file://p1/media/ai-image/2026-09/main.png",
          params: { batchUrls: ["project-file://p1/media/ai-image/2026-09/b2.png"] },
          createdAt: 200,
        } as HistoryEntry,
      ],
    });
    const fileDeletes: Array<{ projectId: string; relativePath: string }> = [];
    const writes: Array<{ key: string; value: string }> = [];
    const windowMock = window as unknown as {
      projectFiles?: {
        readText: (payload: { projectId: string; relativePath: string }) => Promise<string>;
        writeText: (key: string, value: string) => Promise<void>;
        deleteFile: (payload: { projectId: string; relativePath: string }) => Promise<{ success: boolean }>;
      };
    };
    windowMock.projectFiles = {
      readText: vi.fn(async () => ""),
      writeText: vi.fn(async (key, value) => {
        writes.push({ key, value });
      }),
      deleteFile: vi.fn(async (payload) => {
        fileDeletes.push(payload);
        return { success: true };
      }),
    };
    const view = render(<GenerationHistoryDialog open onOpenChange={() => {}} />);
    try {
      expect((await screen.findAllByText("项目内成图")).length).toBeGreaterThanOrEqual(1);
      fireEvent.click(screen.getByRole("button", { name: /删除记录/ }));
      await waitFor(() => {
        expect(fileDeletes.map((item) => item.relativePath).sort()).toEqual([
          "media/ai-image/2026-09/b2.png",
          "media/ai-image/2026-09/main.png",
        ]);
      });
      // ledger 本为空:removeLedgerEntryByFile 无条目可移除,不写盘
      expect(writes).toEqual([]);
      await waitFor(() => {
        expect(useFreedomStore.getState().imageHistory).toHaveLength(0);
      });
      // 列表与详情两处空态都渲染该文案
      expect(screen.getAllByText("暂无生成记录").length).toBeGreaterThanOrEqual(1);
    } finally {
      delete windowMock.projectFiles;
      view.unmount();
    }
  });

  it("导出 JSON:下载结构化记录(与复原同源数据)", () => {
    seedHistory();
    const blobs: Blob[] = [];
    const createdUrls: string[] = [];
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (blob: Blob) => {
      blobs.push(blob);
      const url = `blob:mock-${createdUrls.length}`;
      createdUrls.push(url);
      return url;
    };
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => {};
    const view = render(<GenerationHistoryDialog open onOpenChange={() => {}} />);
    try {
      fireEvent.click(screen.getByRole("button", { name: /导出 JSON/ }));
      expect(blobs).toHaveLength(1);
      expect(toastSuccessMock).toHaveBeenCalledWith("记录 JSON 已导出");
    } finally {
      (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = originalCreate;
      (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = originalRevoke;
      view.unmount();
    }
  });
});

/** 展开区随选中切换收起的等待(jsdom 无 transition,一帧轮询即可) */
function waitForGone(view: { container: HTMLElement }) {
  return new Promise<void>((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (!view.container.textContent?.includes("应用内地址") || Date.now() - started > 1500) {
        resolve();
        return;
      }
      setTimeout(tick, 25);
    };
    tick();
  });
}
