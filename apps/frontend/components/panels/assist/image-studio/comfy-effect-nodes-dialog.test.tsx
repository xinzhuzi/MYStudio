// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ComfyEffectNodesDialog } from "./comfy-effect-nodes-dialog";

const fetchEngineClassTypes = vi.fn();
const sidecarJson = vi.fn();
vi.mock("./use-comfy-subgraph-run", () => ({
  fetchEngineClassTypes: (...args: unknown[]) => fetchEngineClassTypes(...args),
}));
vi.mock("@/lib/assist/image-studio/comfy-execute", () => ({
  comfySidecarJson: (...args: unknown[]) => sidecarJson(...args),
}));

afterEach(() => {
  cleanup();
  fetchEngineClassTypes.mockReset();
  sidecarJson.mockReset();
});

function effectItems(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-comfy-effect-item]"));
}

function effectItem(classType: string): HTMLElement {
  const found = effectItems().find((item) => item.getAttribute("data-comfy-effect-item") === classType);
  if (!found) throw new Error(`找不到效果条目 ${classType}`);
  return found;
}

function searchBox(): HTMLElement {
  const box = document.querySelector<HTMLElement>("[data-comfy-effect-search]");
  if (!box) throw new Error("找不到搜索框");
  return box;
}

function renderDialog(onPick = vi.fn()) {
  return render(
    <ComfyEffectNodesDialog
      open
      onOpenChange={() => undefined}
      onPick={onPick}
    />,
  );
}

describe("ComfyEffectNodesDialog(效果节点放置弹窗,09-08 三期收官)", () => {
  it("搜索过滤策展包;选中策展条目即落卡(带 descriptor)", () => {
    fetchEngineClassTypes.mockResolvedValue([]); // 引擎清单空:仅策展层
    const onPick = vi.fn();
    renderDialog(onPick);
    fireEvent.change(searchBox(), { target: { value: "模糊" } });
    expect(effectItems().length).toBe(1);
    fireEvent.click(effectItem("ImageBlur"));
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ classType: "ImageBlur", title: "模糊" }),
    );
  });

  it("全量清单常开(09-09 开关退役):拉取引擎清单,选中全量条目按需取单类 schema 落卡", async () => {
    fetchEngineClassTypes.mockResolvedValue(["ImageBlur", "LayerMask: BlendAdvanced", "VAEDecode"]);
    sidecarJson.mockResolvedValue({
      detail: { input: { image: [["IMAGE"]] }, output: ["IMAGE"], name: "VAEDecode" },
    });
    const onPick = vi.fn();
    renderDialog(onPick);
    await waitFor(() => {
      expect(effectItem("VAEDecode")).toBeTruthy();
    });
    // 策展不重复(ImageBlur 只出现一次)
    expect(
      effectItems().filter((item) => item.getAttribute("data-comfy-effect-item") === "ImageBlur").length,
    ).toBe(1);
    fireEvent.click(effectItem("VAEDecode"));
    await waitFor(() => {
      expect(sidecarJson).toHaveBeenCalledWith("GET", "/comfy/engine/object-info", {
        query: { class: "VAEDecode" },
        timeoutMs: 30_000,
      });
    });
    await waitFor(() => {
      expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ classType: "VAEDecode" }));
    });
  });

  it("高级清单拉取失败:大白话错误在弹窗内呈现(策展仍可用)", async () => {
    fetchEngineClassTypes.mockRejectedValue(new Error("本地生图服务未运行"));
    renderDialog();
    await waitFor(() => {
      const error = document.querySelector<HTMLElement>("[data-comfy-effect-advanced-error]");
      expect(error?.textContent).toContain("本地生图服务未运行");
    });
    expect(effectItem("ImageBlur")).toBeTruthy();
  });

  it("全量条目详情缺失(插件卸载):大白话,不落卡", async () => {
    fetchEngineClassTypes.mockResolvedValue(["GoneNode"]);
    sidecarJson.mockResolvedValue({ detail: null, error: null });
    const onPick = vi.fn();
    renderDialog(onPick);
    await waitFor(() => {
      expect(effectItem("GoneNode")).toBeTruthy();
    });
    fireEvent.click(effectItem("GoneNode"));
    await waitFor(() => {
      const error = document.querySelector<HTMLElement>("[data-comfy-effect-advanced-error]");
      expect(error?.textContent).toContain("GoneNode");
    });
    expect(onPick).not.toHaveBeenCalled();
  });
});
