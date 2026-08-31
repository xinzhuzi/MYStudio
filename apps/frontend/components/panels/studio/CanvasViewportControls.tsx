import { useCallback, useState } from "react";
import {
  MiniMap,
  Panel,
  useOnViewportChange,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import { Map, Maximize2, ZoomIn, ZoomOut } from "lucide-react";

/**
 * 画布视口缩放控件(深色主题横排:缩小/百分比/放大/适配/小地图)。
 * 从 WorkflowNodeCanvas 抽出共享——图片工作流画布原用 React Flow 内置
 * <Controls>,其深色覆盖类是 Tailwind v3 的 `!前缀` 语法,v4 不编译,
 * 实际渲染为默认白色(2026-08-22 用户实证),统一换用本组件。
 *
 * 小地图(2026-08-31,08-31-canvas-minimap):内置 <MiniMap> 挂在
 * bottom-right,与本控件同为 ReactFlow 后代 Panel,两画布面零额外接线;
 * 显隐开关走本控件,偏好记 localStorage(默认显示)。类型色暂为本地
 * 映射,节点注册表(canvas-node-registry)落地后由注册表供给。
 */
const MINI_MAP_PREF_KEY = "studio-canvas-minimap-open";

/** 类型→小地图节点色:确定性本地映射(注册表落地前的过渡实现)。 */
const MINI_MAP_TYPE_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--accent))",
  "hsl(142 60% 45%)",
  "hsl(38 90% 50%)",
  "hsl(280 60% 60%)",
] as const;

function miniMapNodeColor(node: Node): string {
  let hash = 0;
  const type = node.type ?? "default";
  for (let i = 0; i < type.length; i += 1) {
    hash = (hash * 31 + type.charCodeAt(i)) % 997;
  }
  return MINI_MAP_TYPE_COLORS[hash % MINI_MAP_TYPE_COLORS.length];
}

function readMiniMapOpen(): boolean {
  try {
    return window.localStorage.getItem(MINI_MAP_PREF_KEY) !== "0";
  } catch {
    return true;
  }
}

export function CanvasViewportControls<TNode extends Node>({
  onViewportControlStart,
  onFit,
}: {
  onViewportControlStart?: () => void;
  onFit: () => void;
}) {
  const reactFlow = useReactFlow<TNode, Edge>();
  const [zoomPercent, setZoomPercent] = useState(100);
  const [miniMapOpen, setMiniMapOpen] = useState(readMiniMapOpen);

  useOnViewportChange({
    onChange: (viewport) => {
      setZoomPercent(Math.round(viewport.zoom * 100));
    },
    onEnd: (viewport) => {
      setZoomPercent(Math.round(viewport.zoom * 100));
    },
  });

  const toggleMiniMap = useCallback(() => {
    setMiniMapOpen((open) => {
      const next = !open;
      try {
        window.localStorage.setItem(
          MINI_MAP_PREF_KEY,
          next ? "1" : "0",
        );
      } catch {
        // localStorage 不可用(隐私模式/测试环境)时仅会话内生效
      }
      return next;
    });
  }, []);

  return (
    <>
      <Panel
        position="bottom-left"
        className="workflow-node-viewport-controls nodrag nopan"
      >
        <div className="flex max-w-[calc(100vw-3rem)] items-center gap-1 rounded-lg border border-border/80 bg-card p-1 text-xs text-card-foreground">
          <button
            type="button"
            aria-label="缩小画布"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border/70 bg-muted/70 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              onViewportControlStart?.();
              void reactFlow.zoomOut({ duration: 180 });
            }}
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="min-w-16 px-2 text-center text-sm font-semibold tabular-nums text-foreground">
            {zoomPercent}%
          </span>
          <button
            type="button"
            aria-label="放大画布"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border/70 bg-muted/70 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              onViewportControlStart?.();
              void reactFlow.zoomIn({ duration: 180 });
            }}
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="适配画布"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border/70 bg-muted/70 px-3 text-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={onFit}
          >
            <Maximize2 className="h-3.5 w-3.5" />
            适配
          </button>
          <button
            type="button"
            aria-label={miniMapOpen ? "收起小地图" : "展开小地图"}
            title={miniMapOpen ? "收起小地图" : "展开小地图"}
            aria-pressed={miniMapOpen}
            className={`inline-flex h-9 w-9 items-center justify-center rounded-md border border-border/70 text-foreground hover:bg-accent hover:text-accent-foreground ${
              miniMapOpen ? "bg-accent/40" : "bg-muted/70 text-muted-foreground"
            }`}
            onClick={toggleMiniMap}
          >
            <Map className="h-4 w-4" />
          </button>
        </div>
      </Panel>
      {miniMapOpen ? (
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          className="workflow-canvas-minimap nodrag nopan rounded-lg border border-border/80 bg-card/95"
          nodeColor={miniMapNodeColor}
          nodeStrokeColor="hsl(var(--border))"
          maskColor="rgba(10, 10, 14, 0.55)"
        />
      ) : null}
    </>
  );
}
