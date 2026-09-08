// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComfyWorkflowDeleteDialog } from "./comfy-workflow-delete-dialog";

/** 本仓库测试锚点约定:data-comfy-*(无值布尔属性,渲染为 ="true") */
function comfyElement(selector: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`missing ${selector}`);
  return el;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderDialog(overrides?: {
  scan?: { references: { kind: string; name: string }[] } | null;
  deleting?: boolean;
}) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <ComfyWorkflowDeleteDialog
      open
      workflowName="Krea2-NSFW专业流"
      scan={overrides?.scan === undefined ? { references: [{ kind: "画布", name: "画布 1" }, { kind: "工作流节点", name: "成图 3" }] } : overrides.scan}
      deleting={overrides?.deleting ?? false}
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
    />,
  );
  return { onConfirm, onOpenChange };
}

describe("ComfyWorkflowDeleteDialog(删除保护,grill Q11)", () => {
  it("引用清单警告:「X 处引用」+引用来源列表", () => {
    renderDialog();
    expect(screen.getByText("2 处引用")).toBeTruthy();
    const list = comfyElement("[data-comfy-delete-references]");
    expect(list.textContent).toContain("画布:画布 1");
    expect(list.textContent).toContain("工作流节点:成图 3");
  });

  it("二次确认:第一次点击只亮出确认按钮,再点才执行", () => {
    const { onConfirm } = renderDialog();
    fireEvent.click(comfyElement("[data-comfy-delete-arm]"));
    expect(onConfirm).not.toHaveBeenCalled();
    const confirm = comfyElement("[data-comfy-delete-confirm]");
    expect(confirm).toBeTruthy();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("扫描中(null):显示扫描文案且删除不可用;零引用也能删(仍二次确认)", () => {
    renderDialog({ scan: null });
    expect(screen.getByText("正在扫描引用…")).toBeTruthy();
    expect((comfyElement("[data-comfy-delete-arm]") as HTMLButtonElement).disabled).toBe(true);

    cleanup();
    const zero = renderDialog({ scan: { references: [] } });
    expect(screen.getByText("0 处引用")).toBeTruthy();
    expect(screen.getByText("没有画布或节点在用它")).toBeTruthy();
    fireEvent.click(comfyElement("[data-comfy-delete-arm]"));
    fireEvent.click(comfyElement("[data-comfy-delete-confirm]"));
    expect(zero.onConfirm).toHaveBeenCalledTimes(1);
  });

  it("删除中:确认按钮禁用防双击", () => {
    renderDialog({ deleting: true });
    // 删除中处于已亮出确认键的阶段(armed),按钮禁用防双击
    fireEvent.click(comfyElement("[data-comfy-delete-arm]"));
    expect((comfyElement("[data-comfy-delete-confirm]") as HTMLButtonElement).disabled).toBe(true);
  });
});
