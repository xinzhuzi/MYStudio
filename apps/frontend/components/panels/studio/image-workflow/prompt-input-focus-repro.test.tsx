// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useProjectStore } from "@/stores/project/project-store";
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import {
  addGeneratedImageNode,
  addPromptImageNode,
  connectImageWorkflowNodes,
  createImageWorkflowGraph,
} from "@/lib/studio/image-workflow/graph-build";
import { ImageWorkflowCanvas } from "./ImageWorkflowCanvas";

/**
 * 焦点回归(用户报:提示词输入框敲一键即失焦):
 * 聚焦提示词 textarea → 输入一字符 → 断言焦点仍在输入框内。
 */

vi.mock("@xyflow/react", async () => {
  const actual = await vi.importActual<typeof import("@xyflow/react")>("@xyflow/react");
  return { ...actual };
});
vi.mock("@/stores/studio/use-studio-workflow-hydrated", () => ({
  useStudioWorkflowHydrated: () => true,
}));

(globalThis as any).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
(globalThis as any).matchMedia ??= () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});
(globalThis as any).DOMMatrixReadOnly ??= class DOMMatrixReadOnly {
  m22 = 1;
};
Object.defineProperties(globalThis.HTMLElement.prototype, {
  offsetHeight: { configurable: true, get() { return 100; } },
  offsetWidth: { configurable: true, get() { return 300; } },
});
(globalThis as any).SVGElement.prototype.getBBox ??= () => ({ x: 0, y: 0, width: 0, height: 0 });

const initialStudioState = useStudioStore.getState();
const initialProjectState = useProjectStore.getState();
const initialCharacterState = useCharacterLibraryStore.getState();

afterEach(() => {
  cleanup();
  useStudioStore.setState(initialStudioState, true);
  useProjectStore.setState(initialProjectState, true);
  useCharacterLibraryStore.setState(initialCharacterState, true);
  delete (window as any).projectFiles;
  delete (window as any).studioAssets;
});

function mount() {
  let graph = createImageWorkflowGraph({ name: "焦点回归流" });
  graph = addPromptImageNode(graph, { id: "prompt-1", position: { x: 80, y: 0 } });
  graph = addGeneratedImageNode(graph, { id: "gen-1", position: { x: 760, y: 0 } });
  graph = connectImageWorkflowNodes(graph, { source: "prompt-1", target: "gen-1" });
  useProjectStore.setState({ activeProjectId: "dao-project" });
  useStudioStore.setState(
    { ...initialStudioState, imageWorkflows: [graph], materials: [], storyboards: [] },
    true,
  );
  render(
    <ImageWorkflowCanvas
      projectName="道劫"
      initialAssetContext={{ target: { kind: "free" }, title: "焦点回归流", imageWorkflowId: graph.id }}
    />,
  );
}

describe("提示词输入焦点", () => {
  it("输入一字符后焦点仍在 textarea(失焦回归)", async () => {
    mount();
    const textarea = await waitFor(
      () => screen.getByPlaceholderText("描述要生成的图片") as HTMLTextAreaElement,
      { timeout: 4000 },
    );
    textarea.focus();
    expect(document.activeElement).toBe(textarea);

    fireEvent.keyDown(textarea, { key: "a" });
    fireEvent.input(textarea, { target: { value: "甲" } });
    await new Promise((r) => setTimeout(r, 350));

    const stillFocused = document.activeElement === textarea;
    const stillInDoc = document.body.contains(textarea);
    // 失焦或被移出 DOM 都算「自动退出输入框」
    expect({ stillFocused, stillInDoc }).toEqual({ stillFocused: true, stillInDoc: true });
  });
});
