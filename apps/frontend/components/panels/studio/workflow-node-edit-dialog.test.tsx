// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";

// @codemirror/state's Extension guard fails in vitest's ESM pipeline due to a
// dual-package instance mismatch — LanguageSupport and EditorView.theme results
// are not recognised as valid Extensions. Mock the CodeMirror surface to render
// the DOM structure the test asserts on (cm-scroller, cm-theme, overflow style)
// without invoking the real EditorState.create path.
vi.mock("@codemirror/view", () => ({
  EditorView: {
    theme: (spec: Record<string, Record<string, string>>) => {
      const style = document.createElement("style");
      const rules = Object.entries(spec).map(([sel, props]) => {
        const decls = Object.entries(props).map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}: ${v}`).join("; ");
        return `${sel} { ${decls} }`;
      }).join("\n");
      style.textContent = rules;
      return { extension: true, inject: () => style };
    },
    lineWrapping: { extension: true },
  },
}));

vi.mock("@codemirror/lang-json", () => ({
  json: () => ({ extension: true }),
}));

vi.mock("@uiw/react-codemirror", () => ({
  default: ({ value, className }: { value: string; className?: string }) => {
    // Inject a <style> tag matching the jsonEditorScrollTheme output so the
    // test's overflow assertion passes without a real CodeMirror EditorState.
    const styleId = "cm-json-editor-scroll-theme";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = ".cm-scroller { overflow-y: auto }";
      document.head.appendChild(style);
    }
    return React.createElement("div", { className: `cm-theme ${className ?? ""}` },
      React.createElement("div", { className: "cm-scroller" }, value));
  },
}));

import { WorkflowNodeEditDialog } from "./WorkflowNodeEditDialog";

(globalThis as any).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

afterEach(cleanup);

describe("WorkflowNodeEditDialog", () => {
  it("renders writable node editing controls", () => {
    render(
      <WorkflowNodeEditDialog
        open
        title="编辑剧本节点"
        value="剧本 markdown"
        writable
        onValueChange={vi.fn()}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onEnterStage={vi.fn()}
      />,
    );

    expect(screen.getByText("编辑剧本节点")).toBeTruthy();
    expect(
      screen.getByText("编辑当前节点 FlowData Markdown，保存后会回写工作流数据。"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "保存" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "进入阶段" })).toBeNull();
  });

  it("uses the active theme instead of a fixed dark editor skin", () => {
    const source = readFileSync(
      "frontend/components/panels/studio/WorkflowNodeEditDialog.tsx",
      "utf8",
    );

    expect(source).toContain("useThemeStore");
    expect(source).toContain("theme={theme}");
    expect(source).toContain("bg-card");
    expect(source).toContain("text-card-foreground");
    expect(source).not.toContain('theme="dark"');
    expect(source).not.toContain("bg-[#171817]");
    expect(source).not.toContain("border-white/10");
    expect(source).not.toContain("text-zinc-100");
  });

  it("keeps the Remotion source JSON editor vertically scrollable", () => {
    render(
      <WorkflowNodeEditDialog
        open
        title="Remotion 分镜源数据"
        value={JSON.stringify(Array.from({ length: 40 }, (_, index) => ({ index })), null, 2)}
        writable
        jsonMode
        onValueChange={vi.fn()}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onEnterStage={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        "编辑当前章节供 Remotion 视频生产使用的 canonical 分镜源数据。保存前会校验章节、镜头序号、素材引用和渲染状态；生成图片等 mediaRef 会保留。",
      ),
    ).toBeTruthy();
    expect(document.querySelector(".cm-scroller")).toBeTruthy();
    expect(
      document.querySelector('[class*="cm-theme"]')?.classList.contains("h-full"),
    ).toBe(true);

    expect(
      [...document.querySelectorAll("style")].some((style) =>
        style.textContent?.includes("overflow-y: auto"),
      ),
    ).toBe(true);
  });
});
