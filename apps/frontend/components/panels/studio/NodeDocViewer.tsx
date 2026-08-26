// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { Edit3 } from "lucide-react";
import { MdPreview } from "md-editor-rt";
import "md-editor-rt/lib/style.css";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ProductionFlowNodeModel, ProductionFlowNodeId } from "./workflow-node-model";

/**
 * NodeDocViewer——文档型节点的格式化阅读视图(非编辑器)。
 * 用户裁定(2026-08-27):「需要是一个正常的展示界面,而不是编辑界面」+
 * 「要是一个符合整个软件布局的弹窗,要宽大」。
 * 使用全仓统一 Dialog 组件(与 WorkflowNodeEditDialog 同款尺寸/风格)。
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
  const markdown = buildDocMarkdown(node);
  const skills = node.skills ?? [];
  const isTable = node.previewKind === "table";

  return (
    <Dialog open onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="flex h-[88vh] max-w-[92vw] flex-col gap-3 border-border bg-card text-card-foreground sm:max-w-[92vw]">
        <DialogHeader className="flex-row items-center justify-between space-y-0">
          <div className="min-w-0">
            <DialogTitle>{node.label}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {node.description}
            </DialogDescription>
          </div>
          {onEdit ? (
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 gap-1.5"
              onClick={() => {
                onClose();
                onEdit(node.id);
              }}
            >
              <Edit3 className="h-3 w-3" />
              编辑
            </Button>
          ) : null}
        </DialogHeader>

        {skills.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
            <span className="text-[11px] font-medium text-muted-foreground">
              生成依据 · {skills.length} 项
            </span>
            {skills.map((skill) => (
              <span
                key={skill.id}
                title={`${skill.name} (${skill.source})`}
                className="rounded bg-background/80 px-1.5 py-0.5 text-[10px] text-foreground"
              >
                {skill.name}
              </span>
            ))}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border/60 bg-background/30 p-5">
          {isTable ? (
            <TableRender node={node} />
          ) : (
            <MdPreview
              modelValue={markdown}
              theme="dark"
              previewTheme="github"
              codeTheme="github"
              className="md-editor-preview-transparent !bg-transparent text-foreground [&_.md-editor]:!bg-transparent [&_.md-editor-preview]:!bg-transparent [&_.md-editor-preview-wrapper]:!bg-transparent"
              style={{ background: "transparent" }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 分镜表渲染:结构化表格(序号/画面/景别/运镜/台词/时长列) */
function TableRender({ node }: { node: ProductionFlowNodeModel }) {
  const rows = node.tableRows ?? [];
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">暂无分镜表数据</p>;
  }
  const columns = [
    { key: "index", label: "序号", width: "w-14" },
    { key: "title", label: "画面", width: "flex-1" },
    { key: "shotSize", label: "景别", width: "w-16" },
    { key: "cameraMove", label: "运镜", width: "w-20" },
    { key: "action", label: "角色动作", width: "w-32" },
    { key: "lines", label: "台词", width: "w-48" },
    { key: "duration", label: "时长", width: "w-14" },
  ] as const;
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/20 text-muted-foreground">
            {columns.map((col) => (
              <th key={col.key} className={`px-3 py-2.5 text-left font-medium ${col.width}`}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {rows.map((row, i) => (
            <tr key={row.index ?? i} className="text-card-foreground hover:bg-muted/10">
              <td className="px-3 py-2.5 text-muted-foreground">{row.index ?? i + 1}</td>
              <td className="px-3 py-2.5">
                <p className="font-medium text-foreground">{row.title}</p>
                {row.description ? (
                  <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-muted-foreground">{row.description}</p>
                ) : null}
              </td>
              <td className="px-3 py-2.5 text-muted-foreground">{row.shotSize || "—"}</td>
              <td className="px-3 py-2.5 text-muted-foreground">{row.cameraMove || "—"}</td>
              <td className="px-3 py-2.5 text-muted-foreground">
                <p className="line-clamp-2">{row.action || "—"}</p>
              </td>
              <td className="px-3 py-2.5 text-muted-foreground">
                <p className="line-clamp-2">{row.lines || "—"}</p>
              </td>
              <td className="px-3 py-2.5 text-muted-foreground">{row.duration ? `${row.duration}s` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 从 previewLines 构建 markdown(导演规划等纯文档节点) */
function buildDocMarkdown(node: ProductionFlowNodeModel): string {
  return node.previewLines.join("\n").trim() || "暂无内容";
}
