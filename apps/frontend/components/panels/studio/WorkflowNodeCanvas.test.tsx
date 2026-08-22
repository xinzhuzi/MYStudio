// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowNodeCanvas } from "./WorkflowNodeCanvas";
import * as WorkflowProductionNodeModule from "./WorkflowProductionNode";
import * as React from "react";
import * as XYFlow from "@xyflow/react";
import { Position } from "@xyflow/react";
import {
  PRODUCTION_FLOW_NODE_IDS,
  type ProductionFlowNodeModel,
  type ProductionFlowStage,
} from "./workflow-node-model";

const reactFlowMock = vi.hoisted(() => ({
  fitView: vi.fn((_options?: unknown) => Promise.resolve(true)),
  getInternalNode: vi.fn((id: string) => ({
    id,
    measured: { width: 640, height: 480 },
  })),
  updateNodeInternals: vi.fn(),
  zoomIn: vi.fn(() => Promise.resolve(true)),
  zoomOut: vi.fn(() => Promise.resolve(true)),
  nodesInitialized: true,
  order: [] as string[],
  latestNodes: [] as Array<Record<string, unknown>>,
  onNodesChange: undefined as undefined | ((changes: unknown[]) => void),
}));

vi.mock("@xyflow/react", async () => {
  const React = await import("react");
  const actual = await vi.importActual<typeof import("@xyflow/react")>(
    "@xyflow/react",
  );
  const flowInstance = {
    fitView: (options?: unknown) => {
      reactFlowMock.order.push("fitView");
      return reactFlowMock.fitView(options);
    },
    getInternalNode: reactFlowMock.getInternalNode,
    viewportInitialized: true,
  };

  return {
    ...actual,
    Panel: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    ReactFlow: ({
      children,
      onInit,
      nodes,
      onNodesChange,
    }: {
      children?: ReactNode;
      onInit?: (instance: typeof flowInstance) => void;
      nodes?: Array<Record<string, unknown>>;
      onNodesChange?: (changes: unknown[]) => void;
    }) => {
      reactFlowMock.latestNodes = nodes ?? [];
      reactFlowMock.onNodesChange = onNodesChange;
      React.useEffect(() => {
        onInit?.(flowInstance);
      }, [onInit]);
      return <div>{children}</div>;
    },
    useNodesState: <T,>(initialNodes: T[]) => {
      const [nodes, setNodes] = React.useState(initialNodes);
      const applyChanges = React.useCallback((changes: unknown[]) => {
        setNodes((currentNodes) => actual.applyNodeChanges(
          changes as never,
          currentNodes as never,
        ) as T[]);
      }, []);
      return [nodes, setNodes, applyChanges] as const;
    },
    useNodesInitialized: () => reactFlowMock.nodesInitialized,
    useOnViewportChange: vi.fn(),
    useReactFlow: () => ({
      zoomIn: reactFlowMock.zoomIn,
      zoomOut: reactFlowMock.zoomOut,
    }),
    useUpdateNodeInternals: () => React.useCallback((nodeIds: string | string[]) => {
      reactFlowMock.order.push("updateNodeInternals");
      reactFlowMock.updateNodeInternals(nodeIds);
    }, []),
  };
});

const stageByNodeId: Record<(typeof PRODUCTION_FLOW_NODE_IDS)[number], ProductionFlowStage> = {
  script: "script",
  scriptPlan: "storyboard",
  assets: "assets",
  storyboardTable: "storyboard",
  storyboard: "storyboard",
  remotionProduction: "workbench",
  workbench: "workbench",
};

const nodes = PRODUCTION_FLOW_NODE_IDS.map((id) => ({
  id,
  label: id,
  description: id,
  status: "ready",
  metrics: [],
  previewTitle: id,
  previewLines: [],
  targetStage: stageByNodeId[id],
})) satisfies ProductionFlowNodeModel[];

let animationFrames = new Map<number, FrameRequestCallback>();
let nextAnimationFrameId = 1;

function flushAnimationFrames(rounds = 1) {
  for (let round = 0; round < rounds; round += 1) {
    const pending = Array.from(animationFrames.entries());
    animationFrames = new Map();
    for (const [, callback] of pending) callback(performance.now());
  }
}

