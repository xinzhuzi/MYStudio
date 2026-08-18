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
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  BookOpen,
  Globe,
  Users,
 
  MapPin,
  Gem,
  Pencil,
  Check,
  X,
  Shield,
  Settings2,
  ListOrdered,
  Film,
  CheckCircle2,
  Clock,
  AlertCircle,
  Plus,
  Trash2,
  ChevronRight,
  ArrowRight,
  Workflow,
  SlidersHorizontal,
} from "lucide-react";
import type {
  SeriesMeta,
 
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
import {
  createArtifactDeletionPlan,
  executeArtifactDeletionPlan,
} from "@/stores/artifacts/artifact-store";
import type { DeletionConfirmation, DeletionPlan } from "@/types/artifacts";
import { ArtifactDeleteDialog } from "../media/ArtifactDeleteDialog";
import { toast } from "sonner";

// ==================== Main Component ====================

export function OverviewPanel() {
  const { activeProjectId } = useProjectStore();
  const scriptProject = useActiveScriptProject();
  const {
    updateSeriesMeta,
    addEpisodeBundle,
    updateEpisodeBundle,
  } = useScriptStore();
  const { enterEpisode, setActiveTab } = useMediaPanelStore();

  const handleEnterStage = useCallback((stageId: string) => {
    useStudioStore.getState().setWorkflowConfig({ workflowStage: stageId });
    setActiveTab("studio");
  }, [setActiveTab]);

  const projectId = activeProjectId ?? "";
  const meta: SeriesMeta | null = scriptProject?.seriesMeta || null;
  const episodes: EpisodeRawScript[] = scriptProject?.episodeRawScripts || [];
  const scriptData = scriptProject?.scriptData || null;

  // 新建集状态
  const [showNewEpisode, setShowNewEpisode] = useState(false);
  const [newEpTitle, setNewEpTitle] = useState("");
  // 删除确认状态
  const [deletingEpIndex, setDeletingEpIndex] = useState<number | null>(null);
  const [chapterDeletePlan, setChapterDeletePlan] = useState<DeletionPlan | null>(null);
  const [chapterDeleteOpen, setChapterDeleteOpen] = useState(false);
  // 作者偏好（应用级口味卡）编辑入口
  const [prefOpen, setPrefOpen] = useState(false);

  const openChapterDeletePlan = useCallback(async (chapterId: string) => {
    if (!activeProjectId) {
      setDeletingEpIndex(null);
      toast.error("没有活动项目，未执行任何操作");
      return;
    }
    const requestedProjectId = activeProjectId;
    const result = await createArtifactDeletionPlan({ projectId: requestedProjectId, chapterId, scope: "chapter" });
    if (useProjectStore.getState().activeProjectId !== requestedProjectId) {
      setDeletingEpIndex(null);
      toast.error("活动项目已切换，旧删除计划已作废");
      return;
    }
    if (!result.success) {
      setDeletingEpIndex(null);
      toast.error(`生成删除计划失败：${result.error}`);
      return;
    }
    setChapterDeletePlan(result.data);
    setChapterDeleteOpen(true);
  }, [activeProjectId]);

  const executeChapterDeletePlan = useCallback(async (confirmation: DeletionConfirmation) => {
    if (!chapterDeletePlan) throw new Error("删除服务不可用");
    const requestedProjectId = chapterDeletePlan.projectId;
    if (useProjectStore.getState().activeProjectId !== requestedProjectId) {
      toast.error("活动项目已切换，请重新生成删除计划");
      throw new Error("活动项目已切换");
    }
    const result = await executeArtifactDeletionPlan(chapterDeletePlan, confirmation);
    if (!result.success) {
      toast.error(`删除失败：${result.error}`);
      throw new Error(result.error);
    }
    if (useProjectStore.getState().activeProjectId !== requestedProjectId) {
      toast.error("原项目删除已完成；当前项目未应用旧项目状态");
      return;
    }
    setDeletingEpIndex(null);
    setChapterDeletePlan(null);
    toast.success("章节及其后续产物已删除");
  }, [chapterDeletePlan]);

  const update = useCallback(
    (updates: Partial<SeriesMeta>) => {
      updateSeriesMeta(projectId, updates);
    },
    [projectId, updateSeriesMeta],
  );

  if (!meta) {
    return (
      <div className="h-full p-6">
        <div className="mx-auto w-full max-w-6xl rounded-xl border bg-panel">
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
            <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-foreground">
                  {OVERVIEW_WORKFLOW_GUIDE.title}
                </h3>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                  {OVERVIEW_WORKFLOW_GUIDE.summary}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() =>
                    setActiveTab(
                      OVERVIEW_WORKFLOW_GUIDE.primaryAction.targetTab,
                    )
                  }
                  className="gap-2"
                >
                  {OVERVIEW_WORKFLOW_GUIDE.primaryAction.label}
                  <ArrowRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    setActiveTab(
                      OVERVIEW_WORKFLOW_GUIDE.secondaryAction.targetTab,
                    )
                  }
                  className="gap-2"
                >
                  {OVERVIEW_WORKFLOW_GUIDE.secondaryAction.label}
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* 制作阶段说明 — 把工作流各阶段的功能讲清楚，让用户在进入
              工作流前就理解整条生产流水线。阶段 id/label/icon 与工作流
              页的 WORKFLOW_TABS 完全一致（见 stage-guide.ts）。 */}
          <div className="px-5 py-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <Workflow className="h-4 w-4 text-primary" />
              制作阶段
              <span className="text-xs font-normal text-muted-foreground">
                · 各阶段功能说明
              </span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {OVERVIEW_STAGE_GUIDE.map((stage) => {
                const StageIcon = stage.Icon;
                return (
                  <div
                    key={stage.id}
                    className="group relative flex flex-col justify-between rounded-lg border bg-card p-3.5 shadow-sm transition-all duration-200 hover:border-primary/50 hover:shadow-md"
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
                          onClick={() => handleEnterStage(stage.id)}
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
        </div>
        <AuthorPreferenceDialog open={prefOpen} onOpenChange={setPrefOpen} />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-3 pb-2 bg-panel border-b flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4" />
          <h2 className="font-semibold text-sm">项目概览</h2>
          <span className="text-xs text-muted-foreground">
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
          <Button variant="outline" size="sm" onClick={() => setPrefOpen(true)}>
            <SlidersHorizontal className="h-3.5 w-3.5" />
            作者偏好
          </Button>
        </div>
      </div>

      <AuthorPreferenceDialog open={prefOpen} onOpenChange={setPrefOpen} />

      {/* Two-column layout */}
      <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0">
        {/* Left: Story + World + Settings */}
        <ResizablePanel defaultSize={55} minSize={35}>
          <ScrollArea className="h-full">
            <div className="p-4 space-y-4 pb-32">
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

              {/* 分集目录 — 子项目管理台 */}
              <SectionCard
                icon={ListOrdered}
                title={`分集目录 (${episodes.length} 集)`}
              >
                {episodes.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">
                    暂无分集数据（导入剧本后自动生成）
                  </p>
                ) : (
                  <div className="space-y-2">
                    {episodes.map((ep) => {
                      const epSceneCount = ep.scenes?.length || 0;
                      const statusIcon =
                        ep.shotGenerationStatus === "completed" ? (
                          <CheckCircle2 className="h-3 w-3 text-green-500" />
                        ) : ep.shotGenerationStatus === "generating" ? (
                          <Clock className="h-3 w-3 text-yellow-500 animate-spin" />
                        ) : ep.shotGenerationStatus === "error" ? (
                          <AlertCircle className="h-3 w-3 text-red-500" />
                        ) : (
                          <Film className="h-3 w-3 text-muted-foreground" />
                        );
                      const isDeleting = deletingEpIndex === ep.episodeIndex;

                      return (
                        <div
                          key={ep.episodeIndex}
                          className="group rounded border p-2.5 text-xs space-y-1 hover:bg-muted/30 hover:border-primary/30 transition-colors cursor-pointer"
                          onClick={() =>
                            enterEpisode(ep.episodeIndex, projectId)
                          }
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 font-medium">
                              {statusIcon}
                              <span>第{ep.episodeIndex}集</span>
                              <span className="text-muted-foreground font-normal truncate max-w-[200px]">
                                {ep.title.replace(/^第\d+集[：:]?\s*/, "")}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground shrink-0">
                              {epSceneCount > 0 && (
                                <span>{epSceneCount} 场景</span>
                              )}
                              {ep.season && (
                                <Badge
                                  variant="outline"
                                  className="text-[9px] h-4 px-1"
                                >
                                  {ep.season}
                                </Badge>
                              )}
                              {/* 编辑标题 */}
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-5 w-5 opacity-0 group-hover:opacity-70"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const newTitle = window.prompt(
                                    "编辑集标题",
                                    ep.title,
                                  );
                                  if (
                                    newTitle !== null &&
                                    newTitle !== ep.title
                                  ) {
                                    updateEpisodeBundle(
                                      projectId,
                                      ep.episodeIndex,
                                      { title: newTitle },
                                    );
                                  }
                                }}
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                              {/* 删除 */}
                              {isDeleting ? (
                                <div
                                  className="flex items-center gap-1"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <span className="text-red-400 text-[10px]">
                                    确认删除?
                                  </span>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-5 w-5 text-red-500 hover:text-red-400"
                                    onClick={async () => {
                                      const chapterId = scriptData?.episodes.find((episode) => episode.index === ep.episodeIndex)?.id;
                                      if (!chapterId) {
                                        toast.error("该章节缺少稳定 ID，已阻止删除");
                                        return;
                                      }

                                      await openChapterDeletePlan(chapterId);
                                    }}
                                  >
                                    <Check className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-5 w-5"
                                    onClick={() => setDeletingEpIndex(null)}
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                </div>
                              ) : (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-5 w-5 opacity-0 group-hover:opacity-70 hover:text-red-400"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDeletingEpIndex(ep.episodeIndex);
                                  }}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              )}
                              {/* 进入箭头 */}
                              <ArrowRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-70 text-primary" />
                            </div>
                          </div>
                          {ep.synopsis && (
                            <p className="text-muted-foreground line-clamp-2 pl-5">
                              {ep.synopsis}
                            </p>
                          )}
                          {ep.keyEvents && ep.keyEvents.length > 0 && (
                            <div className="flex flex-wrap gap-1 pl-5">
                              {ep.keyEvents.slice(0, 3).map((evt, j) => (
                                <Badge
                                  key={j}
                                  variant="secondary"
                                  className="text-[9px] font-normal"
                                >
                                  {evt.length > 20
                                    ? evt.slice(0, 20) + "…"
                                    : evt}
                                </Badge>
                              ))}
                              {ep.keyEvents.length > 3 && (
                                <span className="text-[9px] text-muted-foreground">
                                  +{ep.keyEvents.length - 3}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* 新建集 */}
                {scriptData && (
                  <div className="mt-3 pt-3 border-t">
                    {showNewEpisode ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={newEpTitle}
                          onChange={(e) => setNewEpTitle(e.target.value)}
                          placeholder={`第${episodes.length + 1}集 标题...`}
                          className="h-7 text-xs flex-1"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              addEpisodeBundle(
                                projectId,
                                newEpTitle || `第${episodes.length + 1}集`,
                              );
                              setNewEpTitle("");
                              setShowNewEpisode(false);
                            }
                            if (e.key === "Escape") {
                              setNewEpTitle("");
                              setShowNewEpisode(false);
                            }
                          }}
                        />
                        <Button
                          size="sm"
                          variant="default"
                          className="h-7 text-xs px-3"
                          onClick={() => {
                            addEpisodeBundle(
                              projectId,
                              newEpTitle || `第${episodes.length + 1}集`,
                            );
                            setNewEpTitle("");
                            setShowNewEpisode(false);
                          }}
                        >
                          <Check className="h-3 w-3 mr-1" /> 添加
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => {
                            setNewEpTitle("");
                            setShowNewEpisode(false);
                          }}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full h-8 text-xs"
                        onClick={() => setShowNewEpisode(true)}
                      >
                        <Plus className="h-3 w-3 mr-1" /> 新建集
                      </Button>
                    )}
                  </div>
                )}
              </SectionCard>
            </div>
          </ScrollArea>
        </ResizablePanel>

        <ResizableHandle />

        {/* Right: Characters + Factions + Items + Geography */}
        <ResizablePanel defaultSize={45} minSize={30}>
          <ScrollArea className="h-full">
            <div className="p-4 space-y-4 pb-32">
              {/* 角色列表 */}
              <SectionCard
                icon={Users}
                title={`角色 (${meta.characters.length})`}
              >
                {meta.characters.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">
                    暂无角色数据
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {meta.characters.slice(0, 20).map((char) => (
                      <div
                        key={char.id}
                        className="rounded border p-2 text-xs space-y-0.5 hover:bg-muted/30 transition-colors"
                      >
                        <div className="font-medium flex items-center gap-1">
                          {char.name}
                          {char.tags?.includes("protagonist") && (
                            <Badge
                              variant="default"
                              className="text-[9px] h-4 px-1"
                            >
                              主角
                            </Badge>
                          )}
                          {char.tags?.includes("supporting") && (
                            <Badge
                              variant="secondary"
                              className="text-[9px] h-4 px-1"
                            >
                              配角
                            </Badge>
                          )}
                        </div>
                        {char.age && (
                          <span className="text-muted-foreground">
                            {char.age}岁
                          </span>
                        )}
                        {char.role && (
                          <p className="text-muted-foreground line-clamp-2">
                            {char.role}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {meta.characters.length > 20 && (
                  <p className="text-[10px] text-muted-foreground">
                    还有 {meta.characters.length - 20} 个角色...
                  </p>
                )}
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
          </ScrollArea>
        </ResizablePanel>
      </ResizablePanelGroup>
      <ArtifactDeleteDialog
        isOpen={chapterDeleteOpen}
        plan={chapterDeletePlan}
        onClose={() => {
          setChapterDeleteOpen(false);
          setChapterDeletePlan(null);
          setDeletingEpIndex(null);
        }}
        onExecute={executeChapterDeletePlan}
      />
    </div>
  );
}
