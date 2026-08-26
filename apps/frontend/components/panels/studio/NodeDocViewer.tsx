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
import type { ProductionFlowNodeModel, ProductionFlowNodeId } from "./workflow-node-model";

/**
 * NodeDocViewer——文档型节点的格式化阅读视图。
 * 全仓统一 Dialog 尺寸,干净排版:标题区 → 生成依据行 → 内容滚动区。
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
      <DialogContent className="flex h-[88vh] max-w-[92vw] flex-col gap-0 border-border bg-card p-0 text-card-foreground sm:max-w-[92vw]">
        {/* 标题区 */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-lg font-semibold">{node.label}</DialogTitle>
            <p className="mt-1 text-xs leading-4 text-muted-foreground">{node.description}</p>
            {skills.length > 0 ? (
              <div className="mt-2 flex flex-wrap items-center gap-1">
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                  依据
                </span>
                {skills.map((skill) => (
                  <span
                    key={skill.id}
                    title={`${skill.name} (${skill.source})`}
                    className="rounded-sm bg-muted/50 px-1.5 py-0.5 text-[10px] leading-4 text-muted-foreground"
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
              onClick={() => {
                onClose();
                onEdit(node.id);
              }}
            >
              <Edit3 className="h-3 w-3" />
              编辑
            </Button>
          ) : null}
        </div>

        {/* 内容区 */}
        <div className={`min-h-0 flex-1 px-8 py-6 ${isTable ? "overflow-auto" : "overflow-y-auto"}`}>
          {isTable ? (
            <TableRender node={node} />
          ) : (
            <div className="mx-auto max-w-3xl">
              <MdPreview
                modelValue={markdown}
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

/** 分镜表渲染:干净表格,交替行色,宽松间距 */
function TableRender({ node }: { node: ProductionFlowNodeModel }) {
  const rows = node.tableRows ?? [];
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">暂无分镜表数据</p>;
  }
  const cols = [
    { label: "序号", cls: "w-12 text-center" },
    { label: "画面", cls: "min-w-[200px]" },
    { label: "景别", cls: "w-16" },
    { label: "运镜", cls: "w-20" },
    { label: "角色动作", cls: "min-w-[120px]" },
    { label: "台词", cls: "min-w-[180px]" },
    { label: "时长", cls: "w-14 text-center" },
  ] as const;
  return (
    <table className="w-full min-w-[900px] border-collapse text-[12px] leading-5">
      <thead>
        <tr className="border-b-2 border-border text-left text-[11px] font-medium text-muted-foreground">
          {cols.map((col) => (
            <th key={col.label} className={`px-3 py-2.5 ${col.cls}`}>
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr
            key={row.index ?? i}
            className={`border-b border-border/40 ${i % 2 === 1 ? "bg-muted/10" : ""} hover:bg-muted/20`}
          >
            <td className="px-3 py-2.5 text-center text-muted-foreground">{row.index ?? i + 1}</td>
            <td className="px-3 py-2.5">
              <p className="font-medium text-foreground">{row.title}</p>
              {row.description ? (
                <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{row.description}</p>
              ) : null}
            </td>
            <td className="px-3 py-2.5 text-muted-foreground">{row.shotSize || "—"}</td>
            <td className="px-3 py-2.5 text-muted-foreground">{row.cameraMove || "—"}</td>
            <td className="px-3 py-2.5 text-muted-foreground">{row.action || "—"}</td>
            <td className="px-3 py-2.5 text-muted-foreground">{row.lines || "—"}</td>
            <td className="px-3 py-2.5 text-center text-muted-foreground">{row.duration ? `${row.duration}s` : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function buildDocMarkdown(node: ProductionFlowNodeModel): string {
  return node.previewLines.join("\n").trim() || "暂无内容";
}