beforeEach(() => {
  animationFrames = new Map();
  nextAnimationFrameId = 1;
  reactFlowMock.fitView.mockClear();
  reactFlowMock.getInternalNode.mockClear();
  reactFlowMock.getInternalNode.mockImplementation((id: string) => ({
    id,
    measured: { width: 640, height: 480 },
  }));
  reactFlowMock.updateNodeInternals.mockClear();
  reactFlowMock.nodesInitialized = true;
  reactFlowMock.order.length = 0;
  reactFlowMock.latestNodes = [];
  reactFlowMock.onNodesChange = undefined;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = nextAnimationFrameId;
    nextAnimationFrameId += 1;
    animationFrames.set(id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    animationFrames.delete(id);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WorkflowNodeCanvas visibility lifecycle", () => {
  it("refreshes hidden-mounted node internals before the first visible fit", async () => {
    const view = render(
      <WorkflowNodeCanvas
        isVisible={false}
        projectName="道劫"
        nodes={nodes}
        onStageChange={vi.fn()}
      />,
    );

    await act(async () => undefined);
    expect(reactFlowMock.updateNodeInternals).not.toHaveBeenCalled();
    expect(reactFlowMock.fitView).not.toHaveBeenCalled();

    view.rerender(
      <WorkflowNodeCanvas
        isVisible
        projectName="道劫"
        nodes={nodes}
        onStageChange={vi.fn()}
      />,
    );

    await act(async () => {
      flushAnimationFrames(4);
    });

    expect(reactFlowMock.updateNodeInternals).toHaveBeenCalledWith(
      PRODUCTION_FLOW_NODE_IDS,
    );
    expect(reactFlowMock.fitView).toHaveBeenCalledTimes(1);
    expect(reactFlowMock.order).toEqual([
      "updateNodeInternals",
      "fitView",
    ]);
  });

  it("fits after visible internals refresh when the store initialization flag lags", async () => {
    reactFlowMock.nodesInitialized = false;

    render(
      <WorkflowNodeCanvas
        isVisible
        projectName="道劫"
        nodes={nodes}
        onStageChange={vi.fn()}
      />,
    );

    await act(async () => {
      flushAnimationFrames(4);
    });

    expect(reactFlowMock.updateNodeInternals).toHaveBeenCalledWith(
      PRODUCTION_FLOW_NODE_IDS,
    );
    expect(reactFlowMock.fitView).toHaveBeenCalledTimes(1);
  });

  it("restarts an unfinished visible measurement after a window resize", async () => {
    reactFlowMock.getInternalNode.mockImplementation((id: string) => ({
      id,
      measured: { width: 0, height: 0 },
    }));

    render(
      <WorkflowNodeCanvas
        isVisible
        projectName="道劫"
        nodes={nodes}
        onStageChange={vi.fn()}
      />,
    );

    await act(async () => {
      flushAnimationFrames(3);
    });
    expect(reactFlowMock.fitView).not.toHaveBeenCalled();

    reactFlowMock.getInternalNode.mockImplementation((id: string) => ({
      id,
      measured: { width: 640, height: 480 },
    }));
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
      flushAnimationFrames(3);
    });

    expect(reactFlowMock.fitView).toHaveBeenCalledTimes(1);
  });

  it("restarts layout when resize cancels the frame that was about to fit", async () => {
    render(
      <WorkflowNodeCanvas
        isVisible
        projectName="道劫"
        nodes={nodes}
        onStageChange={vi.fn()}
      />,
    );

    await act(async () => {
      flushAnimationFrames(2);
    });
    expect(reactFlowMock.fitView).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new Event("resize"));
      flushAnimationFrames(3);
    });

    expect(reactFlowMock.fitView).toHaveBeenCalledTimes(1);
  });

  it("recomputes the fitted layout when an initialized node changes dimensions", async () => {
    const view = render(
      <WorkflowNodeCanvas
        isVisible={false}
        projectName="道劫"
        nodes={nodes}
        onStageChange={vi.fn()}
      />,
    );

    const initialDimensions = PRODUCTION_FLOW_NODE_IDS.map((id) => ({
      id,
      type: "dimensions" as const,
      dimensions: { width: 640, height: 480 },
      resizing: false,
    }));
    await act(async () => {
      reactFlowMock.onNodesChange?.(initialDimensions);
    });
    view.rerender(
      <WorkflowNodeCanvas
        isVisible
        projectName="道劫"
        nodes={nodes}
        onStageChange={vi.fn()}
      />,
    );
    await act(async () => {
      flushAnimationFrames(4);
    });
    expect(reactFlowMock.fitView).toHaveBeenCalledTimes(1);

    await act(async () => {
      reactFlowMock.onNodesChange?.(initialDimensions);
      flushAnimationFrames(3);
    });
    expect(reactFlowMock.fitView).toHaveBeenCalledTimes(1);

    await act(async () => {
      reactFlowMock.onNodesChange?.([{
        id: "workbench",
        type: "dimensions",
        dimensions: { width: 720, height: 520 },
        resizing: false,
      }]);
      flushAnimationFrames(3);
    });

    expect(reactFlowMock.fitView).toHaveBeenCalledTimes(2);
  });

  it("waits for nonzero measured node dimensions before fitting visible nodes", async () => {
    reactFlowMock.getInternalNode.mockImplementation((id: string) => ({
      id,
      measured: { width: 0, height: 0 },
    }));
    render(
      <WorkflowNodeCanvas
        isVisible
        projectName="道劫"
        nodes={nodes}
        onStageChange={vi.fn()}
      />,
    );

    await act(async () => {
      flushAnimationFrames(4);
    });
    expect(reactFlowMock.fitView).not.toHaveBeenCalled();

    reactFlowMock.getInternalNode.mockImplementation((id: string) => ({
      id,
      measured: { width: 640, height: 480 },
    }));
    await act(async () => {
      reactFlowMock.onNodesChange?.([{
        id: "workbench",
        type: "dimensions",
        dimensions: { width: 640, height: 480 },
        resizing: false,
      }]);
      flushAnimationFrames(3);
    });

    expect(reactFlowMock.fitView).toHaveBeenCalledTimes(1);
  });

  it("preserves measured dimensions when refreshed workflow data replaces node payloads", async () => {
    const view = render(
      <WorkflowNodeCanvas
        isVisible
        projectName="道劫"
        nodes={nodes}
        onStageChange={vi.fn()}
      />,
    );

    await act(async () => undefined);
    await act(async () => {
      reactFlowMock.onNodesChange?.(
        PRODUCTION_FLOW_NODE_IDS.map((id) => ({
          id,
          type: "dimensions",
          dimensions: { width: 640, height: 480 },
          resizing: false,
        })),
      );
    });
    expect(reactFlowMock.latestNodes.every((node) => node.measured)).toBe(true);

    view.rerender(
      <WorkflowNodeCanvas
        isVisible
        projectName="道劫"
        nodes={nodes.map((node) => ({ ...node, metrics: [...node.metrics] }))}
        onStageChange={vi.fn()}
      />,
    );
    await act(async () => undefined);

    expect(reactFlowMock.latestNodes.every((node) => node.measured)).toBe(true);
  });

  it("uses measured heights for top-bottom layout instead of fixed overlapping offsets", async () => {
    const dimensions: Record<string, { width: number; height: number }> = {
      script: { width: 1040, height: 600 },
      assets: { width: 760, height: 750 },
      scriptPlan: { width: 680, height: 900 },
      storyboardTable: { width: 700, height: 700 },
      storyboard: { width: 640, height: 800 },
      workbench: { width: 760, height: 500 },
    };
    reactFlowMock.getInternalNode.mockImplementation((id: string) => ({
      id,
      measured: dimensions[id] ?? { width: 640, height: 480 },
    }));

    render(
      <WorkflowNodeCanvas
        isVisible
        projectName="道劫"
        nodes={nodes}
        onStageChange={vi.fn()}
      />,
    );
    await act(async () => {
      flushAnimationFrames(4);
    });

    fireEvent.click(screen.getByRole("button", { name: "自动排版 LR" }));
    await act(async () => {
      flushAnimationFrames(5);
    });

    const positions = new Map(
      reactFlowMock.latestNodes.map((node) => [node.id as string, node.position as { x: number; y: number }]),
    );
    expect(positions.get("scriptPlan")?.y).toBeGreaterThan(
      positions.get("script")!.y + dimensions.script.height,
    );
    expect(positions.get("storyboardTable")?.y).toBeGreaterThan(
      positions.get("scriptPlan")!.y + dimensions.scriptPlan.height,
    );
    expect(positions.get("storyboard")?.y).toBeGreaterThan(
      positions.get("storyboardTable")!.y + dimensions.storyboardTable.height,
    );
    expect(positions.get("workbench")?.y).toBeGreaterThan(
      positions.get("storyboard")!.y + dimensions.storyboard.height,
    );
    expect(positions.get("assets")?.x).toBeGreaterThan(
      positions.get("script")!.x + dimensions.script.width,
    );
  });

  it("passes top-bottom handle directions to every production node", async () => {
    render(
      <WorkflowNodeCanvas
        isVisible
        projectName="道劫"
        nodes={nodes}
        onStageChange={vi.fn()}
      />,
    );

    await act(async () => {
      flushAnimationFrames(4);
    });
    fireEvent.click(screen.getByRole("button", { name: "自动排版 LR" }));

    const mainline = reactFlowMock.latestNodes.filter((node) => node.id !== "assets");
    expect(mainline).toHaveLength(6);
    expect(mainline.every((node) => node.sourcePosition === Position.Bottom)).toBe(true);
    expect(mainline.every((node) => node.targetPosition === Position.Top)).toBe(true);
    expect(reactFlowMock.latestNodes.find((node) => node.id === "assets")).toMatchObject({
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    });
  });

  it("keeps zoom and fit controls wired to the viewport instance", async () => {
    render(
      <WorkflowNodeCanvas
        isVisible
        projectName="道劫"
        nodes={nodes}
        onStageChange={vi.fn()}
      />,
    );

    await act(async () => {
      flushAnimationFrames(4);
    });
    reactFlowMock.fitView.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "缩小画布" }));
    fireEvent.click(screen.getByRole("button", { name: "放大画布" }));
    fireEvent.click(screen.getByRole("button", { name: "适配画布" }));

    expect(reactFlowMock.zoomOut).toHaveBeenCalledOnce();
    expect(reactFlowMock.zoomIn).toHaveBeenCalledOnce();
    expect(reactFlowMock.fitView).toHaveBeenCalledWith(
      expect.objectContaining({ duration: 0 }),
    );
  });

  it("cancels a pending initial fit when the user starts zooming", async () => {
    reactFlowMock.getInternalNode.mockImplementation((id: string) => ({
      id,
      measured: { width: 0, height: 0 },
    }));
    render(
      <WorkflowNodeCanvas
        isVisible
        projectName="道劫"
        nodes={nodes}
        onStageChange={vi.fn()}
      />,
    );

    await act(async () => {
      flushAnimationFrames(1);
    });
    fireEvent.click(screen.getByRole("button", { name: "放大画布" }));

    reactFlowMock.getInternalNode.mockImplementation((id: string) => ({
      id,
      measured: { width: 640, height: 480 },
    }));
    await act(async () => {
      flushAnimationFrames(4);
    });

    expect(reactFlowMock.zoomIn).toHaveBeenCalledOnce();
    expect(reactFlowMock.fitView).not.toHaveBeenCalled();
  });
});

