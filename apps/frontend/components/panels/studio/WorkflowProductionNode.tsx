import { memo, useCallback, useState } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import {
  ArrowRight,
  Braces,
  Boxes,
  ClipboardList,
  Clapperboard,
  Edit3,
  FileText,
  Film,
  ImageIcon,
  Camera,
  Loader2,
  Table2,
  ZoomIn,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import type { ImageWorkflowOpenContext } from "@/types/studio";
import type { StoryboardBatchGenerationState } from "./image-workflow/use-storyboard-batch-generation";
import type { StoryboardBatchUpscaleState } from "./image-workflow/use-storyboard-batch-upscale";
import type {
  ProductionFlowNodeAction,
  ProductionFlowNodeId,
  ProductionFlowNodeModel,
  ProductionFlowStage,
} from "./workflow-node-model";
import { AssetDerivationPreview } from "./previews/asset-derivation-preview";
import { RemotionShotPreview } from "./previews/remotion-shot-preview";
import { StoryboardGridPreview } from "./previews/storyboard-grid-preview";
import { StoryboardTablePreview } from "./previews/storyboard-table-preview";
import { TextPreview } from "./previews/text-preview";
import { WorkbenchLanePreview } from "./previews/workbench-lane-preview";

export interface ProductionNodeData extends Record<string, unknown> {
  node: ProductionFlowNodeModel;
  sourcePosition?: Position;
  targetPosition?: Position;
  onStageChange: (stage: ProductionFlowStage) => void;
  onNodeEdit?: (nodeId: ProductionFlowNodeId) => void;
  onNodeJson?: (nodeId: ProductionFlowNodeId) => void;
  onNodeAction?: (action: ProductionFlowNodeAction) => void | Promise<void>;
  onOpenAssetImageWorkflow?: (context: ImageWorkflowOpenContext) => void;
  /** 一键生图批量(与分镜面板同一 hook 实例),未注入时节点不渲染生图入口 */
  storyboardBatch?: {
    state: StoryboardBatchGenerationState;
    start: () => void;
    stop: () => void;
  };
  /** 一键超分批量(本地 x4 到 4K),未注入时节点不渲染超分入口 */
  storyboardUpscale?: {
    state: StoryboardBatchUpscaleState;
    start: () => void;
    stop: () => void;
    /** 派生进度:已超分数/有图总数(空闲态按钮显示) */
    upscaledCount?: number;
    shotCount?: number;
  };
}

const NODE_ICONS = {
  script: FileText,
  scriptPlan: ClipboardList,
  assets: Boxes,
  storyboardTable: Table2,
  storyboard: Camera,
  remotionProduction: Clapperboard,
  workbench: Film,
} satisfies Record<ProductionFlowNodeId, typeof FileText>;

export const NODE_SIZE_CLASS = {
  script: "w-[1040px]",
  scriptPlan: "w-[680px]",
  assets: "w-[760px]",
  storyboardTable: "w-[700px]",
  storyboard: "w-[640px]",
  remotionProduction: "w-[760px]",
  workbench: "w-[760px]",
} satisfies Record<ProductionFlowNodeId, string>;

const WRITABLE_NODE_IDS: readonly ProductionFlowNodeId[] = [
  "script",
  "scriptPlan",
  "storyboardTable",
];
const COMPACT_HEADER_NODE_IDS: readonly ProductionFlowNodeId[] = [
  "script",
  "scriptPlan",
  "storyboardTable",
];
const HIDDEN_METRIC_NODE_IDS: readonly ProductionFlowNodeId[] = [
  "scriptPlan",
  "storyboardTable",
];
const UNFRAMED_PREVIEW_NODE_IDS: readonly ProductionFlowNodeId[] = [
  "script",
  "scriptPlan",
  "storyboardTable",
];

/**
 * React Flow 铁律:自定义节点必须 memo——否则任何 flow store 变化(缩放/选择/
 * 视口派生态)都会全量重渲染节点内容;82 瓦片轨道卡被每帧重算就是卡顿源之一。
 */
export const ProductionFlowNode = memo(function ProductionFlowNode({ data }: NodeProps<Node<ProductionNodeData>>) {
  const Icon = NODE_ICONS[data.node.id];
  const sourcePosition = data.sourcePosition ?? Position.Right;
  const targetPosition = data.targetPosition ?? (
    data.node.id === "assets" ? Position.Top : Position.Left
  );
  const [actionInputs, setActionInputs] = useState<Record<string, string>>({});
  const [runningActionId, setRunningActionId] = useState<string | null>(null);
  const canEditNode = Boolean(
    data.onNodeEdit && WRITABLE_NODE_IDS.includes(data.node.id),
  );
  const canOpenJson = Boolean(
    data.onNodeJson && (data.node.id === "storyboardTable" || data.node.id === "storyboard"),
  );
  const useCompactHeader = COMPACT_HEADER_NODE_IDS.includes(data.node.id);
  const titleMetrics = data.node.id === "script" ? data.node.metrics : [];
  const bodyMetrics =
    data.node.id === "script" || HIDDEN_METRIC_NODE_IDS.includes(data.node.id)
      ? []
      : data.node.metrics;
  const showStatusChip = data.node.status !== "ready" && !useCompactHeader;
  const statusLabel =
    data.node.status === "warning"
      ? "注意"
      : data.node.status === "pending"
        ? "处理中"
        : "待处理";
  const showPreviewChrome = !UNFRAMED_PREVIEW_NODE_IDS.includes(data.node.id);
  const isStageEntryBlocked = (data.node.id === "remotionProduction" || data.node.id === "workbench")
    && !data.node.remotionSummary?.chapterReady;
  // 节点卡只挂在分镜阶段 tab 上:targetStage=storyboard 的「进入」恒为同阶段空操作,
  // 渲染出来只会让用户点了没反应(2026-08-22 用户实证),藏掉
  const isStageEntryNoop = data.node.targetStage === "storyboard";
  // 节点卡「一键生图」批量入口:与分镜面板共用同一 hook 实例,
  // 已生成分镜自动跳过;旧的「跳转首个未生成镜」单镜入口已被本入口取代
  const storyboardBatch = data.storyboardBatch;
  const storyboardUpscale = data.storyboardUpscale;
  const previewContent =
    data.node.previewKind === "table" ? (
      <StoryboardTablePreview node={data.node} />
    ) : data.node.previewKind === "storyboard-grid" ? (
      <StoryboardGridPreview
        node={data.node}
        onOpenImageWorkflow={data.onOpenAssetImageWorkflow}
        onOpenStoryboardPanel={
          data.onStageChange ? () => data.onStageChange?.("storyboardPanel") : undefined
        }
      />
    ) : data.node.previewKind === "asset-derivation" ? (
      <AssetDerivationPreview
        node={data.node}
        onOpenAssetImageWorkflow={data.onOpenAssetImageWorkflow}
      />
    ) : data.node.previewKind === "workbench-lanes" ? (
      <WorkbenchLanePreview node={data.node} />
    ) : data.node.previewKind === "remotion-shots" ? (
      <RemotionShotPreview
        node={data.node}
        onOpenShotPanel={data.onStageChange ? () => data.onStageChange?.("workbench") : undefined}
      />
    ) : (
      <TextPreview node={data.node} />
    );
  const runNodeAction = useCallback(
    async (action: ProductionFlowNodeAction) => {
      if (action.disabled || runningActionId) return;
      setRunningActionId(action.id);
      try {
        await data.onNodeAction?.({
          ...action,
          userInstruction:
            action.showPromptInput === false
              ? ""
              : (actionInputs[action.id] ?? "").trim(),
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
        // contain:样式重算关进本卡(2026-08-26 trace:拖拽每步全树 UpdateLayoutTree×4)
        "[contain:layout_style]",
        "production-flow-node-card group rounded-md border p-4 text-left text-card-foreground outline-none",
        "hover:border-primary/55",
        NODE_SIZE_CLASS[data.node.id as ProductionFlowNodeId] ?? 'w-[640px]',
        data.node.status === "ready" && "border-success/30",
        data.node.status === "warning" && "border-warning/40",
        data.node.status === "pending" && "border-primary/35",
        data.node.status === "empty" && "border-border",
      )}
    >
      <Handle
        type="target"
        id={`${data.node.id}-target`}
        position={targetPosition}
        className="!h-2.5 !w-2.5 !border !border-primary/70 !bg-primary/20"
      />
      <Handle
        type="source"
        id={`${data.node.id}-source`}
        position={sourcePosition}
        className="!h-2.5 !w-2.5 !border !border-primary/70 !bg-primary/20"
      />
      {data.node.id === "script" ? (
        <Handle
          type="source"
          id="script-assets-source"
          position={sourcePosition === Position.Bottom ? Position.Right : Position.Bottom}
          className="!h-2.5 !w-2.5 !border !border-primary/70 !bg-primary/20"
        />
      ) : null}
      <div className="workflow-node-titlebar flex cursor-grab items-start justify-between gap-3 active:cursor-grabbing">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted/35 text-card-foreground">
            <Icon className="h-4 w-4" />
          </span>
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-sm font-semibold text-card-foreground">
              {data.node.label}
            </span>
            {titleMetrics.map((metric) => (
              <span
                key={metric}
                className="shrink-0 text-xs font-medium text-muted-foreground"
              >
                {metric}
              </span>
            ))}
          </span>
        </div>
        <div className="nodrag nopan flex shrink-0 flex-wrap items-center gap-2">
          {canOpenJson ? (
            <button
              type="button"
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-muted/35 px-2 text-[11px] font-medium text-card-foreground hover:border-primary/45 hover:bg-muted/12"
              onClick={(event) => {
                event.stopPropagation();
                data.onNodeJson?.(data.node.id);
              }}
            >
              {data.node.id === "storyboard" ? "Remotion JSON" : "Remotion 分镜源数据"}
              <Braces className="h-3 w-3" />
            </button>
          ) : null}
          {showStatusChip ? (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                data.node.status === "warning" && "bg-warning/15 text-warning/80",
                data.node.status === "pending" && "bg-primary/15 text-primary/80",
                data.node.status === "empty" && "bg-muted text-muted-foreground",
              )}
            >
              {statusLabel}
            </span>
          ) : null}
          {canEditNode ? (
            <button
              type="button"
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-muted/35 px-2 text-[11px] font-medium text-card-foreground hover:border-primary/45 hover:bg-primary/12"
              onClick={(event) => {
                event.stopPropagation();
                data.onNodeEdit?.(data.node.id);
              }}
            >
              编辑
              <Edit3 className="h-3 w-3" />
            </button>
          ) : null}
          {!isStageEntryNoop ? (
            <button
              type="button"
              disabled={isStageEntryBlocked}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-muted/35 px-2 text-[11px] font-medium text-card-foreground hover:border-primary/45 hover:bg-muted/12"
              onClick={(event) => {
                event.stopPropagation();
                data.onStageChange(data.node.targetStage);
              }}
            >
              进入
              <ArrowRight className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      </div>
      {data.node.status !== "ready" && !useCompactHeader ? (
        <p className="mt-4 text-xs leading-5 text-muted-foreground">
          {data.node.description}
        </p>
      ) : null}
      {bodyMetrics.length ? (
        <div className="mt-3 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          {bodyMetrics.map((metric, index) => (
            <span key={metric} className="inline-flex items-center gap-2">
              {index > 0 ? (
                <span className="text-muted-foreground/45">·</span>
              ) : null}
              <span>{metric}</span>
            </span>
          ))}
        </div>
      ) : null}
      <div
        className={cn(
          "mt-4",
          showPreviewChrome && "rounded-md border border-border bg-muted/20 p-3",
        )}
      >
        {showPreviewChrome ? (
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-card-foreground">
              {data.node.previewTitle}
            </span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              FLOWDATA
            </span>
          </div>
        ) : null}
        {previewContent}
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
              className={cn(
                "rounded-md border border-primary/15 bg-primary/20/[0.055] p-2.5",
                runningActionId === action.id &&
                  "border-primary/45 bg-primary/20/[0.105]",
              )}
              aria-busy={runningActionId === action.id}
            >
              {(() => {
                const isRunning = runningActionId === action.id;
                const isDisabled = Boolean(action.disabled || runningActionId);
                const acceptsPromptInput = action.showPromptInput !== false;
                return (
                  <>
                    {acceptsPromptInput ? (
                      <textarea
                        value={actionInputs[action.id] ?? ""}
                        disabled={isDisabled}
                        placeholder={action.promptPlaceholder ?? "给 AI 补充本节点生成要求..."}
                        className={cn(
                          "min-h-[64px] w-full resize-none rounded border border-border bg-background/65 px-2.5 py-2 text-xs leading-5 text-foreground outline-none placeholder:text-muted-foreground",
                          "focus:border-primary/55 focus:bg-background",
                          isDisabled && "cursor-not-allowed opacity-55",
                        )}
                        onChange={(event) =>
                          setActionInputs((current) => ({
                            ...current,
                            [action.id]: event.target.value,
                          }))
                        }
                      />
                    ) : null}
                    <div className={cn("flex items-center gap-2", acceptsPromptInput ? "mt-2 justify-between" : "justify-end")}>
                      {acceptsPromptInput ? (
                        <span className="text-[10px] text-muted-foreground">
                          {action.disabled
                            ? "请先完成上游节点"
                            : isRunning
                              ? "任务已提交，正在等待 AI 返回"
                              : "输入内容会附加到本次 AI 任务"}
                        </span>
                      ) : null}
                      {isRunning ? (
                        <div
                          role="status"
                          className="inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-primary/45 bg-primary/18 px-3 text-xs font-semibold text-primary/80"
                        >
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          正在生成中，请稍候
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={isDisabled}
                          className={cn(
                            "inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-primary/30 bg-primary/12 px-3 text-xs font-medium text-primary/80",
                            "hover:border-primary/60 hover:bg-primary/18",
                            isDisabled &&
                              "cursor-not-allowed border-border bg-muted/30 text-muted-foreground hover:border-border hover:bg-muted/30",
                          )}
                          onClick={() => void runNodeAction(action)}
                        >
                          <Clapperboard className="h-3.5 w-3.5" />
                          {action.label}
                        </button>
                      )}
                    </div>
                    {isRunning ? (
                      <div className="mt-2 rounded-md border border-primary/20 bg-background/45 px-2.5 py-2 text-[11px] leading-5 text-primary/80">
                        本节点正在生成，完成后会自动写回当前节点。生成期间不能重复提交。
                      </div>
                    ) : null}
                  </>
                );
              })()}
            </div>
          ))}
        </div>
      ) : null}
      {/* 批量动作 footer: 一键生图/一键超分置于节点卡最底(2026-08-25 布局裁定) */}
      <div className="nodrag nopan mt-3 flex flex-wrap items-center gap-2">
        {data.node.id === "storyboard" && storyboardBatch ? (
            storyboardBatch.state.running ? (
              <span
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-paid/30 bg-paid/10 px-2 text-[11px] font-medium text-paid/80"
                data-storyboard-node-batch-running
              >
                <Loader2 className="h-3 w-3 animate-spin" />
                一键生图 {storyboardBatch.state.done}/{storyboardBatch.state.total}
                <button
                  type="button"
                  className="ml-0.5 inline-flex items-center gap-1 rounded-md border-border text-[11px] text-muted-foreground hover:text-foreground"
                  title="当前分镜完成后停止"
                  onClick={(event) => {
                    event.stopPropagation();
                    storyboardBatch.stop();
                  }}
                >
                  停止
                </button>
              </span>
            ) : (
              <button
                type="button"
                className={cn(
                  buttonVariants({ variant: "paid" }),
                  "h-7 items-center gap-1.5 rounded-md px-2 text-[11px] [&_svg]:size-3",
                )}
                data-storyboard-node-batch-generate
                title="一键生图:串行生成所有未生成分镜,已生成的自动跳过"
                onClick={(event) => {
                  event.stopPropagation();
                  storyboardBatch.start();
                }}
              >
                一键生图
                <ImageIcon className="h-3 w-3" />
              </button>
            )
          ) : null}
          {data.node.id === "storyboard" && storyboardUpscale ? (
            storyboardUpscale.state.running ? (
              <span
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2 text-[11px] font-medium text-primary/80"
                data-storyboard-node-upscale-running
              >
                <Loader2 className="h-3 w-3 animate-spin" />
                一键超分 {storyboardUpscale.state.done}/{storyboardUpscale.state.total}
                <button
                  type="button"
                  className="ml-0.5 inline-flex items-center gap-1 rounded-md border-border text-[11px] text-muted-foreground hover:text-foreground"
                  title="当前分镜完成后停止"
                  onClick={(event) => {
                    event.stopPropagation();
                    storyboardUpscale.stop();
                  }}
                >
                  停止
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-muted/35 px-2 text-[11px] font-medium text-card-foreground hover:border-primary/45 hover:bg-muted/12"
                data-storyboard-node-batch-upscale
                title="一键超分:把所有分镜图本地超分到 4K(x4)并换轨到超分产物;已超分的自动跳过(重生成的新图会自动补超分)"
                onClick={(event) => {
                  event.stopPropagation();
                  storyboardUpscale.start();
                }}
              >
                一键超分
                {storyboardUpscale.upscaledCount ? ` · 已4K ${storyboardUpscale.upscaledCount}/${storyboardUpscale.shotCount ?? 0}` : ""}
                <ZoomIn className="h-3 w-3" />
              </button>
            )
          ) : null}
          
      </div>
    </div>
  );
});

