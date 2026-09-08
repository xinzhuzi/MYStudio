// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildComfyImportPreview,
  ComfyWorkflowImportDialog,
} from "./comfy-workflow-import-dialog";
import type { ComfyWorkflowImportFileResult } from "@/lib/assist/image-studio/comfy-workflow-library";

const VALID_JSON = JSON.stringify({
  "1": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["0", 0] } },
  "0": { class_type: "CLIPLoader", inputs: { clip_name: "a.safetensors" } },
});
const REBALANCE_JSON = JSON.stringify({
  "1": { class_type: "ConditioningKrea2Rebalance", inputs: { conditioning: ["0", 0], multiplier: 1.0 } },
  "0": { class_type: "CLIPLoader", inputs: { clip_name: "a.safetensors" } },
});
const UI_FORMAT = JSON.stringify({ nodes: [], links: [] });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("buildComfyImportPreview(预览纯函数)", () => {
  it("有效文件→节点数+缺失插件标记;同名→conflict", () => {
    const items = buildComfyImportPreview(
      [
        { name: "新流.json", content: VALID_JSON },
        { name: "同名.json", content: VALID_JSON },
        { name: "缺插件.json", content: REBALANCE_JSON },
      ],
      new Set(["同名"]),
      ["CLIPTextEncode", "CLIPLoader"],
    );
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ nodeCount: 2, conflict: false, missingClassTypes: [] });
    expect(items[1]).toMatchObject({ conflict: true });
    expect(items[2].missingClassTypes).toEqual(["ConditioningKrea2Rebalance"]);
  });

  it("UI 格式拦截止步+指路;非 .json 文件过滤", () => {
    const items = buildComfyImportPreview(
      [
        { name: "画布格式.json", content: UI_FORMAT },
        { name: "note.txt", content: "x" },
      ],
      new Set(),
      [],
    );
    expect(items).toHaveLength(1);
    expect(items[0].error).toContain("API 格式");
  });
});

function pickFiles(names: string[], contents: string[]) {
  const files = names.map((name, index) => new File([contents[index]], name, { type: "application/json" }));
  const input = document.querySelector<HTMLInputElement>("[data-comfy-import-file-input]");
  if (!input) throw new Error("missing file input");
  Object.defineProperty(input, "files", { value: files, configurable: true });
  fireEvent.change(input);
}

describe("ComfyWorkflowImportDialog(导入弹窗,grill Q8)", () => {
  it("选文件→预览:节点数/缺失插件红字/同名标记;导入执行并回显结果", async () => {
    const onImport = vi.fn(async (files) =>
      files.map((file, index) => ({ name: file.name, status: "imported" as const, id: `wf-${index}` })),
    );
    render(
      <ComfyWorkflowImportDialog
        open
        libraryNames={new Set(["同名"])}
        availableClassTypes={["CLIPTextEncode", "CLIPLoader"]}
        onImport={onImport}
        onOpenChange={() => {}}
      />,
    );
    pickFiles(
      ["新流.json", "同名.json", "缺插件.json", "坏的.json"],
      [VALID_JSON, VALID_JSON, REBALANCE_JSON, "{oops"],
    );
    await waitFor(() => {
      expect(screen.getByText("新流.json")).toBeTruthy();
    });
    // 节点数与红字缺失(导入前列出);多个文件各自显示节点数
    expect(screen.getAllByText("2 节点").length).toBeGreaterThanOrEqual(2);
    // 缺失插件导入前红字点名(formatMissingClassTypesMessage 全文)
    expect(screen.getByText(/缺 1 个节点类型\(ConditioningKrea2Rebalance\)/)).toBeTruthy();
    expect(screen.getByText("坏的.json").parentElement?.textContent).toContain("无法导入");
    // 同名行有「同名」标记
    expect(screen.getByText("同名")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("导入 3 个")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("导入 3 个"));
    await waitFor(() => {
      expect(screen.getAllByText("已导入").length).toBe(3);
    });
    // 非冲突 3 个(坏的.json 被拦)+ 冲突默认跳过:一批下发(默认模式 skip)
    expect(onImport).toHaveBeenCalledTimes(1);
    const [sentFiles, sentMode] = onImport.mock.calls[0] as unknown as [
      { name: string }[],
      string,
    ];
    expect(sentMode).toBe("skip");
    expect(sentFiles.map((file) => file.name)).toEqual(["新流.json", "同名.json", "缺插件.json"]);
  });

  it("同名默认跳过:批量模式选择器就位(跳过/覆盖/两者保留语义由库服务测试覆盖)", async () => {
    const onImport = vi.fn(async (files) =>
      files.map((file) => ({ name: file.name, status: "skipped" as const, reason: "conflict" as const })),
    );
    render(
      <ComfyWorkflowImportDialog
        open
        libraryNames={new Set(["A"])}
        availableClassTypes={["CLIPTextEncode", "CLIPLoader"]}
        onImport={onImport}
        onOpenChange={() => {}}
      />,
    );
    pickFiles(["A.json"], [VALID_JSON]);
    await waitFor(() => {
      expect(screen.getByText("A.json")).toBeTruthy();
    });
    // 同名标记 + 批量策略选择器出现
    expect(screen.getByText("1 个同名,批量设为:", { exact: false }).textContent).toContain("批量");
    fireEvent.click(screen.getByText("导入 1 个"));
    await waitFor(() => {
      expect(screen.getByText("已跳过(同名)")).toBeTruthy();
    });
  });

  it("导入结果含失败行:红字显示错误", async () => {
    const onImport = vi.fn(async (): Promise<ComfyWorkflowImportFileResult[]> => [
      { name: "x.json", status: "failed", error: "文件不是有效 JSON" },
    ]);
    render(
      <ComfyWorkflowImportDialog
        open
        libraryNames={new Set()}
        availableClassTypes={[]}
        onImport={onImport}
        onOpenChange={() => {}}
      />,
    );
    pickFiles(["x.json"], [VALID_JSON]);
    await waitFor(() => {
      expect(screen.getByText("x.json")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("导入 1 个"));
    await waitFor(() => {
      // 失败行红字回显(结果区)
      expect(screen.getAllByText("文件不是有效 JSON").length).toBeGreaterThanOrEqual(1);
    });
  });
});
