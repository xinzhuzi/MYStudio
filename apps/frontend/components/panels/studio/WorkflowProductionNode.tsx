import { useCallback, useState } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import {
  ArrowRight,
  Boxes,
  ClipboardList,
  Clapperboard,
  Edit3,
  FileText,
  Film,
  Loader2,
  Split,
  Table2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ImageWorkflowOpenContext } from "@/types/studio";
import type {
  ProductionFlowNodeAction,
  ProductionFlowNodeId,
  ProductionFlowNodeModel,
  ProductionFlowStage,
} from "./workflow-node-model";
import {
  AssetDerivationPreview,
  StoryboardGridPreview,
  StoryboardTablePreview,
  TextPreview,
  WorkbenchLanePreview,
} from "./WorkflowNodePreviews";

export interface ProductionNodeData extends Record<string, unknown> {
  node: ProductionFlowNodeModel;
  onStageChange: (stage: ProductionFlowStage) => void;
  onNodeEdit?: (nodeId: ProductionFlowNodeId) => void;
  onNodeAction?: (action: ProductionFlowNodeAction) => void | Promise<void>;
  onOpenAssetImageWorkflow?: (context: ImageWorkflowOpenContext) => void;
}

const NODE_ICONS = {
  script: FileText,
  scriptPlan: ClipboardList,
  assets: Boxes,
  storyboardTable: Table2,
  storyboard: Split,
  workbench: Film,
} satisfies Record<ProductionFlowNodeId, typeof FileText>;

const NODE_SIZE_CLASS = {
  script: "w-[1040px]",
  scriptPlan: "w-[680px]",
  assets: "w-[760px]",
  storyboardTable: "w-[700px]",
  storyboard: "w-[640px]",
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

export function ProductionFlowNode({ data }: NodeProps<Node<ProductionNodeData>>) {
  const Icon = NODE_ICONS[data.node.id];
  const [actionInputs, setActionInputs] = useState<Record<string, string>>({});
  const [runningActionId, setRunningActionId] = useState<string | null>(null);
  const canEditNode = Boolean(
    data.onNodeEdit && WRITABLE_NODE_IDS.includes(data.node.id),
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
  const previewContent =
    data.node.previewKind === "table" ? (
      <StoryboardTablePreview node={data.node} />
    ) : data.node.previewKind === "storyboard-grid" ? (
      <StoryboardGridPreview
        node={data.node}
        onOpenImageWorkflow={data.onOpenAssetImageWorkflow}
      />
    ) : data.node.previewKind === "asset-derivation" ? (
      <AssetDerivationPreview
        node={data.node}
        onOpenAssetImageWorkflow={data.onOpenAssetImageWorkflow}
      />
    ) : data.node.previewKind === "workbench-lanes" ? (
      <WorkbenchLanePreview node={data.node} />
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
        "group rounded-md border bg-card/95 p-4 text-left text-card-foreground shadow-[0_24px_64px_rgba(0,0,0,0.32)] outline-none backdrop-blur transition",
        "hover:-translate-y-0.5 hover:border-sky-300/55 hover:shadow-[0_26px_72px_rgba(37,99,235,0.16)]",
        NODE_SIZE_CLASS[data.node.id],
        data.node.status === "ready" && "border-emerald-300/30",
        data.node.status === "warning" && "border-amber-300/40",
        data.node.status === "pending" && "border-sky-300/35",
        data.node.status === "empty" && "border-border",
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
        <div className="nodrag nopan flex shrink-0 items-center gap-2">
          {showStatusChip ? (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                data.node.status === "warning" && "bg-amber-300/15 text-amber-200",
                data.node.status === "pending" && "bg-sky-300/15 text-sky-200",
                data.node.status === "empty" && "bg-muted text-muted-foreground",
              )}
            >
              {statusLabel}
            </span>
          ) : null}
          {canEditNode ? (
            <button
              type="button"
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-muted/35 px-2 text-[11px] font-medium text-card-foreground hover:border-sky-300/45 hover:bg-sky-300/12"
              onClick={(event) => {
                event.stopPropagation();
                data.onNodeEdit?.(data.node.id);
              }}
            >
              编辑
              <Edit3 className="h-3 w-3" />
            </button>
          ) : null}
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-muted/35 px-2 text-[11px] font-medium text-card-foreground hover:border-sky-300/45 hover:bg-sky-300/12"
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
                "rounded-md border border-sky-300/15 bg-sky-300/[0.055] p-2.5",
                runningActionId === action.id &&
                  "border-sky-300/45 bg-sky-300/[0.105] shadow-[0_0_0_1px_rgba(125,211,252,0.16),0_14px_40px_rgba(14,165,233,0.12)]",
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
                          "focus:border-sky-300/55 focus:bg-background",
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
                          className="inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-sky-300/45 bg-sky-300/18 px-3 text-xs font-semibold text-sky-50 shadow-[0_0_22px_rgba(56,189,248,0.16)]"
                        >
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          正在生成中，请稍候
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={isDisabled}
                          className={cn(
                            "inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-sky-300/30 bg-sky-300/12 px-3 text-xs font-medium text-sky-100",
                            "hover:border-sky-200/60 hover:bg-sky-300/18",
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
                      <div className="mt-2 rounded-md border border-sky-300/20 bg-background/45 px-2.5 py-2 text-[11px] leading-5 text-sky-100">
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
    </div>
  );
}

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
