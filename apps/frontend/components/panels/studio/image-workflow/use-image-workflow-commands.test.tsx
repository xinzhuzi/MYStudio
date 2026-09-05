// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useProjectStore } from "@/stores/project/project-store";
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import {
  __resetCanvasCommandBusForTests,
  dispatchCanvasCommand,
} from "@/lib/studio/canvas-commands";
import {
  addGeneratedImageNode,
  addPromptImageNode,
  addReferenceImageNode,
  connectImageWorkflowNodes,
  createImageWorkflowGraph,
} from "@/lib/studio/image-workflow/graph-build";
import { ImageWorkflowCanvas } from "./ImageWorkflowCanvas";

/**
 * 08-31-canvas-ops-layer R4:指令通道集成实证——真实 store + 挂载画布,
 * 经 dispatchCanvasCommand 发指令、断言 store 状态(替代 CDP 摸 DOM)。
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

const initialStudioState = useStudioStore.getState();
const initialProjectState = useProjectStore.getState();
const initialCharacterState = useCharacterLibraryStore.getState();

function seededGraph() {
  let graph = createImageWorkflowGraph({ name: "指令通道测试流" });
  graph = addPromptImageNode(graph, {
    id: "prompt-1",
    position: { x: 80, y: 0 },
  });
  graph = addGeneratedImageNode(graph, { id: "gen-1", position: { x: 760, y: 0 } });
  graph = connectImageWorkflowNodes(graph, { source: "prompt-1", target: "gen-1" });
  // 参考图边:联动愈合只管 prompt↔成图 配对,此边断开后不会被自动接回
  graph = addReferenceImageNode(graph, { id: "ref-1", position: { x: 80, y: 300 }, imageUrl: "" });
  graph = connectImageWorkflowNodes(graph, { source: "ref-1", target: "gen-1" });
  return graph;
}

function mountCanvas(graph: ReturnType<typeof seededGraph>) {
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
  // 域隔离(08-30 默认分镜域):经资产上下文直进指定流,绕开分镜域择流
  return render(
    <ImageWorkflowCanvas
      projectName="道劫"
      initialAssetContext={{
        target: { kind: "free" },
        title: "指令通道测试流",
        imageWorkflowId: graph.id,
      }}
    />,
  );
}

function dispatch(command: Parameters<typeof dispatchCanvasCommand>[1]) {
  let result!: ReturnType<typeof dispatchCanvasCommand>;
  act(() => {
    result = dispatchCanvasCommand("image-workflow", command);
  });
  return result;
}

afterEach(() => {
  cleanup();
  __resetCanvasCommandBusForTests();
  useStudioStore.setState(initialStudioState, true);
  useProjectStore.setState(initialProjectState, true);
  useCharacterLibraryStore.setState(initialCharacterState, true);
});

function activeGraph() {
  // 测试流为 store 内唯一工作流
  return useStudioStore.getState().imageWorkflows[0];
}

describe("image-workflow 指令通道(集成)", () => {
  it("add-node:建提示词下有成图并自动连线,断言 store 状态", async () => {
    mountCanvas(seededGraph());
    await act(async () => {});

    const result = dispatch({
      kind: "add-node",
      surface: "image-workflow",
      nodeType: "generated",
      connectFrom: { nodeId: "prompt-1", handleType: "source" },
    });

    expect(result.ok).toBe(true);
    const graph = activeGraph();
    expect(graph.nodes.some((node) => node.id === (result as { detail?: { nodeId?: string } }).detail?.nodeId)).toBe(true);
    expect(
      graph.edges.some(
        (edge) =>
          edge.source === "prompt-1" &&
          edge.target === (result as { detail?: { nodeId?: string } }).detail?.nodeId,
      ),
    ).toBe(true);
  });

  it("disconnect/remove-node/update-node 与幂等拒绝", async () => {
    mountCanvas(seededGraph());
    // 让 scoped lifecycle 的建流/治愈回写先落定,再发指令
    await act(async () => {});

    expect(
      dispatch({
        kind: "disconnect",
        surface: "image-workflow",
        edgeId: "ref-1->gen-1",
      }).ok,
    ).toBe(true);
    expect(activeGraph().edges.some((edge) => edge.id === "ref-1->gen-1")).toBe(false);

    expect(
      dispatch({
        kind: "update-node",
        surface: "image-workflow",
        nodeId: "gen-1",
        patch: { title: "改名成图" },
      }).ok,
    ).toBe(true);
    expect(
      activeGraph().nodes.find((node) => node.id === "gen-1")?.title,
    ).toBe("改名成图");

    // prompt 透传(09-03 二期):patch.prompt 显式落节点,不被共享契约扩容忽略
    expect(
      dispatch({
        kind: "update-node",
        surface: "image-workflow",
        nodeId: "prompt-1",
        patch: { prompt: "水墨山门,晨雾" },
      }).ok,
    ).toBe(true);
    expect(
      (
        activeGraph().nodes.find((node) => node.id === "prompt-1") as
          | { prompt?: string }
          | undefined
      )?.prompt,
    ).toBe("水墨山门,晨雾");

    // 幂等拒绝:重复 disconnect 已不存在的边
    const repeat = dispatch({
      kind: "disconnect",
      surface: "image-workflow",
      edgeId: "ref-1->gen-1",
    });
    expect(repeat.ok).toBe(false);

    expect(
      dispatch({
        kind: "remove-node",
        surface: "image-workflow",
        nodeId: "gen-1",
      }).ok,
    ).toBe(true);
    expect(activeGraph().nodes.some((node) => node.id === "gen-1")).toBe(false);
  });

  it("connect 域规则:目标非成图显式失败;未注册类型拒绝", async () => {
    mountCanvas(seededGraph());
    await act(async () => {});

    const badTarget = dispatch({
      kind: "connect",
      surface: "image-workflow",
      source: "gen-1",
      target: "prompt-1",
    });
    expect(badTarget.ok).toBe(false);
    if (!badTarget.ok) expect(badTarget.reason).toContain("成图");

    const badType = dispatch({
      kind: "add-node",
      surface: "image-workflow",
      nodeType: "nope",
    });
    expect(badType.ok).toBe(false);
  });
});

describe("image-workflow 指令通道:无衣物(09-04 通用化)", () => {
  it("add-node uncloth(无连线):建出 uncloth 节点而非误建参考图(fall-through 根修)", async () => {
    mountCanvas(seededGraph());
    await act(async () => {});

    const result = dispatch({
      kind: "add-node",
      surface: "image-workflow",
      nodeType: "uncloth",
    });

    expect(result.ok).toBe(true);
    const nodeId = (result as { detail?: { nodeId?: string } }).detail?.nodeId;
    const graph = activeGraph();
    const created = graph.nodes.find((node) => node.id === nodeId);
    expect(created?.type).toBe("uncloth");
    expect(graph.nodes.filter((node) => node.type === "reference")).toHaveLength(1);
  });

  it("add-node uncloth + connectFrom(参考图源):建节点并自动连边", async () => {
    mountCanvas(seededGraph());
    await act(async () => {});

    const result = dispatch({
      kind: "add-node",
      surface: "image-workflow",
      nodeType: "uncloth",
      connectFrom: { nodeId: "ref-1", handleType: "source" },
    });

    expect(result.ok).toBe(true);
    const nodeId = (result as { detail?: { nodeId?: string } }).detail?.nodeId;
    const graph = activeGraph();
    expect(graph.nodes.find((node) => node.id === nodeId)?.type).toBe("uncloth");
    expect(graph.edges.some((edge) => edge.source === "ref-1" && edge.target === nodeId)).toBe(true);
  });
});