function NodeSkillDisclosure({ node }: { node: ProductionFlowNodeModel }) {
  const skills = node.skills?.length ? node.skills : node.skill ? [node.skill] : [];
  if (!skills.length) return null;
  return (
    <details className="nodrag nopan nowheel mt-3 rounded-md border border-border bg-muted/20">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs text-card-foreground">
        <span className="min-w-0 truncate">
          生成依据 · {skills.length} 项
        </span>
        <span className="shrink-0 rounded border border-border bg-muted/30 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          SKILLS
        </span>
      </summary>
      <div className="space-y-2 border-t border-border px-3 py-2">
        <div className="text-[10px] text-muted-foreground">
          默认收起，展开查看本节点运行时使用的执行 skill、视觉风格、题材规则和通用技法。
        </div>
        {skills.map((skill) => (
          <div
            key={skill.id}
            className="rounded border border-border bg-background/45 px-2.5 py-2"
          >
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
              <span className="rounded bg-muted/40 px-1.5 py-0.5 text-card-foreground">
                {skill.name}
              </span>
              <span className="rounded bg-muted/40 px-1.5 py-0.5">
                {skill.source}
              </span>
              <span className="rounded bg-muted/40 px-1.5 py-0.5">
                {skill.id}
              </span>
            </div>
            <div className="max-h-[150px] space-y-1 overflow-y-auto pr-1 text-[11px] leading-5 text-muted-foreground [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/25 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5">
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
