import { useCallback, useEffect, useState } from "react";
import {
  MiniMap,
  Panel,
  useOnViewportChange,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import { Grid3x3, Map, Maximize2, Redo2, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { canvasMiniMapNodeToken } from "@/lib/studio/canvas-node-registry";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { useThemeMiniMapPalette } from "./use-theme-mini-map";

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
  history,
  onBackgroundModeChange,
}: {
  onViewportControlStart?: () => void;
  onFit: () => void;
  /** 背景模式变化(09-02 R3);画布据此渲染自己的 Background */
  onBackgroundModeChange?: (mode: "dots" | "lines" | "blank") => void;
  /** 撤销重做(08-31-canvas-undo-redo);未提供则不渲染两按钮 */
  history?: {
    canUndo: boolean;
    canRedo: boolean;
    undo: () => void;
    redo: () => void;
  };
}) {
  const reactFlow = useReactFlow<TNode, Edge>();
  const miniMapPalette = useThemeMiniMapPalette();
  const [zoomPercent, setZoomPercent] = useState(100);
  // 背景三态(09-02 R3):点阵/网格/空白循环,偏好记忆
  const [backgroundMode, setBackgroundMode] = useState<"dots" | "lines" | "blank">(() => {
    try {
      const saved = window.localStorage.getItem("studio-canvas-background");
      return saved === "lines" || saved === "blank" ? saved : "dots";
    } catch {
      return "dots";
    }
  });
  const cycleBackground = useCallback(() => {
    setBackgroundMode((mode) => {
      const next = mode === "dots" ? "lines" : mode === "lines" ? "blank" : "dots";
      try {
        window.localStorage.setItem("studio-canvas-background", next);
      } catch {
        // localStorage 不可用时仅会话内生效
      }
      return next;
    });
  }, []);
  // 画布自渲染 Background(避免与画布自带双重渲染);对上层暴露当前模式
  useEffect(() => {
    onBackgroundModeChange?.(backgroundMode);
  }, [backgroundMode, onBackgroundModeChange]);
  const [miniMapOpen, setMiniMapOpen] = useState(readMiniMapOpen);
  // 滑杆按需展开(Radix Slider 挂载会抢焦点,常驻会打断画布内输入——
  // 点百分比区展开,点外/操作完自动收起)
  const [sliderOpen, setSliderOpen] = useState(false);

  useOnViewportChange({
    onChange: (viewport) => {
      setZoomPercent(Math.round(viewport.zoom * 100));
    },
    onEnd: (viewport) => {
      setZoomPercent(Math.round(viewport.zoom * 100));
    },
  });

  const toggleMiniMap = useCallback(() => {
    // 副作用在 updater 外(updater 内做副作用是 StrictMode 双调用反模式)
    const next = !miniMapOpen;
    setMiniMapOpen(next);
    try {
      window.localStorage.setItem(MINI_MAP_PREF_KEY, next ? "1" : "0");
    } catch {
      // localStorage 不可用(隐私模式/测试环境)时仅会话内生效
    }
  }, [miniMapOpen]);

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
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border/70 bg-muted/70 text-muted-foreground transition-colors duration-75 hover:bg-accent hover:text-accent-foreground active:bg-accent/70"
            onClick={() => {
              onViewportControlStart?.();
              void reactFlow.zoomOut({ duration: 180 });
            }}
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="放大画布"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border/70 bg-muted/70 text-muted-foreground transition-colors duration-75 hover:bg-accent hover:text-accent-foreground active:bg-accent/70"
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
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border/70 bg-muted/70 px-3 text-foreground transition-colors duration-75 hover:bg-accent hover:text-accent-foreground active:bg-accent/70"
            onClick={onFit}
          >
            <Maximize2 className="h-3.5 w-3.5" />
            适配
          </button>
          <button
          type="button"
          aria-label="展开缩放滑杆"
          className="inline-flex h-9 min-w-14 items-center justify-center rounded-md border border-border/70 bg-muted/70 text-sm font-semibold tabular-nums text-foreground transition-colors duration-75 hover:bg-accent hover:text-accent-foreground active:bg-accent/70"
          onClick={() => setSliderOpen((open) => !open)}
        >
          {zoomPercent}%
        </button>
        {sliderOpen ? (
        <div className="flex w-24 items-center" onBlur={() => setSliderOpen(false)}>
          <Slider
            min={20}
            max={200}
            step={5}
            value={[zoomPercent]}
            onValueChange={(value) => {
              const next = Math.min(200, Math.max(20, value[0] ?? 100));
              const current = reactFlow.getViewport();
              const scale = next / 100;
              reactFlow.setViewport({
                x: window.innerWidth / 2 - ((window.innerWidth / 2 - current.x) / current.zoom) * scale,
                y: window.innerHeight / 2 - ((window.innerHeight / 2 - current.y) / current.zoom) * scale,
                zoom: scale,
              });
            }}
            aria-label="缩放滑杆"
            className="nodrag nopan"
          />
        </div>
        ) : null}
        <Button
          size="icon"
          variant="ghost"
          aria-label="切换背景"
          title="点阵/网格/空白循环"
          onClick={cycleBackground}
        >
          <Grid3x3 className="h-4 w-4" />
        </Button>
        {history ? (
          <>
            <button
              type="button"
              aria-label="撤销"
              title="撤销 (⌘Z)"
              disabled={!history.canUndo}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border/70 bg-muted/70 text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
              onClick={history.undo}
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="重做"
              title="重做 (⌘⇧Z)"
              disabled={!history.canRedo}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border/70 bg-muted/70 text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
              onClick={history.redo}
            >
              <Redo2 className="h-4 w-4" />
            </button>
          </>
        ) : null}
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
          className="workflow-canvas-minimap nodrag nopan rounded-lg border border-border/80"
          style={{ backgroundColor: miniMapPalette.card }}
          nodeColor={(node) => {
            // React Flow 的 node.type 是渲染组件类型(imageWorkflow/生产流id);
            // 领域类型在 data.node.type(prompt/generated/reference)
            const data = node.data as { node?: { type?: string } } | undefined;
            const domainType = data?.node?.type ?? node.type ?? "default";
            return miniMapPalette.node[canvasMiniMapNodeToken(domainType)];
          }}
          nodeStrokeColor={miniMapPalette.border}
          maskColor={miniMapPalette.mask}
        />
      ) : null}
    </>
  );
}
