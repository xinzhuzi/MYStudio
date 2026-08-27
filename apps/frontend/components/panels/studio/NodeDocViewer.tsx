// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { Fragment } from "react";
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

/** 分镜表渲染——与剧本分镜表同源 8 列全量展示(序号/画面描述/时长/景别/运镜/
 * 台词/音效/出镜语义),按「场」分组。用户裁定:内容不许缺列、必须可左右滑动。 */
function TableRender({ node }: { node: ProductionFlowNodeModel }) {
  const rows = node.tableRows ?? [];
  if (!rows.length) return <p className="text-sm text-muted-foreground">暂无分镜表数据</p>;
  /* 舒适固定列宽合计(~1880px)必然超出弹窗内容区 → overflow-auto 恒有横向滚动;
     序号列窄格冻结(sticky left)保住行归属,表头吸顶。 */
  const headCls = "sticky top-0 z-10 border-b-2 border-border bg-card px-3 py-2.5";
  return (
    <table className="w-full min-w-[1880px] border-collapse text-[13px] leading-6">
      <thead>
        <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <th className="sticky left-0 top-0 z-20 w-12 border-b-2 border-r border-border bg-card px-2 py-2.5 text-center">序号</th>
          <th className={`${headCls} w-[400px]`}>画面描述</th>
          <th className={`${headCls} w-[60px] text-center`}>时长</th>
          <th className={`${headCls} w-[76px]`}>景别</th>
          <th className={`${headCls} w-[104px]`}>运镜</th>
          <th className={`${headCls} w-[300px]`}>台词</th>
          <th className={`${headCls} w-[270px]`}>音效</th>
          <th className={`${headCls} w-[430px]`}>出镜语义（角色/道具/承接）</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const sceneHeader =
            row.scene && row.scene !== rows[i - 1]?.scene ? (
              <tr key={`scene-${row.scene}-${row.index}`} className="bg-muted/30">
                <td colSpan={8} className="border-y border-border/40 px-3 py-2 text-[12px] font-semibold text-foreground">
                  {row.scene}
                  {row.associateAssetsNames.length ? (
                    <span className="ml-2 font-normal text-muted-foreground">
                      参演资产：{row.associateAssetsNames.join("、")}
                    </span>
                  ) : null}
                </td>
              </tr>
            ) : null;
          const semantics = row.shotSemantics;
          return (
            <Fragment key={row.index ?? i}>
              {sceneHeader}
              <tr className={`border-b border-border/30 ${i % 2 === 1 ? "bg-muted/15" : ""} hover:bg-primary/5`}>                <td className="sticky left-0 z-[1] border-r border-border/50 bg-card px-2 py-3 text-center font-mono text-[12px] text-muted-foreground">{row.index ?? i + 1}</td>
                <td className="px-3 py-3 text-foreground">{row.description || "—"}</td>
                <td className="px-3 py-3 text-center font-mono text-muted-foreground">{row.duration ? `${row.duration}s` : "—"}</td>
                <td className="px-3 py-3 text-muted-foreground">{row.shotSize || "—"}</td>
                <td className="px-3 py-3 text-muted-foreground">{row.cameraMove || "—"}</td>
                <td className="px-3 py-3 text-muted-foreground">{row.lines || "—"}</td>
                <td className="px-3 py-3 text-muted-foreground">{row.sound || "—"}</td>
                <td className="px-3 py-3">
                  {semantics ? (
                    <SemanticsCell semantics={semantics} />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            </Fragment>
          );
        })}
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
      <p>
        <span className="text-foreground/80">视角</span> {s.sceneViewpointId}
        {s.personFree ? <span className="ml-1 rounded bg-muted/60 px-1 text-[10px]">无人出镜</span> : null}
      </p>
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