describe("storyboard node first-class image generation entry", () => {
  const storyboardNode = {
    id: "storyboard",
    label: "分镜面板",
    description: "分镜图、台词、配音与视频节点绑定。",
    status: "ready",
    metrics: ["3 个分镜", "1 个画面"],
    previewTitle: "分镜面板",
    previewLines: [],
    previewKind: "storyboard-grid",
    targetStage: "storyboard",
    storyboardTiles: [
      {
        id: "sb-ep-001",
        index: 1,
        mediaPath: "project-file://demo/shot-001.png",
        title: "第一镜已生成",
        state: "ready",
        sourceFingerprint: "fp-001",
      },
      {
        id: "sb-ep-002",
        index: 2,
        title: "第二镜未生成",
        lines: "旁白：铁链压境。",
        state: "idle",
        sourceFingerprint: "fp-002",
      },
      {
        id: "sb-ep-003",
        index: 3,
        title: "第三镜未生成",
        state: "idle",
        sourceFingerprint: "fp-003",
      },
    ],
  } satisfies ProductionFlowNodeModel;

  function renderStoryboardNodeCard(overrides: Record<string, unknown> = {}) {
    const ProductionFlowNode = WorkflowProductionNodeModule.ProductionFlowNode;
    const data = {
      node: storyboardNode,
      onStageChange: vi.fn(),
      ...overrides,
    };
    // 节点卡只消费 data;Handle 需要真实 ReactFlowProvider 上下文
    return render(
      React.createElement(
        XYFlow.ReactFlowProvider,
        null,
        React.createElement(ProductionFlowNode, { data } as never),
      ),
    );
  }

  it("exposes a primary storyboard image entry that opens the first ungenerated shot", () => {
    const onOpenAssetImageWorkflow = vi.fn();
    renderStoryboardNodeCard({ onOpenAssetImageWorkflow });

    fireEvent.click(screen.getByRole("button", { name: /分镜生图/ }));

    expect(onOpenAssetImageWorkflow).toHaveBeenCalledWith({
      target: { kind: "storyboard", id: "sb-ep-002" },
      title: "分镜 2",
      prompt: "第二镜未生成",
      sourceImagePath: undefined,
      resultImagePath: undefined,
      imageWorkflowId: undefined,
      sourceStage: "storyboard",
      sourceStageLabel: "分镜视频生成",
      sourceLabel: "分镜成图 · 分镜 2",
      storyboardSourceFingerprint: "fp-002",
      storyboardLines: "旁白：铁链压境。",
    });
  });

  it("hides the same-stage no-op enter button on the storyboard node", () => {
    renderStoryboardNodeCard({ onOpenAssetImageWorkflow: vi.fn() });

    expect(screen.queryByRole("button", { name: "进入" })).toBeNull();
    expect(screen.getByRole("button", { name: /分镜生图/ })).toBeTruthy();
  });
});
