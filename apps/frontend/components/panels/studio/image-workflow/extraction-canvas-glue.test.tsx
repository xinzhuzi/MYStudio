// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useProjectStore } from "@/stores/project/project-store";
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import {
  addGeneratedImageNode,
  createImageWorkflowGraph,
  setGeneratedImageResult,
} from "@/lib/studio/image-workflow/graph-build";
import { ImageWorkflowCanvas } from "./ImageWorkflowCanvas";

/**
 * 取材胶水层集成测(09-01 深审补层):此前对话框/落图各有测试,但
 * 「节点卡入口 → 画布对话框 → 确认 → 落图」的胶水只有实弹覆盖。
 * 本套件 mock 像素编解码与落盘桥,钉死胶水语义(实弹曾在此层静默失败)。
 */

vi.mock("@xyflow/react", async () => {
  const actual = await vi.importActual<typeof import("@xyflow/react")>("@xyflow/react");
  return { ...actual };
});
vi.mock("@/stores/studio/use-studio-workflow-hydrated", () => ({
  useStudioWorkflowHydrated: () => true,
}));
// 像素编解码替身:固定 4x4 红图,避开 jsdom canvas
vi.mock("@/lib/studio/image-workflow/extraction-pixels", async () => {
  const actual = await vi.importActual<typeof import("@/lib/studio/image-workflow/extraction-pixels")>(
    "@/lib/studio/image-workflow/extraction-pixels",
  );
  return {
    ...actual,
    createBrowserCanvasCodec: () => ({
      decode: async () => ({ width: 4, height: 4, data: new Uint8ClampedArray(64).fill(255) }),
      encode: () => "data:image/png;base64,QUJD",
    }),
  };
});

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
  m22: number;
  constructor(transform?: string) {
    const scale = transform?.match(/scale\(([1-9.\d]+)\)/)?.[1];
    this.m22 = scale !== undefined ? +scale : 1;
  }
};
// jsdom 无 layout,React Flow 元素测量兜底
Object.defineProperties(globalThis.HTMLElement.prototype, {
  offsetHeight: { configurable: true, get() { return 100; } },
  offsetWidth: { configurable: true, get() { return 300; } },
});
(globalThis as any).SVGElement.prototype.getBBox ??= () => ({ x: 0, y: 0, width: 0, height: 0 });

const initialStudioState = useStudioStore.getState();
const initialProjectState = useProjectStore.getState();
const initialCharacterState = useCharacterLibraryStore.getState();

beforeEach(() => {
  (window as any).projectFiles = {
    writeBinary: async ({ relativePath, bytes }: { relativePath: string; bytes: ArrayBuffer }) => ({
      success: true,
      url: `project-file://mock/${relativePath}`,
      size: bytes.byteLength,
    }),
  };
});
afterEach(() => {
  cleanup();
  useStudioStore.setState(initialStudioState, true);
  useProjectStore.setState(initialProjectState, true);
  useCharacterLibraryStore.setState(initialCharacterState, true);
  delete (window as any).projectFiles;
  delete (window as any).studioAssets;
});

function seedWithGeneratedImage() {
  let graph = createImageWorkflowGraph({ name: "取材胶水测试流" });
  graph = addGeneratedImageNode(graph, {
    id: "gen-1",
    title: "种子成图",
    position: { x: 760, y: 0 },
  });
  // resultUrl 有图才出现取材按钮
  graph = setGeneratedImageResult(graph, "gen-1", {
    imageUrl: "project-file://mock/source.png",
  });
  useProjectStore.setState({ activeProjectId: "dao-project" });
  useStudioStore.setState(
    {
      ...initialStudioState,
      imageWorkflows: [graph],
      materials: [],
      storyboards: [],
    },
    true,
  );
  return render(
    <ImageWorkflowCanvas
      projectName="道劫"
      initialAssetContext={{
        target: { kind: "free" },
        title: "取材胶水测试流",
        imageWorkflowId: graph.id,
      }}
    />,
  );
}

function activeGraph() {
  const state = useStudioStore.getState();
  return state.imageWorkflows[0];
}

describe("取材胶水层:入口→对话框→确认→落图", () => {
  it("裁剪:节点卡按钮 → 对话框 → 确认 → 血缘参考节点落库", async () => {
    seedWithGeneratedImage();

    const cropButton = await waitFor(() => screen.getByRole("button", { name: "裁剪取材" }));
    fireEvent.click(cropButton);

    const confirm = await waitFor(() =>
      screen.getByRole("button", { name: /确认裁剪/ }),
    );
    fireEvent.click(confirm);

    await waitFor(
      () => {
        const landed = activeGraph().nodes.find(
          (node): node is Extract<typeof node, { type: "reference" }> =>
            node.type === "reference" && node.derivedFrom?.kind === "crop",
        );
        expect(landed).toBeTruthy();
        expect(landed!.title).toContain("裁剪");
        expect(landed!.derivedFrom!.region).toBeTruthy();
      },
      { timeout: 4000 },
    );
  });

  it("切图:确认 2x2 → 四张血缘参考节点落库", async () => {
    seedWithGeneratedImage();

    fireEvent.click(await waitFor(() => screen.getByRole("button", { name: "切图取材" })));
    const confirm = await waitFor(() => screen.getByRole("button", { name: /确认切图/ }));
    fireEvent.click(confirm);

    await waitFor(
      () => {
        const refs = activeGraph().nodes.filter(
          (node): node is Extract<typeof node, { type: "reference" }> =>
            node.type === "reference" && node.derivedFrom?.kind === "split",
        );
        expect(refs).toHaveLength(4);
        expect(refs[0].derivedFrom!.cell).toEqual({ row: 0, col: 0 });
      },
      { timeout: 4000 },
    );
  });
});
