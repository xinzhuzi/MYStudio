import { useState } from "react";
import {
  Panel,
  useOnViewportChange,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";

/**
 * 画布视口缩放控件(深色主题横排:缩小/百分比/放大/适配)。
 * 从 WorkflowNodeCanvas 抽出共享——图片工作流画布原用 React Flow 内置
 * <Controls>,其深色覆盖类是 Tailwind v3 的 `!前缀` 语法,v4 不编译,
 * 实际渲染为默认白色(2026-08-22 用户实证),统一换用本组件。
 */
export function CanvasViewportControls<TNode extends Node>({
  onViewportControlStart,
  onFit,
}: {
  onViewportControlStart?: () => void;
  onFit: () => void;
}) {
  const reactFlow = useReactFlow<TNode, Edge>();
  const [zoomPercent, setZoomPercent] = useState(100);

  useOnViewportChange({
    onChange: (viewport) => {
      setZoomPercent(Math.round(viewport.zoom * 100));
    },
    onEnd: (viewport) => {
      setZoomPercent(Math.round(viewport.zoom * 100));
    },
  });

  return (
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
      </div>
    </Panel>
  );
}
