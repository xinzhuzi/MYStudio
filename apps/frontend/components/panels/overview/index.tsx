"use client";

/**
 * OverviewPanel — 项目概览（SeriesMeta 展示 + 内联编辑）
 *
 * 两栏布局：
 *   左栏：故事核心 + 世界观 + 制作设定
 *   右栏：角色列表 + 阵营 + 关键物品/地理
 */

import { useState, useCallback } from "react";
import { useScriptStore, useActiveScriptProject } from "@/stores/script/script-store";
import { useProjectStore } from "@/stores/project/project-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useMediaPanelStore } from "@/stores/navigation/media-panel-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  BookOpen,
  Globe,
  Users,
  MapPin,
  Gem,
  Shield,
  Settings2,
  ChevronRight,
  Plus,
  Trash2,
  ArrowRight,
  Workflow,
  SlidersHorizontal,
} from "lucide-react";
import type {
  SeriesMeta,
  ScriptCharacter,
  EpisodeRawScript } from "@/types/script";
import { getStyleName } from "@/lib/constants/visual-styles";
import {
  EditableText,
  FieldRow,
  NamedEntityList,
  SectionCard,
} from "./OverviewFields";
import { OVERVIEW_WORKFLOW_GUIDE } from "./workflow-guide";
import { OVERVIEW_STAGE_GUIDE } from "./stage-guide";
import { AuthorPreferenceDialog } from "./AuthorPreferenceDialog";
import { readSourceMemoryActionContext } from "@/lib/studio/source-memory";
import { OverviewAiFill } from "./OverviewAiFill";

