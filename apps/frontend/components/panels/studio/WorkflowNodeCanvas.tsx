import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  useOnViewportChange,
  useNodesState,
  useReactFlow,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ClipboardList,
  Clapperboard,
  ArrowRight,
  Boxes,
  ChevronRight,
  Edit3,
  FileText,
  Film,
  ImageOff,
  Maximize2,
  PackageOpen,
  RefreshCw,
  Split,
  Table2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  ProductionFlowAssetCard,
  ProductionFlowNodeAction,
  ProductionFlowNodeId,
  ProductionFlowNodeModel,
  ProductionFlowStage,
} from "./workflow-node-model";
import { PRODUCTION_FLOW_EDGES } from "./workflow-node-model";

const NODE_ICONS = {
  script: FileText,
  scriptPlan: ClipboardList,
  assets: Boxes,
  storyboardTable: Table2,
  storyboard: Split,
  workbench: Film,
} satisfies Record<ProductionFlowNodeId, typeof FileText>;

const LR_POSITIONS = {
  script: { x: 0, y: 0 },
  scriptPlan: { x: 1120, y: 0 },
  assets: { x: 0, y: 660 },
  storyboardTable: { x: 1820, y: 0 },
  storyboard: { x: 2620, y: 0 },
  workbench: { x: 3360, y: 120 },
} satisfies Record<ProductionFlowNodeId, { x: number; y: number }>;

const FIT_VIEW_OPTIONS = {
  padding: 0.18,
  minZoom: 0.28,
  maxZoom: 0.72,
} as const;

function fitCanvasAfterLayout(
  instance: ReactFlowInstance<ProductionFlowReactNode, Edge>,
) {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      void instance.fitView({ ...FIT_VIEW_OPTIONS, duration: 180 });
    });
  });
}

const TB_POSITIONS = {
  script: { x: 160, y: 0 },
  assets: { x: 160, y: 560 },
  scriptPlan: { x: 160, y: 940 },
  storyboardTable: { x: 160, y: 1260 },
  storyboard: { x: 160, y: 1580 },
  workbench: { x: 160, y: 1900 },
} satisfies Record<ProductionFlowNodeId, { x: number; y: number }>;

interface ProductionNodeData extends Record<string, unknown> {
  node: ProductionFlowNodeModel;
  onStageChange: (stage: ProductionFlowStage) => void;
  onNodeEdit?: (nodeId: ProductionFlowNodeId) => void;
  onNodeAction?: (action: ProductionFlowNodeAction) => void | Promise<void>;
}

type ProductionFlowReactNode = Node<ProductionNodeData>;

function CanvasViewportControls() {
  const reactFlow = useReactFlow<ProductionFlowReactNode, Edge>();
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
    <Panel position="bottom-left" className="nodrag nopan">
      <div className="flex items-center gap-1 rounded-md border border-white/14 bg-[#151615]/92 p-1 text-xs text-zinc-200 shadow-[0_18px_48px_rgba(0,0,0,0.36)] backdrop-blur">
        <button
          type="button"
          aria-label="缩小画布"
          className="inline-flex h-8 w-8 items-center justify-center rounded border border-white/10 bg-white/[0.045] text-zinc-200 hover:bg-white/[0.09]"
          onClick={() => reactFlow.zoomOut({ duration: 180 })}
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <span className="min-w-14 px-2 text-center tabular-nums text-zinc-100">
          {zoomPercent}%
        </span>
        <button
          type="button"
          aria-label="放大画布"
          className="inline-flex h-8 w-8 items-center justify-center rounded border border-white/10 bg-white/[0.045] text-zinc-200 hover:bg-white/[0.09]"
          onClick={() => reactFlow.zoomIn({ duration: 180 })}
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="适配画布"
          className="inline-flex h-8 items-center gap-1.5 rounded border border-white/10 bg-white/[0.045] px-2.5 text-zinc-200 hover:bg-white/[0.09]"
          onClick={() => reactFlow.fitView({ padding: 0.22, duration: 220 })}
        >
          <Maximize2 className="h-3.5 w-3.5" />
          适配
        </button>
      </div>
    </Panel>
  );
}

const NODE_SIZE_CLASS = {
  script: "w-[1040px]",
  scriptPlan: "w-[580px]",
  assets: "w-[760px]",
  storyboardTable: "w-[700px]",
  storyboard: "w-[640px]",
  workbench: "w-[420px]",
} satisfies Record<ProductionFlowNodeId, string>;

