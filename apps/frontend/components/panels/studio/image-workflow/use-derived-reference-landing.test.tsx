// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStudioStore } from "@/stores/studio/studio-store";
import {
  addGeneratedImageNode,
  addPromptImageNode,
  createImageWorkflowGraph,
} from "@/lib/studio/image-workflow/graph-build";
import { useDerivedReferenceLanding } from "./use-derived-reference-landing";

/** 取材落图通道集成测:window.projectFiles 桥 mock + 实 store 断言 */

const initialStudioState = useStudioStore.getState();

afterEach(() => {
  useStudioStore.setState(initialStudioState, true);
  delete (window as any).projectFiles;
  vi.restoreAllMocks();
});

function mockBridge() {
  const writes: Array<{ relativePath: string; bytes: number }> = [];
  (window as any).projectFiles = {
    writeBinary: async ({ relativePath, bytes }: { relativePath: string; bytes: ArrayBuffer }) => {
      writes.push({ relativePath, bytes: bytes.byteLength });
      return { success: true, url: `project-file://mock/${relativePath}`, size: bytes.byteLength };
    },
  };
  return writes;
}

function seededStore() {
  let graph = createImageWorkflowGraph({ name: "取材测试流" });
  graph = addGeneratedImageNode(graph, { id: "gen-seed", title: "种子成图", position: { x: 760, y: 0 } });
  useStudioStore.setState(
    {
      ...initialStudioState,
      imageWorkflows: [graph],
      materials: [],
      storyboards: [],
    },
    true,
  );
  const state = useStudioStore.getState();
  return state.imageWorkflows[0];
}

function activeGraph() {
  const state = useStudioStore.getState();
  return state.imageWorkflows[0];
}