/** 工作流门户区头部（两分支共用）：导览标题/摘要 + 进入工作流/查看资产库 CTA。 */
function WorkflowGuideHeader(props: { onPrimary: () => void; onSecondary: () => void }) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <h3 className="text-lg font-semibold text-foreground">
          {OVERVIEW_WORKFLOW_GUIDE.title}
        </h3>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
          {OVERVIEW_WORKFLOW_GUIDE.summary}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={props.onPrimary} className="gap-2">
          {OVERVIEW_WORKFLOW_GUIDE.primaryAction.label}
          <ArrowRight className="h-4 w-4" />
        </Button>
        <Button variant="outline" onClick={props.onSecondary} className="gap-2">
          {OVERVIEW_WORKFLOW_GUIDE.secondaryAction.label}
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/** 制作阶段说明卡（两分支共用）。阶段 id/label/icon 与工作流页 WORKFLOW_TABS 一致（见 stage-guide.ts）。 */
function StageGuideGrid(props: { onEnterStage: (stageId: string) => void }) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        <Workflow className="h-4 w-4 text-primary" />
        制作阶段
        <span className="text-xs font-normal text-muted-foreground">· 各阶段功能说明</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {OVERVIEW_STAGE_GUIDE.map((stage) => {
        const StageIcon = stage.Icon;
        return (
          <div
            key={stage.id}
            className="group relative flex flex-col justify-between rounded-xl border border-border bg-card/60 p-3.5 backdrop-blur-xl transition-all duration-200 hover:border-primary/50 hover:bg-card/80"
          >
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <StageIcon className="h-4 w-4 text-primary shrink-0" />
                  <span className="text-sm font-medium truncate">{stage.label}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2.5 text-xs shrink-0 gap-1 border-primary/20 hover:border-primary hover:bg-primary hover:text-primary-foreground transition-all duration-200"
                  onClick={() => props.onEnterStage(stage.id)}
                >
                  <span>进入阶段</span>
                  <ArrowRight className="h-3 w-3" />
                </Button>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                {stage.description}
              </p>
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}

// ==================== Main Component ====================

export function OverviewPanel() {
  const { activeProjectId } = useProjectStore();
  const scriptProject = useActiveScriptProject();
  const {
    updateSeriesMeta,
  } = useScriptStore();

const { setActiveTab } = useMediaPanelStore();

  const handleEnterStage = useCallback((stageId: string) => {
    useStudioStore.getState().setWorkflowConfig({ workflowStage: stageId });
    // 进入阶段 = 一次交互(用户裁定 2026-08-26):studio 面板全新挂载,阶段
    // 变化效应的首到豁免盖不住这条显式点击路径——这里直接关闸,静止 5s 后
    // 统一加载(与画布/面板同款倒计时提示)。
    setActiveTab("studio");
  }, [setActiveTab]);

  const projectId = activeProjectId ?? "";
  const meta: SeriesMeta | null = scriptProject?.seriesMeta || null;
  const episodes: EpisodeRawScript[] = scriptProject?.episodeRawScripts || [];

  // 作者偏好（应用级口味卡）编辑入口
  const [prefOpen, setPrefOpen] = useState(false);

  const update = useCallback(
    (updates: Partial<SeriesMeta>) => {
      updateSeriesMeta(projectId, updates);
    },
    [projectId, updateSeriesMeta],
  );

  // 角色区编辑:竖向列表的增删改,经 updateSeriesMeta 落盘
  const updateCharacterAt = useCallback(
    (index: number, changes: Partial<ScriptCharacter>) => {
      if (!meta) return;
      const next = meta.characters.map((c, i) => (i === index ? { ...c, ...changes } : c));
      update({ characters: next });
    },
    [meta, update],
  );
  const removeCharacterAt = useCallback(
    (index: number) => {
      if (!meta) return;
      update({ characters: meta.characters.filter((_, i) => i !== index) });
    },
    [meta, update],
  );
  const addCharacter = useCallback(() => {
    if (!meta) return;
    update({
      characters: [
        ...meta.characters,
        { id: `char-${Date.now()}`, name: "新角色" },
      ],
    });
  }, [meta, update]);

  // R2:AI 填充素材——只用记忆库(偏好→圣经→档案检索),复用管线注入链。
  // 08-18 裁定对齐:概览不引入章节内容,剧本正文不再作为素材。
  const buildFillContext = useCallback(async (): Promise<string | undefined> => {
    const memory = await readSourceMemoryActionContext({
      projectId,
      archiveQuery: `${meta?.title ?? ""}`.trim().slice(0, 200),
    });
    if (!memory.success) throw new Error(memory.error);
    return memory.context;
  }, [projectId, meta?.title]);

  if (!meta) {
    return (
      <div className="h-full">
        <ScrollArea className="h-full">
        <div className="mx-auto w-full max-w-[1600px] p-6">
        <div className="rounded-xl border bg-panel">
          <div className="border-b px-5 py-4">
            <div className="flex items-center justify-between gap-2">
              <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                <BookOpen className="h-3.5 w-3.5" />
                项目入口
              </div>
              {/* 应用级偏好入口不依赖项目元数据——无 seriesMeta 的项目同样可编辑 */}
              <Button variant="outline" size="sm" onClick={() => setPrefOpen(true)}>
                <SlidersHorizontal className="h-3.5 w-3.5" />
                作者偏好
              </Button>
            </div>
            <div className="mt-2">
              <WorkflowGuideHeader
                onPrimary={() =>
                  setActiveTab(OVERVIEW_WORKFLOW_GUIDE.primaryAction.targetTab)
                }
                onSecondary={() =>
                  setActiveTab(OVERVIEW_WORKFLOW_GUIDE.secondaryAction.targetTab)
                }
              />
            </div>
          </div>

          {/* 制作阶段说明 — 把工作流各阶段的功能讲清楚，让用户在进入
              工作流前就理解整条生产流水线。阶段 id/label/icon 与工作流
              页的 WORKFLOW_TABS 完全一致（见 stage-guide.ts）。 */}
          <div className="px-5 py-4">
            <StageGuideGrid onEnterStage={handleEnterStage} />
          </div>
        </div>
        </div>
        </ScrollArea>
        <AuthorPreferenceDialog open={prefOpen} onOpenChange={setPrefOpen} />
      </div>
    );
  }

  return (
    <div className="h-full">
      {/* 单一滚动整页：上部工作流门户卡 + 下部项目概览卡（与无 meta 导览分支同骨架同宽） */}
      <ScrollArea className="h-full">
        <div className="mx-auto w-full max-w-[1600px] space-y-4 p-6 pb-16">
          {/* 上部：工作流门户（排版裁定 08-18：工作流在上，元数据在下） */}
          <section className="rounded-xl border bg-panel">
            <div className="border-b px-5 py-4">
              <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                <BookOpen className="h-3.5 w-3.5" />
                项目入口
              </div>
              <div className="mt-2">
                <WorkflowGuideHeader
                  onPrimary={() =>
                    setActiveTab(OVERVIEW_WORKFLOW_GUIDE.primaryAction.targetTab)
                  }
                  onSecondary={() =>
                    setActiveTab(OVERVIEW_WORKFLOW_GUIDE.secondaryAction.targetTab)
                  }
                />
              </div>
            </div>
            <div className="px-5 py-4">
              <StageGuideGrid onEnterStage={handleEnterStage} />
            </div>
          </section>

          {/* 下部：项目概览（元数据卡） */}
          <section className="rounded-xl border bg-panel">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-4">
              <div className="flex min-w-0 items-center gap-2">
                <BookOpen className="h-4 w-4 shrink-0" />
                <h2 className="font-semibold text-sm">项目概览</h2>
                <span className="truncate text-xs text-muted-foreground">
                  《{meta.title}》
                  {meta.genre && (
                    <Badge variant="secondary" className="ml-1 text-[10px]">
                      {meta.genre}
                    </Badge>
                  )}
                  {meta.era && (
                    <Badge variant="outline" className="ml-1 text-[10px]">
                      {meta.era}
                    </Badge>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">
                  {episodes.length} 集 · {meta.characters.length} 角色 ·{" "}
                  {meta.factions?.length || 0} 阵营 · {meta.keyItems?.length || 0} 物品
                </span>
                <OverviewAiFill
                  meta={meta}
                  onApply={(updates) => update(updates)}
                  buildContext={buildFillContext}
                  onOpenPreference={() => setPrefOpen(true)}
                />
                <Button variant="outline" size="sm" onClick={() => setPrefOpen(true)}>
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  作者偏好
                </Button>
              </div>
            </div>
            <div className="p-5">
              {/* 元数据区:所有控件竖向排列(裁定 08-18:元数据内不横排) */}
              <div className="space-y-4">
              {/* 故事核心 */}
              <SectionCard icon={BookOpen} title="故事核心">
                <FieldRow label="标题">
                  <EditableText
                    value={meta.title}
                    placeholder="剧名"
                    onSave={(v) => update({ title: v })}
                  />
                </FieldRow>
                <FieldRow label="Logline">
                  <EditableText
                    value={meta.logline}
                    placeholder="一句话概括故事主线..."
                    onSave={(v) => update({ logline: v })}
                  />
                </FieldRow>
                <FieldRow label="大纲">
                  <EditableText
                    value={meta.outline}
                    placeholder="100-500字完整故事线..."
                    onSave={(v) => update({ outline: v })}
                    multiline
                  />
                </FieldRow>
                <FieldRow label="核心冲突">
                  <EditableText
                    value={meta.centralConflict}
                    placeholder="主线矛盾..."
                    onSave={(v) => update({ centralConflict: v })}
                  />
                </FieldRow>
                <FieldRow label="主题">
                  <div className="flex flex-wrap gap-1">
                    {meta.themes?.map((t, i) => (
                      <Badge
                        key={i}
                        variant="secondary"
                        className="text-[10px]"
                      >
                        {t}
                      </Badge>
                    ))}
                    {(!meta.themes || meta.themes.length === 0) && (
                      <span className="text-xs text-muted-foreground italic">
                        未设置主题标签
                      </span>
                    )}
                  </div>
                </FieldRow>
              </SectionCard>

              {/* 世界观 */}
              <SectionCard icon={Globe} title="世界观">
                <FieldRow label="时代">
                  <EditableText
                    value={meta.era}
                    placeholder="古代/现代/未来..."
                    onSave={(v) => update({ era: v })}
                  />
                </FieldRow>
                <FieldRow label="类型">
                  <EditableText
                    value={meta.genre}
                    placeholder="武侠/商战/爱情..."
                    onSave={(v) => update({ genre: v })}
                  />
                </FieldRow>
                <FieldRow label="时间线">
                  <EditableText
                    value={meta.timelineSetting}
                    placeholder="精确时间线设定..."
                    onSave={(v) => update({ timelineSetting: v })}
                  />
                </FieldRow>
                <FieldRow label="社会体系">
                  <EditableText
                    value={meta.socialSystem}
                    placeholder="社会/权力结构..."
                    onSave={(v) => update({ socialSystem: v })}
                  />
                </FieldRow>
                <FieldRow label="力量体系">
                  <EditableText
                    value={meta.powerSystem}
                    placeholder="武功/魔法/科技..."
                    onSave={(v) => update({ powerSystem: v })}
                  />
                </FieldRow>
                <FieldRow label="世界观">
                  <EditableText
                    value={meta.worldNotes}
                    placeholder="补充设定..."
                    onSave={(v) => update({ worldNotes: v })}
                    multiline
                  />
                </FieldRow>
              </SectionCard>

              {/* 制作设定 */}
              <SectionCard icon={Settings2} title="制作设定">
                <FieldRow label="视觉风格">
                  <span className="text-xs">
                    {meta.styleId ? getStyleName(meta.styleId) : "未设置"}
                  </span>
                </FieldRow>
                <FieldRow label="色彩基调">
                  <EditableText
                    value={meta.colorPalette}
                    placeholder="全剧主色调..."
                    onSave={(v) => update({ colorPalette: v })}
                  />
                </FieldRow>
                <FieldRow label="语言">
                  <span className="text-xs">{meta.language || "中文"}</span>
                </FieldRow>
              </SectionCard>

              {/* 角色列表 */}
              <SectionCard
                icon={Users}
                title={`角色 (${meta.characters.length})`}
              >
                {/* 竖向完整排列:姓名/标签/身份全量展示,可增删改(裁定 08-18:不截断、不横排) */}
                {meta.characters.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">
                    暂无角色数据
                  </p>
                ) : (
                  <div className="space-y-2">
                    {meta.characters.map((char, index) => (
                      <div
                        key={char.id}
                        className="space-y-1.5 rounded border p-3 transition-colors hover:bg-muted/30"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                            <EditableText
                              value={char.name}
                              placeholder="角色名"
                              onSave={(v) => updateCharacterAt(index, { name: v })}
                            />
                            {char.gender && (
                              <Badge variant="outline" className="h-4 shrink-0 px-1 text-[9px]">
                                {char.gender}
                              </Badge>
                            )}
                            {char.tags?.map((tag) => (
                              <Badge key={tag} variant="secondary" className="h-4 px-1 text-[9px]">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                            title="删除角色"
                            onClick={() => removeCharacterAt(index)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <EditableText
                          value={char.role}
                          placeholder="身份/背景（详细描述）"
                          multiline
                          onSave={(v) => updateCharacterAt(index, { role: v })}
                        />
                      </div>
                    ))}
                  </div>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full border-dashed"
                  onClick={addCharacter}
                >
                  <Plus className="h-3.5 w-3.5" />
                  添加角色
                </Button>
              </SectionCard>

              {/* 阵营 */}
              <SectionCard
                icon={Shield}
                title={`阵营 (${meta.factions?.length || 0})`}
              >
                {!meta.factions?.length ? (
                  <p className="text-xs text-muted-foreground italic">
                    暂无阵营数据（AI 校准后自动填充）
                  </p>
                ) : (
                  <div className="space-y-2">
                    {meta.factions.map((faction, i) => (
                      <div key={i} className="space-y-1">
                        <span className="text-xs font-medium">
                          {faction.name}
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {faction.members.map((m, j) => (
                            <Badge
                              key={j}
                              variant="outline"
                              className="text-[10px]"
                            >
                              {m}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>

              {/* 关键物品 */}
              <SectionCard
                icon={Gem}
                title={`关键物品 (${meta.keyItems?.length || 0})`}
              >
                <NamedEntityList
                  items={meta.keyItems}
                  emptyText="暂无关键物品（AI 分析后自动填充）"
                  onUpdate={(items) => update({ keyItems: items })}
                />
              </SectionCard>

              {/* 地理 */}
              <SectionCard
                icon={MapPin}
                title={`地理设定 (${meta.geography?.length || 0})`}
              >
                <NamedEntityList
                  items={meta.geography}
                  emptyText="暂无地理数据（AI 分析后自动填充）"
                  onUpdate={(items) => update({ geography: items })}
                />
              </SectionCard>
              </div>
            </div>
          </section>
        </div>
      </ScrollArea>
      <AuthorPreferenceDialog open={prefOpen} onOpenChange={setPrefOpen} />
    </div>
  );
}