const NODE_PREVIEW_CLASS = {
  script: "max-h-[560px]",
  scriptPlan: "h-[520px]",
  assets: "max-h-[560px]",
  storyboardTable: "max-h-[430px]",
  storyboard: "max-h-[320px]",
  workbench: "max-h-[220px]",
} satisfies Record<ProductionFlowNodeId, string>;

function ProductionFlowNode({ data }: NodeProps<Node<ProductionNodeData>>) {
  const Icon = NODE_ICONS[data.node.id];
  const [actionInputs, setActionInputs] = useState<Record<string, string>>({});
  const [runningActionId, setRunningActionId] = useState<string | null>(null);
  const runNodeAction = useCallback(
    async (action: ProductionFlowNodeAction) => {
      if (action.disabled || runningActionId) return;
      setRunningActionId(action.id);
      try {
        await data.onNodeAction?.({
          ...action,
          userInstruction: (actionInputs[action.id] ?? "").trim(),
        });
      } finally {
        setRunningActionId(null);
      }
    },
    [actionInputs, data, runningActionId],
  );

  return (
    <div
      data-flow-node-id={data.node.id}
      className={cn(
        "group rounded-md border bg-[#171817]/95 p-4 text-left shadow-[0_24px_64px_rgba(0,0,0,0.42)] outline-none backdrop-blur transition",
        "hover:-translate-y-0.5 hover:border-sky-300/55 hover:shadow-[0_26px_72px_rgba(37,99,235,0.18)]",
        NODE_SIZE_CLASS[data.node.id],
        data.node.status === "ready" && "border-emerald-300/30",
        data.node.status === "warning" && "border-amber-300/40",
        data.node.status === "pending" && "border-sky-300/35",
        data.node.status === "empty" && "border-white/12",
      )}
      >
      <Handle
        type="target"
        id={`${data.node.id}-target`}
        position={data.node.id === "assets" ? Position.Top : Position.Left}
        className="!h-2.5 !w-2.5 !border !border-sky-100/70 !bg-sky-300"
      />
      <Handle
        type="source"
        id={`${data.node.id}-source`}
        position={Position.Right}
        className="!h-2.5 !w-2.5 !border !border-sky-100/70 !bg-sky-300"
      />
      {data.node.id === "script" ? (
        <Handle
          type="source"
          id="script-assets-source"
          position={Position.Bottom}
          className="!h-2.5 !w-2.5 !border !border-sky-100/70 !bg-sky-300"
        />
      ) : null}
      <div className="workflow-node-titlebar flex cursor-grab items-start justify-between gap-3 active:cursor-grabbing">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/15 bg-white/[0.06] text-zinc-100">
            <Icon className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-zinc-100">
              {data.node.label}
            </span>
            <span className="mt-0.5 block text-[11px] uppercase tracking-[0.18em] text-zinc-500">
              {data.node.id}
            </span>
          </span>
        </div>
        <div className="nodrag nopan flex shrink-0 items-center gap-2">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-semibold",
              data.node.status === "ready" && "bg-emerald-300/15 text-emerald-200",
              data.node.status === "warning" && "bg-amber-300/15 text-amber-200",
              data.node.status === "pending" && "bg-sky-300/15 text-sky-200",
              data.node.status === "empty" && "bg-zinc-700/70 text-zinc-300",
            )}
          >
            {data.node.status === "ready" ? "READY" : "TODO"}
          </span>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-white/12 bg-white/[0.055] px-2 text-[11px] font-medium text-zinc-200 hover:border-sky-300/45 hover:bg-sky-300/12"
            onClick={(event) => {
              event.stopPropagation();
              data.onNodeEdit?.(data.node.id);
            }}
          >
            编辑
            <Edit3 className="h-3 w-3" />
          </button>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-white/12 bg-white/[0.055] px-2 text-[11px] font-medium text-zinc-200 hover:border-sky-300/45 hover:bg-sky-300/12"
            onClick={(event) => {
              event.stopPropagation();
              data.onStageChange(data.node.targetStage);
            }}
          >
            进入
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </div>
      <p className="mt-4 text-xs leading-5 text-zinc-400">
        {data.node.description}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {data.node.metrics.map((metric) => (
          <span
            key={metric}
            className="rounded-md border border-white/10 bg-black/25 px-2 py-1 text-[11px] text-zinc-300"
          >
            {metric}
          </span>
        ))}
      </div>
      <div className="mt-4 rounded-md border border-white/10 bg-black/30 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-zinc-300">
            {data.node.previewTitle}
          </span>
          <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-600">
            FLOWDATA
          </span>
        </div>
        {data.node.previewKind === "table" ? (
          <StoryboardTablePreview node={data.node} />
        ) : data.node.previewKind === "storyboard-grid" ? (
          <StoryboardGridPreview node={data.node} />
        ) : data.node.previewKind === "asset-derivation" ? (
          <AssetDerivationPreview node={data.node} />
        ) : (
          <TextPreview node={data.node} />
        )}
      </div>
      {data.node.skills?.length || data.node.skill ? (
        <NodeSkillDisclosure node={data.node} />
      ) : null}
      {data.node.actions?.length ? (
        <div
          className="nodrag nopan nowheel mt-4 space-y-3"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {data.node.actions.map((action) => (
            <div
              key={action.id}
              className="rounded-md border border-sky-300/15 bg-sky-300/[0.055] p-2.5"
            >
              {(() => {
                const isRunning = runningActionId === action.id;
                const isDisabled = Boolean(action.disabled || runningActionId);
                return (
                  <>
              <textarea
                value={actionInputs[action.id] ?? ""}
                disabled={isDisabled}
                placeholder={action.promptPlaceholder ?? "给 AI 补充本节点生成要求..."}
                className={cn(
                  "min-h-[64px] w-full resize-none rounded border border-white/10 bg-black/25 px-2.5 py-2 text-xs leading-5 text-zinc-200 outline-none placeholder:text-zinc-600",
                  "focus:border-sky-300/55 focus:bg-black/32",
                  isDisabled && "cursor-not-allowed opacity-55",
                )}
                onChange={(event) =>
                  setActionInputs((current) => ({
                    ...current,
                    [action.id]: event.target.value,
                  }))
                }
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[10px] text-zinc-500">
                  {action.disabled
                    ? "请先完成上游节点"
                    : isRunning
                      ? "正在提交本节点 AI 任务"
                      : "输入内容会附加到本次 AI 任务"}
                </span>
                <button
                  type="button"
                  disabled={isDisabled}
                  className={cn(
                    "inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-sky-300/30 bg-sky-300/12 px-3 text-xs font-medium text-sky-100",
                    "hover:border-sky-200/60 hover:bg-sky-300/18",
                    isDisabled &&
                      "cursor-not-allowed border-white/10 bg-white/[0.045] text-zinc-500 hover:border-white/10 hover:bg-white/[0.045]",
                  )}
                  onClick={() => void runNodeAction(action)}
                >
                  <Clapperboard className={cn("h-3.5 w-3.5", isRunning && "animate-pulse")} />
                  {isRunning ? "生成中" : action.label}
                </button>
              </div>
                  </>
                );
              })()}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function NodeSkillDisclosure({ node }: { node: ProductionFlowNodeModel }) {
  const skills = node.skills?.length ? node.skills : node.skill ? [node.skill] : [];
  if (!skills.length) return null;
  return (
    <details className="nodrag nopan nowheel mt-3 rounded-md border border-white/10 bg-black/25">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs text-zinc-300">
        <span className="min-w-0 truncate">
          生成依据 · {skills.length} 项
        </span>
        <span className="shrink-0 rounded border border-white/10 bg-white/[0.045] px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-zinc-500">
          SKILLS
        </span>
      </summary>
      <div className="space-y-2 border-t border-white/10 px-3 py-2">
        <div className="text-[10px] text-zinc-500">
          默认收起，展开查看本节点运行时使用的执行 skill、视觉风格、题材规则和通用技法。
        </div>
        {skills.map((skill) => (
          <div
            key={skill.id}
            className="rounded border border-white/10 bg-black/20 px-2.5 py-2"
          >
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] text-zinc-500">
              <span className="rounded bg-white/[0.045] px-1.5 py-0.5 text-zinc-300">
                {skill.name}
              </span>
              <span className="rounded bg-white/[0.045] px-1.5 py-0.5">
                {skill.source}
              </span>
              <span className="rounded bg-white/[0.045] px-1.5 py-0.5">
                {skill.id}
              </span>
            </div>
            <div className="max-h-[150px] space-y-1 overflow-y-auto pr-1 text-[11px] leading-5 text-zinc-400 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5">
              {skill.summaryLines.map((line, index) => (
                <p
                  key={`${node.id}-${skill.id}-skill-${index}`}
                  className="whitespace-pre-wrap break-words"
                >
                  {line}
                </p>
              ))}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

function TextPreview({ node }: { node: ProductionFlowNodeModel }) {
  return (
    <div
      className={cn(
        "nodrag nopan nowheel space-y-1.5 overflow-y-auto overscroll-contain pr-1 text-[11px] leading-5 text-zinc-400",
        node.id === "scriptPlan" &&
          "rounded border border-white/5 bg-black/15 px-2 py-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5",
        NODE_PREVIEW_CLASS[node.id],
      )}
    >
      {node.previewLines.map((line, index) => (
        <p key={`${node.id}-${index}`} className="whitespace-pre-wrap break-words">
          {line}
        </p>
      ))}
    </div>
  );
}

function AssetDerivationPreview({ node }: { node: ProductionFlowNodeModel }) {
  const groups = node.assetGroups ?? [];
  if (!groups.length) return <TextPreview node={node} />;
  return (
    <div className="nodrag nopan nowheel max-h-[560px] space-y-4 overflow-y-auto overscroll-contain pr-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5">
      {groups.map((group) => (
        <div
          key={group.source.id}
          className="grid grid-cols-[188px_34px_minmax(188px,1fr)] items-stretch gap-3"
        >
          <AssetFlowCard card={group.source} />
          <div className="flex items-center justify-center text-zinc-300">
            <ChevronRight className="h-6 w-6" />
          </div>
          {group.derived.length ? (
            <div className="grid grid-cols-2 gap-3">
              {group.derived.slice(0, 4).map((item) => (
                <AssetFlowCard key={item.id} card={item} />
              ))}
            </div>
          ) : (
            <EmptyDerivedAssetCard />
          )}
        </div>
      ))}
    </div>
  );
}

function AssetFlowCard({
  card,
}: {
  card: ProductionFlowAssetCard;
}) {
  return (
    <div className="min-h-[214px] rounded-md border border-white/14 bg-[#202120] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
      <div className="flex h-[112px] items-center justify-center overflow-hidden rounded bg-black/22">
        {card.mediaPath ? (
          <img
            src={toPreviewSrc(card.mediaPath)}
            alt={card.name}
            className="h-full w-full object-contain"
            loading="lazy"
          />
        ) : card.state === "生成中" ? (
          <RefreshCw className="h-8 w-8 animate-spin text-sky-300/70" />
        ) : (
          <PackageOpen className="h-9 w-9 text-zinc-600" />
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[10px] text-zinc-500">
          {card.typeLabel}
        </span>
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold",
            card.isDerived
              ? "bg-orange-400 text-zinc-950"
              : "bg-emerald-400 text-zinc-950",
          )}
        >
          {card.isDerived ? "衍生" : "原资产"}
        </span>
      </div>
      <p className="mt-1 line-clamp-1 text-[11px] font-medium text-zinc-300">
        {card.name}
      </p>
      <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-zinc-500">
        {card.reason || card.note || "等待补充资产描述。"}
      </p>
    </div>
  );
}

function EmptyDerivedAssetCard() {
  return (
    <div className="flex min-h-[214px] flex-col items-center justify-center rounded-md border border-white/14 bg-[#202120]/82 p-3 text-center">
      <ImageOff className="h-10 w-10 text-zinc-600" />
      <p className="mt-3 text-[11px] text-zinc-500">无衍生资产</p>
    </div>
  );
}

function StoryboardTablePreview({ node }: { node: ProductionFlowNodeModel }) {
  const rows = node.tableRows ?? [];
  if (!rows.length) return <TextPreview node={node} />;
  return (
    <div className="nodrag nowheel max-h-[430px] overflow-auto overscroll-contain rounded border border-white/10">
      <div className="sticky top-0 z-10 grid min-w-[1920px] grid-cols-[44px_0.82fr_0.72fr_1.5fr_0.72fr_1.05fr_54px_0.62fr_0.72fr_1.35fr_0.82fr_0.95fr_0.72fr_1.2fr_0.82fr_0.9fr] bg-[#242624] text-[10px] font-medium text-zinc-300">
        <span className="px-2 py-2">序号</span>
        <span className="px-2 py-2">标题</span>
        <span className="px-2 py-2">title</span>
        <span className="px-2 py-2">画面描述</span>
        <span className="px-2 py-2">场景</span>
        <span className="px-2 py-2">关联资产名称</span>
        <span className="px-2 py-2">时长</span>
        <span className="px-2 py-2">景别</span>
        <span className="px-2 py-2">运镜</span>
        <span className="px-2 py-2">角色动作</span>
        <span className="px-2 py-2">朝向</span>
        <span className="px-2 py-2">空间关系</span>
        <span className="px-2 py-2">情绪</span>
        <span className="px-2 py-2">台词</span>
        <span className="px-2 py-2">音效</span>
        <span className="px-2 py-2">关联资产ID</span>
      </div>
      <div className="divide-y divide-white/8">
        {rows.map((row) => (
          <div
            key={`${node.id}-row-${row.index}`}
            className="grid min-w-[1920px] grid-cols-[44px_0.82fr_0.72fr_1.5fr_0.72fr_1.05fr_54px_0.62fr_0.72fr_1.35fr_0.82fr_0.95fr_0.72fr_1.2fr_0.82fr_0.9fr] text-[10px] leading-4 text-zinc-400 odd:bg-white/[0.025]"
          >
            <span className="px-2 py-2 text-zinc-300">{row.index}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.title || "—"}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.titleEn || "—"}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.description || "—"}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.scene || "—"}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.associateAssetsNames.join("、") || "—"}</span>
            <span className="px-2 py-2">{row.duration || "—"}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.shotSize || "—"}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.cameraMove || "—"}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.action || "—"}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.orientation || "—"}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.spatialRelation || "—"}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.emotion || "—"}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.lines || "—"}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.sound || "—"}</span>
            <span className="whitespace-pre-wrap break-words px-2 py-2">{row.associateAssetsIds.join("、") || "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StoryboardGridPreview({ node }: { node: ProductionFlowNodeModel }) {
  const tiles = node.storyboardTiles ?? [];
  if (!tiles.length) return <TextPreview node={node} />;
  return (
    <div className="nodrag nowheel max-h-[320px] overflow-y-auto overscroll-contain pr-1">
      <div className="grid grid-cols-4 gap-2">
        {tiles.map((tile) => (
          <div key={tile.id} className="min-w-0">
            <div className="relative aspect-video overflow-hidden rounded border border-white/10 bg-zinc-900">
              {tile.mediaPath ? (
                <img
                  src={toPreviewSrc(tile.mediaPath)}
                  alt={tile.title}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-[10px] text-zinc-600">
                  未生成
                </div>
              )}
              <span className="absolute left-1 top-1 rounded bg-emerald-400 px-1.5 py-0.5 text-[9px] font-semibold text-zinc-950">
                S{String(tile.index).padStart(2, "0")}
              </span>
              <span className="absolute right-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] text-zinc-200">
                {tile.state}
              </span>
            </div>
            <p className="mt-1 line-clamp-1 text-[10px] text-zinc-400">
              {tile.title}
            </p>
            {tile.lines ? (
              <p className="line-clamp-1 text-[10px] text-zinc-500">
                {tile.lines}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function toPreviewSrc(path: string) {
  if (/^(https?:|data:|blob:|file:|local-image:\/\/)/.test(path)) return path;
  if (path.startsWith("/")) return `file://${encodeURI(path)}`;
  return path;
}

const nodeTypes = { productionFlow: ProductionFlowNode };

export function WorkflowNodeCanvas({
  projectName,
  nodes,
  onStageChange,
  onNodeEdit,
  onNodeAction,
}: {
  projectName: string;
  nodes: ProductionFlowNodeModel[];
  onStageChange: (stage: ProductionFlowStage) => void;
  onNodeEdit?: (nodeId: ProductionFlowNodeId) => void;
  onNodeAction?: (action: ProductionFlowNodeAction) => void | Promise<void>;
}) {
  const [layout, setLayout] = useState<"LR" | "TB">("LR");
  const [flowInstance, setFlowInstance] =
    useState<ReactFlowInstance<ProductionFlowReactNode, Edge> | null>(null);
  const positions = layout === "LR" ? LR_POSITIONS : TB_POSITIONS;
  const initialReactFlowNodes = useMemo<ProductionFlowReactNode[]>(
    () =>
      nodes.map((node) => ({
        id: node.id,
        type: "productionFlow",
        position: positions[node.id],
        sourcePosition: layout === "LR" ? Position.Right : Position.Bottom,
        targetPosition:
          node.id === "assets" ? Position.Top : layout === "LR" ? Position.Left : Position.Top,
        data: { node, onStageChange, onNodeEdit, onNodeAction },
      })),
    [layout, nodes, onNodeAction, onNodeEdit, onStageChange, positions],
  );
  const [reactFlowNodes, setReactFlowNodes, onNodesChange] =
    useNodesState<ProductionFlowReactNode>(initialReactFlowNodes);
  useEffect(() => {
    setReactFlowNodes((currentNodes) => {
      const currentById = new Map(currentNodes.map((node) => [node.id, node]));
      return initialReactFlowNodes.map((node) => {
        const current = currentById.get(node.id);
        if (!current) return node;
        return {
          ...node,
          position: current.position,
          selected: current.selected,
          dragging: current.dragging,
        };
      });
    });
  }, [initialReactFlowNodes, setReactFlowNodes]);
  const reactFlowEdges = useMemo<Edge[]>(
    () =>
      PRODUCTION_FLOW_EDGES.map(([source, target]) => ({
        id: `${source}->${target}`,
        source,
        target,
        sourceHandle:
          source === "script" && target === "assets"
            ? "script-assets-source"
            : `${source}-source`,
        targetHandle: `${target}-target`,
        data: { flowEdgeId: `${source}->${target}` },
        className: "production-flow-edge",
        markerEnd: { type: MarkerType.ArrowClosed, color: "#0f0f0f" },
        style: { stroke: "#0f0f0f", strokeWidth: 4 },
      })),
    [],
  );
  const toggleLayout = useCallback(() => {
    setLayout((current) => (current === "LR" ? "TB" : "LR"));
  }, []);
  useEffect(() => {
    if (!flowInstance) return;
    fitCanvasAfterLayout(flowInstance);
  }, [flowInstance, layout, nodes]);

  return (
    <section className="workflow-node-canvas production-video-stage grid h-full min-h-[calc(100vh-190px)] w-full flex-1 grid-cols-[minmax(0,1fr)] overflow-hidden rounded-lg border border-white/10 bg-[#202120] text-zinc-100">
      <div className="relative min-w-0 overflow-hidden">
        <div className="workflow-node-toolbar pointer-events-none absolute left-5 top-5 z-30 flex flex-wrap items-center gap-2">
          <div className="mr-3 min-w-0">
            <h3 className="truncate text-base font-semibold text-zinc-100">
              {projectName}
            </h3>
          </div>
          <button
            type="button"
            className="pointer-events-auto inline-flex h-9 max-w-[320px] items-center gap-2 rounded-md border border-white/16 bg-[#151615]/88 px-3 text-xs text-zinc-200 shadow-[0_14px_34px_rgba(0,0,0,0.2)] backdrop-blur-md"
          >
            <Clapperboard className="h-4 w-4" />
            <span className="truncate">{projectName} EP01</span>
          </button>
          <button
            type="button"
            className="pointer-events-auto inline-flex h-9 items-center gap-2 rounded-md border border-white/16 bg-[#151615]/88 px-3 text-xs text-zinc-200 backdrop-blur-md hover:bg-white/[0.09]"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="pointer-events-auto inline-flex h-9 items-center gap-2 rounded-md border border-white/16 bg-[#151615]/88 px-3 text-xs text-zinc-200 backdrop-blur-md hover:bg-white/[0.09]"
            onClick={toggleLayout}
          >
            自动排版 {layout}
          </button>
        </div>
        <ReactFlow
          className="production-flow-reactflow absolute inset-0 bg-[radial-gradient(circle_at_48%_32%,rgba(125,211,252,0.11),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.035),transparent_50%)]"
          nodes={reactFlowNodes}
          edges={reactFlowEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onInit={(instance) => {
            setFlowInstance(instance);
            fitCanvasAfterLayout(instance);
          }}
          fitView
          fitViewOptions={FIT_VIEW_OPTIONS}
          nodesDraggable
          nodeDragThreshold={2}
          nodesConnectable={false}
          elementsSelectable
          panOnDrag={[0]}
          panOnScroll={false}
          zoomOnScroll
          zoomOnPinch
          zoomOnDoubleClick={false}
          selectionOnDrag={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="rgba(255,255,255,0.055)" gap={30} size={1} />
          <CanvasViewportControls />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </section>
  );
}