describe("useDerivedReferenceLanding", () => {
  it("单产物:落盘→material→血缘参考节点(邻位列)→单次 saveGraph", async () => {
    const graph = seededStore();
    const writes = mockBridge();
    const savedGraphs: unknown[] = [];
    const { result } = renderHook(() =>
      useDerivedReferenceLanding({
        activeGraph: graph,
        saveGraph: (g) => {
          savedGraphs.push(g);
          const state = useStudioStore.getState();
          useStudioStore.setState({
            imageWorkflows: state.imageWorkflows.map((w) => (w.id === g.id ? g : w)),
          });
        },
        storyboards: [],
        addMaterial: () => "mat-1",
        setSelectedNodeId: () => {},
      }),
    );

    let outcomes: Array<{ nodeId: string } | { error: string }> = [];
    await act(async () => {
      outcomes = await result.current([
        {
          sourceNodeId: "gen-seed",
          pixels: { dataUrl: "data:image/png;base64,AAAA", width: 10, height: 10 },
          title: "测试·裁剪",
          derivation: { kind: "crop", sourceNodeId: "gen-seed", region: { x: 0, y: 0, width: 0.5, height: 0.5 } },
        },
      ]);
    });

    expect(outcomes).toHaveLength(1);
    expect("nodeId" in outcomes[0]).toBe(true);
    expect(savedGraphs).toHaveLength(1); // 单次 saveGraph=单条撤销历史
    expect(writes).toHaveLength(1); // 单次落盘
    const landed = activeGraph().nodes.find(
      (node) => "nodeId" in outcomes[0] && node.id === (outcomes[0] as { nodeId: string }).nodeId,
    );
    expect(landed?.type).toBe("reference");
    expect(landed && landed.type === "reference" ? landed.derivedFrom?.kind : null).toBe("crop");
    expect(landed && landed.type === "reference" ? landed.derivedFrom?.region : null)
      .toEqual({ x: 0, y: 0, width: 0.5, height: 0.5 });
    // 邻位列落位:源节点右侧
    const source = activeGraph().nodes.find((n) => n.id === "gen-seed")!;
    expect(landed!.position.x).toBeGreaterThan(source.position.x);
  });

  it("多产物(split):N 次落盘但一次 saveGraph;扇形纵排;可选连线", async () => {
    let graph = seededStore();
    graph = addPromptImageNode(graph, { id: "prompt-1", position: { x: 80, y: 0 } });
    graph = addGeneratedImageNode(graph, { id: "gen-1", position: { x: 760, y: 0 } });
    useStudioStore.setState({ ...useStudioStore.getState(), imageWorkflows: [graph] });
    const writes = mockBridge();
    const savedGraphs: unknown[] = [];
    const { result } = renderHook(() =>
      useDerivedReferenceLanding({
        activeGraph: graph,
        saveGraph: (g) => {
          savedGraphs.push(g);
          const state = useStudioStore.getState();
          useStudioStore.setState({
            imageWorkflows: state.imageWorkflows.map((w) => (w.id === g.id ? g : w)),
          });
        },
        storyboards: [],
        addMaterial: () => "mat-x",
        setSelectedNodeId: () => {},
      }),
    );

    const PIXELS = { dataUrl: "data:image/png;base64,AAAA", width: 5, height: 5 };
    await act(async () => {
      await result.current([
        { sourceNodeId: "gen-1", pixels: PIXELS, title: "格 1-1", derivation: { kind: "split", sourceNodeId: "gen-1", cell: { row: 0, col: 0 } }, connectToGeneratedId: "gen-1" },
        { sourceNodeId: "gen-1", pixels: PIXELS, title: "格 1-2", derivation: { kind: "split", sourceNodeId: "gen-1", cell: { row: 0, col: 1 } }, connectToGeneratedId: "gen-1" },
        { sourceNodeId: "gen-1", pixels: PIXELS, title: "格 2-1", derivation: { kind: "split", sourceNodeId: "gen-1", cell: { row: 1, col: 0 } }, connectToGeneratedId: "gen-1" },
      ]);
    });

    expect(writes).toHaveLength(3);
    expect(savedGraphs).toHaveLength(1); // 三产物一条历史
    const refs = activeGraph().nodes.filter((n) => n.type === "reference");
    expect(refs).toHaveLength(3);
    // 全部连到成图
    expect(activeGraph().edges.filter((e) => e.target === "gen-1")).toHaveLength(3);
    // 扇形纵排
    const ys = refs.map((r) => r.position.y);
    expect(ys[1]).toBeGreaterThan(ys[0]);
    expect(ys[2]).toBeGreaterThan(ys[1]);
  });

  it("落盘失败:整批失败,零节点落地", async () => {
    const graph = seededStore();
    (window as any).projectFiles = {
      writeBinary: async () => ({ success: false, error: "磁盘满" }),
    };
    const savedGraphs: unknown[] = [];
    const { result } = renderHook(() =>
      useDerivedReferenceLanding({
        activeGraph: graph,
        saveGraph: (g) => savedGraphs.push(g),
        storyboards: [],
        addMaterial: () => "mat",
        setSelectedNodeId: () => {},
      }),
    );

    let outcomes: Array<{ nodeId: string } | { error: string }> = [];
    await act(async () => {
      outcomes = await result.current([
        { sourceNodeId: "gen-seed", pixels: { dataUrl: "data:image/png;base64,AAAA", width: 5, height: 5 }, title: "x", derivation: { kind: "crop", sourceNodeId: "gen-seed" } },
        { sourceNodeId: "gen-seed", pixels: { dataUrl: "data:image/png;base64,AAAA", width: 5, height: 5 }, title: "y", derivation: { kind: "crop", sourceNodeId: "gen-seed" } },
      ]);
    });

    expect(outcomes.every((o) => "error" in o)).toBe(true);
    expect(savedGraphs).toHaveLength(0); // 零 saveGraph
    expect(activeGraph().nodes.filter((n) => n.type === "reference")).toHaveLength(0);
  });
});
