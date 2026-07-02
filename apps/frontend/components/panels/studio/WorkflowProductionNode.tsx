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
  Split,
  Table2,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
  scriptPlan: "w-[580px]",
  assets: "w-[760px]",
  storyboardTable: "w-[700px]",
  storyboard: "w-[640px]",
  workbench: "w-[680px]",
} satisfies Record<ProductionFlowNodeId, string>;

export function ProductionFlowNode({ data }: NodeProps<Node<ProductionNodeData>>) {
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
        ) : data.node.previewKind === "workbench-lanes" ? (
          <WorkbenchLanePreview node={data.node} />
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
