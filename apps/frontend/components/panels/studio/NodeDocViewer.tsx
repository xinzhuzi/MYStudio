// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { Edit3, X } from "lucide-react";
import { MdPreview } from "md-editor-rt";
import "md-editor-rt/lib/style.css";
import type { ProductionFlowNodeModel } from "./workflow-node-model";

/**
 * NodeDocViewer——文档型节点的格式化阅读视图(非编辑器)。
 * 用户裁定(2026-08-27):「分镜表与导演规划的展示,需要是一个正常的展示
 * 界面,而不是编辑界面」。只读渲染 markdown/表格 + 生成依据;编辑走
 * 单独的「编辑」按钮打开 WorkflowNodeEditDialog。
 */
export function NodeDocViewer({
  node,
  onClose,
  onEdit,
}: {
  node: ProductionFlowNodeModel;
  onClose: () => void;
  onEdit?: (nodeId: import("./workflow-node-model").ProductionFlowNodeId) => void;
}) {
  const markdown = node.previewKind === "table"
    ? buildTableMarkdown(node)
    : buildDocMarkdown(node);
  const skills = node.skills ?? [];
  const isTable = node.previewKind === "table";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
      data-node-doc-viewer={node.id}
    >
      <div className="flex h-[85vh] w-[88vw] max-w-[1000px] flex-col overflow-hidden rounded-xl border border-border bg-card">
        {/* 头部 */}
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-foreground">{node.label}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{node.description}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {onEdit ? (
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-muted/30 px-3 text-xs font-medium text-card-foreground hover:border-primary/50"
                onClick={() => {
                  onClose();
                  onEdit(node.id);
                }}
              >
                <Edit3 className="h-3 w-3" />
                编辑
              </button>
            ) : null}
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-muted/30 text-muted-foreground hover:text-foreground"
              onClick={onClose}
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* 生成依据 */}
        {skills.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-border/70 bg-muted/10 px-5 py-2">
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

        {/* 内容区 */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
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
      </div>
    </div>
  );
}

/** 分镜表渲染:结构化表格(序号/画面描述/台词等列) */
function TableRender({ node }: { node: ProductionFlowNodeModel }) {
  const rows = node.tableRows ?? [];
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">暂无分镜表数据</p>;
  }
  const columns = [
    { key: "index", label: "序号", width: "w-12" },
    { key: "title", label: "画面", width: "flex-1" },
    { key: "shotSize", label: "景别", width: "w-16" },
    { key: "cameraMove", label: "运镜", width: "w-16" },
    { key: "lines", label: "台词", width: "w-40" },
    { key: "duration", label: "时长", width: "w-14" },
  ] as const;
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/20 text-muted-foreground">
            {columns.map((col) => (
              <th key={col.key} className={`px-3 py-2 text-left font-medium ${col.width}`}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {rows.map((row, i) => (
            <tr
              key={row.index ?? i}
              className="text-card-foreground hover:bg-muted/10"
            >
              <td className="px-3 py-2 text-muted-foreground">{row.index ?? i + 1}</td>
              <td className="px-3 py-2">
                <p className="line-clamp-2 text-foreground">{row.title}</p>
                {row.description ? (
                  <p className="mt-0.5 line-clamp-1 text-[10px] text-muted-foreground">{row.description}</p>
                ) : null}
              </td>
              <td className="px-3 py-2 text-muted-foreground">{row.shotSize || "—"}</td>
              <td className="px-3 py-2 text-muted-foreground">{row.cameraMove || "—"}</td>
              <td className="px-3 py-2 text-muted-foreground">
                <p className="line-clamp-2">{row.lines || "—"}</p>
              </td>
              <td className="px-3 py-2 text-muted-foreground">{row.duration ? `${row.duration}s` : "—"}</td>
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

/** 从 tableRows 构建 markdown(备用,TableRender 优先) */
function buildTableMarkdown(node: ProductionFlowNodeModel): string {
  const rows = node.tableRows ?? [];
  if (!rows.length) return "暂无分镜表数据";
  return rows
    .map((row) => `**${row.index}. ${row.title}** ${row.shotSize ? `(${row.shotSize})` : ""}\n${row.description || ""}\n> ${row.lines || ""}`)
    .join("\n\n");
}
