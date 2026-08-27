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

/** 分镜表渲染——15 列契约全部平铺为直观列(用户裁定 2026-08-27 晚:
 * 场景/关联资产ID 也做成列,不要分组行等复杂布局;缺值显示"—")。
 * 序号冻结+表头吸顶+横向滚动保留。 */
function TableRender({ node }: { node: ProductionFlowNodeModel }) {
  const rows = node.tableRows ?? [];
  if (!rows.length) return <p className="text-sm text-muted-foreground">暂无分镜表数据</p>;
  type Row = (typeof rows)[number];

  /* 列定义:has=数据存在性判定(序号/画面描述/时长/景别/运镜/台词/音效恒显,
     其余列任一行有值即显示)。8 列变体里 action=description 去重后不展示。 */
  const columns: {
    key: string;
    label: string;
    cls: string;
    has: boolean;
    cell: (row: Row) => React.ReactNode;
  }[] = [
    {
      key: "index", label: "序号", cls: "w-12 text-center", has: true,
      cell: (row) => <span className="font-mono text-[12px] text-muted-foreground">{row.index}</span>,
    },
    {
      key: "description", label: "画面描述", cls: "w-[380px]", has: true,
      cell: (row) => <span className="text-foreground">{row.description || "—"}</span>,
    },
    {
      key: "scene", label: "场景", cls: "w-[120px]", has: true,
      cell: (row) => <span className="text-muted-foreground">{row.scene || "—"}</span>,
    },
    {
      key: "assets", label: "关联资产", cls: "w-[220px]", has: true,
      cell: (row) => <span className="text-muted-foreground">{row.associateAssetsNames.join("、") || "—"}</span>,
    },
    {
      key: "duration", label: "时长", cls: "w-[60px] text-center", has: true,
      cell: (row) => <span className="font-mono text-muted-foreground">{row.duration ? `${row.duration}s` : "—"}</span>,
    },
    {
      key: "shotSize", label: "景别", cls: "w-[76px]", has: true,
      cell: (row) => <span className="text-muted-foreground">{row.shotSize || "—"}</span>,
    },
    {
      key: "cameraMove", label: "运镜", cls: "w-[104px]", has: true,
      cell: (row) => <span className="text-muted-foreground">{row.cameraMove || "—"}</span>,
    },
    {
      key: "action", label: "角色动作", cls: "w-[300px]", has: rows.some((r) => r.action && r.action !== r.description),
      cell: (row) => <span className="text-muted-foreground">{row.action || "—"}</span>,
    },
    {
      key: "orientation", label: "朝向", cls: "w-[110px]", has: rows.some((r) => r.orientation && r.orientation !== "—"),
      cell: (row) => <span className="text-muted-foreground">{row.orientation || "—"}</span>,
    },
    {
      key: "spatialRelation", label: "空间关系", cls: "w-[140px]", has: rows.some((r) => r.spatialRelation && r.spatialRelation !== "—"),
      cell: (row) => <span className="text-muted-foreground">{row.spatialRelation || "—"}</span>,
    },
    {
      key: "emotion", label: "情绪", cls: "w-[110px]", has: rows.some((r) => r.emotion && r.emotion !== "—"),
      cell: (row) => <span className="text-muted-foreground">{row.emotion || "—"}</span>,
    },
    {
      key: "lines", label: "台词", cls: "w-[280px]", has: true,
      cell: (row) => <span className="text-muted-foreground">{row.lines || "—"}</span>,
    },
    {
      key: "sound", label: "音效", cls: "w-[260px]", has: true,
      cell: (row) => <span className="text-muted-foreground">{row.sound || "—"}</span>,
    },
    {
      key: "assetIds", label: "关联资产ID", cls: "w-[240px]", has: true,
      cell: (row) => <span className="break-all font-mono text-[11px] text-muted-foreground">{row.associateAssetsIds.join("、") || "—"}</span>,
    },
    {
      key: "semantics", label: "出镜语义（角色/道具/承接）", cls: "w-[420px]", has: rows.some((r) => r.shotSemantics),
      cell: (row) => (row.shotSemantics ? <SemanticsCell semantics={row.shotSemantics} /> : <span className="text-muted-foreground">—</span>),
    },
  ];
  const visible = columns.filter((column) => column.has);
  /* 舒适固定列宽合计必然超出弹窗内容区 → overflow-auto 恒有横向滚动;
     序号列窄格冻结(sticky left)保住行归属,表头吸顶。 */
  const headCls = "sticky top-0 z-10 border-b-2 border-border bg-card px-3 py-2.5";
  return (
    <table className="w-full min-w-[1880px] border-collapse text-[13px] leading-6">
      <thead>
        <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {visible.map((column, colIndex) =>
            colIndex === 0 ? (
              <th key={column.key} className="sticky left-0 top-0 z-20 border-b-2 border-r border-border bg-card px-2 py-2.5 text-center">
                {column.label}
              </th>
            ) : (
              <th key={column.key} className={`${headCls} ${column.cls}`}>{column.label}</th>
            ),
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
            <tr key={row.index ?? i} className={`border-b border-border/30 ${i % 2 === 1 ? "bg-muted/15" : ""} hover:bg-primary/5`}>
              {visible.map((column, colIndex) =>
                colIndex === 0 ? (
                  <td key={column.key} className="sticky left-0 z-[1] border-r border-border/50 bg-card px-2 py-3 text-center">
                    {column.cell(row)}
                  </td>
                ) : (
                  <td key={column.key} className="px-3 py-3 align-top">{column.cell(row)}</td>
                ),
              )}
            </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 出镜语义单元格:把 JSON 渲染成人能读的结构(角色/道具/承接/转场) */
function SemanticsCell({ semantics }: { semantics: NonNullable<ProductionFlowNodeModel["tableRows"]>[number]["shotSemantics"] }) {
  const s = semantics;
  if (!s) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="text-[11px] leading-4 text-muted-foreground">
      {s.personFree ? <p className="rounded bg-muted/60 px-1 text-[10px]">无人出镜</p> : null}
      {s.visibleCharacters?.map((character) => (
        <p key={character.name}>
          <span className="text-foreground/80">{character.name}</span>
          （{character.position}·{character.orientation}）：{character.actionIn} → {character.actionOut}
        </p>
      ))}
      {s.visibleProps?.map((prop) => (
        <p key={prop.name}>
          <span className="text-foreground/80">{prop.name}</span>（{prop.position}）：{prop.state}
        </p>
      ))}
      {s.actionIn || s.actionOut ? (
        <p>
          <span className="text-foreground/80">本镜承接</span> {s.actionIn} → {s.actionOut}
        </p>
      ) : null}
      {s.transitionToNext ? (
        <p>
          <span className="text-foreground/80">转场</span> {s.transitionToNext.styleWord}
          {s.transitionToNext.moodWord ? `（${s.transitionToNext.moodWord}）` : ""}
        </p>
      ) : null}
    </div>
  );
}
