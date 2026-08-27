// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { Edit3 } from "lucide-react";
import { MdPreview } from "md-editor-rt";
import "md-editor-rt/lib/style.css";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useStudioStore } from "@/stores/studio/studio-store";
import { buildStudioFlowData } from "@/lib/studio/studio-flow-data";
import type { ProductionFlowNodeModel, ProductionFlowNodeId } from "./workflow-node-model";

/**
 * NodeDocViewer——文档型节点的格式化阅读视图。
 * 从 store 取全量 markdown(非截断 previewLines),MdPreview 大字号排版。
 */
export function NodeDocViewer({
  node,
  onClose,
  onEdit,
}: {
  node: ProductionFlowNodeModel;
  onClose: () => void;
  onEdit?: (nodeId: ProductionFlowNodeId) => void;
}) {
  const state = useStudioStore();
  const flowData = buildStudioFlowData({
    agentWorkData: state.agentWorkData,
    entityExtractions: state.entityExtractions,
    scriptPlans: state.scriptPlans,
    storyboards: state.storyboards ?? [],
    productionTracks: state.productionTracks ?? [],
    videoCandidates: state.videoCandidates ?? [],
  });
  const isTable = node.previewKind === "table";
  const rawMarkdown = isTable ? flowData.storyboardTable : flowData.scriptPlan;
  // 剥掉 <scriptPlan>/<storyboardTable> 等数据包装标签(原始 TextPreview
  // 的 unwrapTaggedMarkdown 同款逻辑,否则标签会渲染为可见文本)
  const markdown = rawMarkdown?.replace(/<\/?(?:scriptPlan|storyboardTable)>\s*/g, "");
  const skills = node.skills ?? [];

  return (
    <Dialog open onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="flex h-[88vh] max-w-[92vw] flex-col gap-0 overflow-hidden border-border bg-card p-0 text-card-foreground sm:max-w-[92vw]">
        {/* 标题区 */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-8 py-5">
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-xl font-bold tracking-tight">{node.label}</DialogTitle>
            <p className="mt-1.5 text-sm text-muted-foreground">{node.description}</p>
            {skills.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {skills.map((skill) => (
                  <span
                    key={skill.id}
                    title={`${skill.name} (${skill.source})`}
                    className="rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                  >
                    {skill.name}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          {onEdit ? (
            <Button
              size="sm"
              variant="outline"
              className="mt-1 shrink-0 gap-1.5"
              onClick={() => { onClose(); onEdit(node.id); }}
            >
              <Edit3 className="h-3.5 w-3.5" />
              编辑
            </Button>
          ) : null}
        </div>

        {/* 内容区 */}
        <div className={`min-h-0 flex-1 ${isTable ? "overflow-auto" : "overflow-y-auto"} px-8 py-6`}>
          {isTable ? (
            <TableRender node={node} />
          ) : (
            <div className="mx-auto max-w-4xl [&_.md-editor-preview]:!px-0 [&_.md-editor-preview]:!text-[15px] [&_.md-editor-preview]:!leading-[1.8] [&_.md-editor-preview_h1]:!mb-6 [&_.md-editor-preview_h1]:!mt-2 [&_.md-editor-preview_h1]:!text-2xl [&_.md-editor-preview_h1]:!font-bold [&_.md-editor-preview_h2]:!mb-4 [&_.md-editor-preview_h2]:!mt-8 [&_.md-editor-preview_h2]:!text-xl [&_.md-editor-preview_h2]:!font-semibold [&_.md-editor-preview_h3]:!mb-3 [&_.md-editor-preview_h3]:!mt-6 [&_.md-editor-preview_h3]:!text-lg [&_.md-editor-preview_p]:!mb-4 [&_.md-editor-preview_ul]:!mb-4 [&_.md-editor-preview_li]:!mb-1.5 [&_.md-editor-preview_blockquote]:!my-4 [&_.md-editor-preview_blockquote]:!border-l-2 [&_.md-editor-preview_blockquote]:!border-primary/40 [&_.md-editor-preview_blockquote]:!pl-4 [&_.md-editor-preview_blockquote]:!text-muted-foreground [&_.md-editor-preview_strong]:!text-foreground [&_.md-editor-preview_hr]:!my-6">
              <MdPreview
                modelValue={markdown || "暂无内容"}
                theme="dark"
                previewTheme="github"
                codeTheme="github"
                className="md-editor-preview-transparent !bg-transparent text-foreground [&_.md-editor]:!bg-transparent [&_.md-editor-preview]:!bg-transparent [&_.md-editor-preview-wrapper]:!bg-transparent"
                style={{ background: "transparent" }}
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 分镜表渲染 */
function TableRender({ node }: { node: ProductionFlowNodeModel }) {
  const rows = node.tableRows ?? [];
  if (!rows.length) return <p className="text-sm text-muted-foreground">暂无分镜表数据</p>;
  const cols = [
    { label: "序号", cls: "w-12 text-center" },
    { label: "画面", cls: "w-[30%]" },
    { label: "景别", cls: "w-[7%]" },
    { label: "运镜", cls: "w-[8%]" },
    { label: "角色动作", cls: "w-[15%]" },
    { label: "台词", cls: "w-[26%]" },
    { label: "时长", cls: "w-[6%] text-center" },
  ] as const;
  return (
    /* 列宽按比例分配,默认 7 列全可见;min-w 只是窄窗口的地板——低于它才出现
       横向滚动(overflow-auto)。勿把 min-w 抬到弹窗内容宽之上强制横滚:
       那会让默认视图藏住右端列(1400px 视口下「时长」整列不可见)。 */
    <table className="w-full min-w-[960px] border-collapse text-[13px] leading-6">
      <thead>
        <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {cols.map((col) => (
            <th key={col.label} className={`sticky top-0 border-b-2 border-border bg-card px-4 py-3 ${col.cls}`}>{col.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={row.index ?? i} className={`border-b border-border/30 ${i % 2 === 1 ? "bg-muted/15" : ""} hover:bg-primary/5`}>
            <td className="px-4 py-3 text-center font-mono text-muted-foreground">{row.index ?? i + 1}</td>
            <td className="px-4 py-3">
              <p className="font-medium text-foreground">{row.title}</p>
              {row.description ? <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{row.description}</p> : null}
            </td>
            <td className="px-4 py-3 text-muted-foreground">{row.shotSize || "—"}</td>
            <td className="px-4 py-3 text-muted-foreground">{row.cameraMove || "—"}</td>
            <td className="px-4 py-3 text-muted-foreground">{row.action || "—"}</td>
            <td className="px-4 py-3 text-muted-foreground">{row.lines || "—"}</td>
            <td className="px-4 py-3 text-center font-mono text-muted-foreground">{row.duration ? `${row.duration}s` : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
