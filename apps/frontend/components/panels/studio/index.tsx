import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  buildNovelEventAnalysisMessages,
  formatNovelEventState,
  formatNovelEventSummary,
  parseNovelEventAnalysisLine,
} from "@/lib/studio/event-analysis";
import {
  buildStudioManualsFromSkillFiles,
  listStudioManualPresets,
  type StudioManualCatalog,
  type StudioManualSkillOverrideFile,
} from "@/lib/studio/manuals";
import { createEpisodeMergePlan, createTrackRenderPlan } from "@/lib/studio/production";
import { useAPIConfigStore } from "@/stores/api-config-store";
import { useProjectStore } from "@/stores/project-store";
import { useStudioStore } from "@/stores/studio-store";
import type {
  AgentWorkKey,
  NovelChapter,
  StoryboardMediaRef,
  StudioManualPreset,
  StudioMaterial,
  StudioWorkflowConfig,
  VideoCandidate,
} from "@/types/studio";
import {
  BookOpen,
  BookMarked,
  Boxes,
  Check,
  ClipboardList,
  Edit3,
  Eye,
  FileText,
  Film,
  Palette,
  Play,
  Plus,
  RefreshCw,
  Search,
  Split,
  Trash2,
  Upload,
  WandSparkles,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ManualEditDialog } from "./ManualEditDialog";

const taskOptions: Array<{ key: AgentWorkKey; label: string }> = [
  { key: "eventAnalysis", label: "事件分析" },
  { key: "storySkeleton", label: "故事骨架" },
  { key: "adaptationStrategy", label: "改编策略" },
  { key: "scriptDraft", label: "剧本草稿" },
  { key: "productionPlan", label: "制作计划" },
];

export const WORKFLOW_TABS = [
  { value: "manuals", label: "风格与导演选择", Icon: BookMarked },
  { value: "novel", label: "小说库", Icon: BookOpen },
  { value: "skill", label: "Skill 对话", Icon: WandSparkles },
  { value: "script", label: "剧本策划", Icon: FileText },
  { value: "storyboard", label: "分镜表", Icon: Split },
  { value: "workbench", label: "剪辑工作台", Icon: Film },
];

export function StudioView() {
  const activeProject = useProjectStore((state) => state.activeProject);
  const {
    materials,
    novelChapters,
    agentWorkData,
    storyboards,
    productionTracks,
    videoCandidates,
    workflowConfig,
    lastContextPackage,
    appendNovelText,
    replaceNovelText,
    deleteNovelChapters,
    addMaterial,
    deleteMaterial,
    bindMaterialToStoryboard,
    updateNovelChapter,
    setWorkflowConfig,
    saveAgentWorkData,
    buildContext,
    addStoryboard,
    updateStoryboard,
    createStoryboardsFromChapters,
    rebuildTracks,
    addVideoCandidate,
    updateVideoCandidate,
    selectVideoCandidate,
    deleteVideoCandidate,
  } = useStudioStore();
  const getResolvedAgentModel = useAPIConfigStore((state) => state.getResolvedAgentModel);
  const [novelDraft, setNovelDraft] = useState("");
  const [selectedTask, setSelectedTask] = useState<AgentWorkKey>("scriptDraft");
  const [agentDraft, setAgentDraft] = useState("");
  const [renderingTrackId, setRenderingTrackId] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [mergeOutput, setMergeOutput] = useState<string | null>(null);
  const [activeWorkflowTab, setActiveWorkflowTab] = useState(workflowConfig.workflowStage ?? "manuals");
  const handleStageChange = useCallback((value: string) => {
    const cfg = useStudioStore.getState().workflowConfig;
    if (value !== "manuals" && (!cfg.visualManualId || !cfg.directorManualId)) {
      toast.error("请先选择视觉风格与导演手册，才能进入下一步");
      return;
    }
    setActiveWorkflowTab(value);
    setWorkflowConfig({ workflowStage: value });
  }, [setWorkflowConfig]);
  // 切换项目时，自动恢复到该项目保存的工作流阶段
  useEffect(() => {
    setActiveWorkflowTab(useStudioStore.getState().workflowConfig.workflowStage ?? "manuals");
  }, [activeProject?.id]);
  const [novelHeaderActions, setNovelHeaderActions] = useState<ReactNode>(null);
  const bundledManualCatalog = useMemo<StudioManualCatalog>(() => ({
    visual: listStudioManualPresets("visual"),
    director: listStudioManualPresets("director"),
  }), []);
  const [storedManualCatalog, setStoredManualCatalog] = useState<StudioManualCatalog | null>(null);
  const usesStoredManualCatalog = typeof window !== "undefined" && Boolean(window.studioSkills?.list);
  const manualCatalog = storedManualCatalog ?? (usesStoredManualCatalog ? {} : bundledManualCatalog);
  const manualCatalogReady = !usesStoredManualCatalog || storedManualCatalog !== null;

  const projectName = activeProject?.name ?? "漫影工作室";

  const selectedCandidates = productionTracks
    .map((track) => videoCandidates.find((candidate) => candidate.id === track.selectedVideoId))
    .filter((candidate): candidate is VideoCandidate => Boolean(candidate));

  const handleNovelFile = async (file?: File) => {
    if (!file) return;
    const text = await file.text();
    setNovelDraft(text);
  };

  const handleBuildContext = () => {
    if (!manualCatalogReady) {
      toast.error("手册副本正在同步，请稍后再生成上下文包");
      return;
    }
    buildContext(projectName, selectedTask, manualCatalog);
    toast.success("上下文包已生成，模型执行保持关闭");
  };

  useEffect(() => {
    const studioSkills = window.studioSkills;
    if (!studioSkills?.list || !studioSkills.readText) return;
    let cancelled = false;
    const loadStoredManualCatalog = async () => {
      try {
        const [files, visualManuals] = await Promise.all([
          studioSkills.list(),
          window.studioVisualManuals?.list?.() ?? Promise.resolve([]),
        ]);
        const manualFiles = files.filter((file) => isManualSkillMarkdownPath(file.relativePath));
        const loaded = await Promise.all(manualFiles.map(async (file) => {
          const result = await studioSkills.readText(file.relativePath);
          if (!result.success) return null;
          return {
            relativePath: file.relativePath,
            content: result.content ?? "",
          } satisfies StudioManualSkillOverrideFile;
        }));
        const skillFiles = loaded.filter((file): file is StudioManualSkillOverrideFile => Boolean(file));
        const imagesByManualId = Object.fromEntries(
          visualManuals.map((manual) => [manual.stylePath, manual.images.map((image) => image.url)]),
        );
        if (!cancelled) {
          setStoredManualCatalog({
            visual: buildStudioManualsFromSkillFiles("visual", skillFiles, { imagesByManualId }),
            director: buildStudioManualsFromSkillFiles("director", skillFiles),
          });
        }
      } catch (error) {
        console.warn("[StudioView] Failed to load stored manual catalog:", error);
      }
    };
    void loadStoredManualCatalog();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSaveAgentWork = () => {
    if (!agentDraft.trim()) return;
    saveAgentWorkData(selectedTask, agentDraft.trim(), "episode-1");
    setAgentDraft("");
    toast.success("工作数据已保存");
  };

  const handleNovelEventAnalysis = useCallback(async (chapters: NovelChapter[]) => {
    if (!chapters.length) return;
    if (!window.electronAPI?.textCompletion) {
      toast.error("当前环境不支持模型调用");
      return;
    }

    const resolved = getResolvedAgentModel("eventAnalysisAgent") ?? getResolvedAgentModel("universalAi");
    if (!resolved) {
      toast.error("未配置事件分析模型，请先到设置的 API 管理中绑定事件分析Agent或通用AI");
      return;
    }

    let successCount = 0;
    let failedCount = 0;
    for (const chapter of chapters) {
      updateNovelChapter(chapter.id, {
        eventTaskState: "running",
        eventErrorReason: undefined,
      });
      const messages = buildNovelEventAnalysisMessages(chapter);
      try {
        const result = await window.electronAPI.textCompletion({
          provider: resolved.provider,
          model: resolved.model,
          messages: [
            { role: "system", content: messages.system },
            { role: "user", content: messages.user },
          ],
          temperature: resolved.deployment.temperature ?? 0.2,
          maxTokens: resolved.deployment.maxOutputTokens ?? 1024,
        });
        if (!result.success || !result.text) {
          throw new Error(result.error || "事件分析失败");
        }
        const analysis = parseNovelEventAnalysisLine(result.text);
        updateNovelChapter(chapter.id, {
          eventTaskState: "success",
          eventAnalysis: analysis,
          eventSummary: formatNovelEventSummary(analysis),
          eventState: formatNovelEventState(analysis),
          eventRawOutput: result.text,
          eventErrorReason: undefined,
        });
        successCount += 1;
      } catch (error) {
        failedCount += 1;
        updateNovelChapter(chapter.id, {
          eventTaskState: "failed",
          eventErrorReason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    saveAgentWorkData(
      "eventAnalysis",
      `事件分析完成：成功 ${successCount} 章，失败 ${failedCount} 章。`,
      "episode-1",
    );
    if (failedCount) {
      toast.error(`事件分析完成，失败 ${failedCount} 章`);
    } else {
      toast.success(`事件分析完成，共 ${successCount} 章`);
    }
  }, [getResolvedAgentModel, saveAgentWorkData, updateNovelChapter]);

  const handleMaterialFiles = async (files?: FileList | null) => {
    if (!files?.length) return;
    if (!window.studioAssets) {
      toast.error("当前环境无法保存本地素材");
      return;
    }

    for (const file of Array.from(files)) {
      try {
        const bytes = await file.arrayBuffer();
        const result = await window.studioAssets.saveMaterial({ name: file.name, bytes });
        if (!result.success || !result.localPath) {
          throw new Error(result.error || "素材保存失败");
        }
        addMaterial({
          name: file.name,
          localPath: result.localPath,
          size: result.size ?? file.size,
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
    }

    toast.success("素材已导入");
  };

  const handleRenderTrack = async (trackId: string) => {
    const track = productionTracks.find((item) => item.id === trackId);
    if (!track) return;

    let candidateId = "";
    try {
      const plan = createTrackRenderPlan(track, storyboards);
      candidateId = addVideoCandidate({ trackId, provider: "ffmpeg-local", state: "rendering" });
      setRenderingTrackId(trackId);

      const result = await window.studioRenderer?.renderTrackCandidate(plan);
      if (!result?.success || !result.filePath) {
        throw new Error(result?.error || "本地 FFmpeg 合成失败");
      }

      updateVideoCandidate(candidateId, { state: "ready", filePath: result.filePath });
      selectVideoCandidate(trackId, candidateId);
      toast.success("候选片段已生成");
    } catch (error) {
      if (candidateId) {
        updateVideoCandidate(candidateId, {
          state: "failed",
          errorReason: error instanceof Error ? error.message : String(error),
        });
      }
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRenderingTrackId(null);
    }
  };

  const handleMergeEpisode = async () => {
    try {
      setMerging(true);
      const plan = createEpisodeMergePlan(selectedCandidates);
      const result = await window.studioRenderer?.mergeEpisode(plan);
      if (!result?.success || !result.filePath) {
        throw new Error(result?.error || "成片拼接失败");
      }
      setMergeOutput(result.filePath);
      saveAgentWorkData("productionPlan", `本地成片输出: ${result.filePath}`, "episode-1");
      toast.success("成片已拼接完成");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setMerging(false);
    }
  };

  return (
    <div className="studio-workspace studio-workspace-workflow h-full bg-background">
      <Tabs value={activeWorkflowTab} onValueChange={handleStageChange} className="flex h-full flex-col">
        <div className="border-b border-border bg-panel px-6 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              {activeWorkflowTab === "novel" ? novelHeaderActions : null}
            </div>
            <Select value={activeWorkflowTab} onValueChange={handleStageChange}>
              <SelectTrigger className="h-10 w-[220px] gap-2 border-primary/40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WORKFLOW_TABS.map(({ value, label, Icon }, index) => (
                  <SelectItem key={value} value={value}>
                    <span className="flex items-center gap-2">
                      <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[10px] font-semibold">{index + 1}</span>
                      <Icon className="h-4 w-4" />
                      {label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <ScrollArea className="flex-1 scrollbar-hidden">
          <div className="p-5">
            <TabsContent value="novel" className="m-0">
              <NovelTab
                novelDraft={novelDraft}
                setNovelDraft={setNovelDraft}
                handleNovelFile={handleNovelFile}
                appendNovelText={appendNovelText}
                replaceNovelText={replaceNovelText}
                deleteNovelChapters={deleteNovelChapters}
                novelChapters={novelChapters}
                updateNovelChapter={updateNovelChapter}
                analyzeEvents={handleNovelEventAnalysis}
                setHeaderActions={setNovelHeaderActions}
              />
            </TabsContent>

            <TabsContent value="manuals" className="m-0">
              <ManualsTab
                workflowConfig={workflowConfig}
                setWorkflowConfig={setWorkflowConfig}
                manualCatalog={manualCatalog}
              />
            </TabsContent>

            <TabsContent value="skill" className="m-0">
              <SkillTab
                selectedTask={selectedTask}
                setSelectedTask={setSelectedTask}
                handleBuildContext={handleBuildContext}
                lastContextPackage={lastContextPackage}
                agentWorkData={agentWorkData}
                agentDraft={agentDraft}
                setAgentDraft={setAgentDraft}
                handleSaveAgentWork={handleSaveAgentWork}
              />
            </TabsContent>

            <TabsContent value="script" className="m-0">
              <ScriptTab
                agentWorkData={agentWorkData}
                agentDraft={agentDraft}
                setAgentDraft={setAgentDraft}
                handleSaveAgentWork={handleSaveAgentWork}
                selectedTask={selectedTask}
                setSelectedTask={setSelectedTask}
              />
            </TabsContent>

            <TabsContent value="storyboard" className="m-0">
              <StoryboardTab
                storyboards={storyboards}
                materials={materials}
                importMaterials={handleMaterialFiles}
                deleteMaterial={deleteMaterial}
                bindMaterialToStoryboard={bindMaterialToStoryboard}
                addStoryboard={addStoryboard}
                updateStoryboard={updateStoryboard}
                createStoryboardsFromChapters={createStoryboardsFromChapters}
              />
            </TabsContent>

            <TabsContent value="workbench" className="m-0">
              <WorkbenchTab
                storyboards={storyboards}
                tracks={productionTracks}
                candidates={videoCandidates}
                renderingTrackId={renderingTrackId}
                merging={merging}
                mergeOutput={mergeOutput}
                rebuildTracks={rebuildTracks}
                renderTrack={handleRenderTrack}
                selectVideoCandidate={selectVideoCandidate}
                deleteVideoCandidate={deleteVideoCandidate}
                mergeEpisode={handleMergeEpisode}
              />
            </TabsContent>

          </div>
        </ScrollArea>
      </Tabs>
    </div>
  );
}

export function NovelEmptyState({
  hasNovelChapters,
  onImport,
}: {
  hasNovelChapters: boolean;
  onImport: () => void;
}) {
  if (hasNovelChapters) {
    return <span>没有匹配的章节。</span>;
  }

  return (
    <button
      type="button"
      onClick={onImport}
      className="mx-auto flex flex-col items-center gap-3 rounded-lg px-6 py-4 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
    >
      <span>还没有导入小说。</span>
      <span className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-sm">
        <Plus className="h-4 w-4" />
        导入原文
      </span>
    </button>
  );
}

function NovelTab(props: {
  novelDraft: string;
  setNovelDraft: (value: string) => void;
  handleNovelFile: (file?: File) => void | Promise<void>;
  appendNovelText: (value: string, sourceName?: string) => void;
  replaceNovelText: (value: string, sourceName?: string) => void;
  deleteNovelChapters: ReturnType<typeof useStudioStore.getState>["deleteNovelChapters"];
  novelChapters: ReturnType<typeof useStudioStore.getState>["novelChapters"];
  updateNovelChapter: ReturnType<typeof useStudioStore.getState>["updateNovelChapter"];
  analyzeEvents: (chapters: NovelChapter[]) => void | Promise<void>;
  setHeaderActions: (actions: ReactNode) => void;
}) {
  const setHeaderActions = props.setHeaderActions;
  const [importOpen, setImportOpen] = useState(false);
  const [importMode, setImportMode] = useState<"append" | "replace">("append");
  const [importSourceName, setImportSourceName] = useState("");
  const [searchText, setSearchText] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailChapter, setDetailChapter] = useState<NovelChapter | null>(null);
  const [editingChapter, setEditingChapter] = useState<NovelChapter | null>(null);
  const [deletingChapter, setDeletingChapter] = useState<NovelChapter | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editDraft, setEditDraft] = useState({
    volume: "",
    title: "",
    sourceText: "",
    eventSummary: "",
    eventState: "",
  });

  const query = searchText.trim().toLowerCase();
  const filteredChapters = query
    ? props.novelChapters.filter((chapter) =>
        [
          chapter.title,
          chapter.volume,
          chapter.sourceText,
          chapter.eventSummary,
          chapter.eventState,
        ].some((value) => value?.toLowerCase().includes(query)),
      )
    : props.novelChapters;
  const selectedChapters = useMemo(
    () => props.novelChapters.filter((chapter) => selectedIds.has(chapter.id)),
    [props.novelChapters, selectedIds],
  );
  const visibleSelectedCount = filteredChapters.filter((chapter) => selectedIds.has(chapter.id)).length;
  const allVisibleSelected = filteredChapters.length > 0 && visibleSelectedCount === filteredChapters.length;

  const handleOpenImport = useCallback(() => {
    setImportMode("append");
    setImportOpen(true);
  }, []);

  const handleImportFile = async (file?: File) => {
    if (!file) return;
    setImportSourceName(file.name);
    await props.handleNovelFile(file);
  };

  const handleConfirmImport = () => {
    const sourceText = props.novelDraft.trim();
    if (!sourceText) return;
    if (importMode === "replace") {
      props.replaceNovelText(sourceText, importSourceName || undefined);
    } else {
      props.appendNovelText(sourceText, importSourceName || undefined);
    }
    props.setNovelDraft("");
    setImportSourceName("");
    setImportOpen(false);
    toast.success(importMode === "replace" ? "小说库已覆盖导入" : "小说章节已追加导入");
  };

  const toggleChapter = (id: string, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  const toggleAllVisible = (checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const chapter of filteredChapters) {
        if (checked) {
          next.add(chapter.id);
        } else {
          next.delete(chapter.id);
        }
      }
      return next;
    });
  };

  const openSingleDelete = (chapter: NovelChapter) => {
    setDeletingChapter(chapter);
    setDeleteOpen(true);
  };

  const openBatchDelete = useCallback(() => {
    setDeletingChapter(null);
    setDeleteOpen(true);
  }, []);

  const handleAnalyzeSelectedChapters = useCallback(() => {
    props.analyzeEvents(selectedChapters);
  }, [props.analyzeEvents, selectedChapters]);

  const handleConfirmDelete = () => {
    const ids = deletingChapter ? [deletingChapter.id] : Array.from(selectedIds);
    props.deleteNovelChapters(ids);
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of ids) {
        next.delete(id);
      }
      return next;
    });
    const deletedCount = ids.length;
    setDeletingChapter(null);
    setDeleteOpen(false);
    toast.success(`已删除 ${deletedCount} 个章节`);
  };

  const openEdit = (chapter: NovelChapter) => {
    setEditingChapter(chapter);
    setEditDraft({
      volume: chapter.volume ?? "正文卷",
      title: chapter.title,
      sourceText: chapter.sourceText,
      eventSummary: chapter.eventSummary ?? "",
      eventState: chapter.eventState ?? "",
    });
  };

  const saveEdit = () => {
    if (!editingChapter) return;
    props.updateNovelChapter(editingChapter.id, {
      volume: editDraft.volume.trim() || "正文卷",
      title: editDraft.title.trim() || editingChapter.title,
      sourceText: editDraft.sourceText,
      eventSummary: editDraft.eventSummary,
      eventState: editDraft.eventState,
    });
    setEditingChapter(null);
    toast.success("章节已保存");
  };

  useEffect(() => {
    setHeaderActions(
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={handleOpenImport}>
          <Plus className="h-4 w-4" />
          导入原文
        </Button>
        <Button variant="destructive" disabled={selectedIds.size === 0} onClick={openBatchDelete}>
          <Trash2 className="h-4 w-4" />
          批量删除 ({selectedIds.size})
        </Button>
        <Button variant="secondary" disabled={selectedIds.size === 0} onClick={handleAnalyzeSelectedChapters}>
          <ClipboardList className="h-4 w-4" />
          事件分析 ({selectedIds.size})
        </Button>
        <div className="relative min-w-[260px] max-w-[520px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            className="pl-9"
            placeholder="搜索章节名称或正文..."
          />
        </div>
      </div>,
    );

    return () => setHeaderActions(null);
  }, [
    handleAnalyzeSelectedChapters,
    handleOpenImport,
    openBatchDelete,
    searchText,
    selectedIds.size,
    setHeaderActions,
  ]);

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-lg border border-border bg-panel/40">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-12">
                <Checkbox checked={allVisibleSelected} onCheckedChange={(checked) => toggleAllVisible(checked === true)} />
              </TableHead>
              <TableHead className="w-16">序号</TableHead>
              <TableHead className="w-28">卷</TableHead>
              <TableHead className="w-[220px]">章节名称</TableHead>
              <TableHead>章节内容</TableHead>
              <TableHead className="w-[240px]">事件摘要</TableHead>
              <TableHead className="w-[180px]">事件状态</TableHead>
              <TableHead className="w-[260px] text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredChapters.map((chapter) => (
              <TableRow key={chapter.id} data-state={selectedIds.has(chapter.id) ? "selected" : undefined}>
                <TableCell>
                  <Checkbox checked={selectedIds.has(chapter.id)} onCheckedChange={(checked) => toggleChapter(chapter.id, checked === true)} />
                </TableCell>
                <TableCell className="text-muted-foreground">{chapter.index}</TableCell>
                <TableCell className="text-xs">{chapter.volume ?? "正文卷"}</TableCell>
                <TableCell>
                  <div className="line-clamp-2 font-medium">{chapter.title}</div>
                </TableCell>
                <TableCell>
                  <div className="line-clamp-2 text-xs leading-5 text-muted-foreground">{chapter.sourceText}</div>
                </TableCell>
                <TableCell>
                  <div className="line-clamp-2 text-xs leading-5 text-muted-foreground">{chapter.eventSummary || "未填写"}</div>
                </TableCell>
                <TableCell>
                  <div className="line-clamp-2 text-xs leading-5 text-muted-foreground">{chapter.eventState || "未填写"}</div>
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="text" onClick={() => setDetailChapter(chapter)}>
                      <Eye className="h-4 w-4" />
                      查看详情
                    </Button>
                    <Button size="sm" variant="text" onClick={() => openEdit(chapter)}>
                      <Edit3 className="h-4 w-4" />
                      编辑
                    </Button>
                    <Button size="sm" variant="text" className="text-destructive hover:text-destructive" onClick={() => openSingleDelete(chapter)}>
                      <Trash2 className="h-4 w-4" />
                      删除
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!filteredChapters.length && (
              <TableRow>
                <TableCell colSpan={8} className="h-40 text-center text-sm text-muted-foreground">
                  <NovelEmptyState hasNovelChapters={props.novelChapters.length > 0} onImport={handleOpenImport} />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>导入原文</DialogTitle>
            <DialogDescription>TXT/Markdown 会拆成章节，并把原文写成文档保存到当前项目存储位置。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label className="flex min-h-20 cursor-pointer items-center justify-between gap-4 rounded-lg border border-dashed border-primary/45 bg-primary/5 px-4 py-3 transition-colors hover:bg-primary/10">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                  <Upload className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">选择 TXT/Markdown 文件</span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    {importSourceName || "支持 .txt、.md，也可以直接在下方粘贴原文。"}
                  </span>
                </span>
              </div>
              <span className="shrink-0 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium">选择文件</span>
              <input
                type="file"
                accept=".txt,.md,text/plain,text/markdown"
                className="sr-only"
                onChange={(event) => handleImportFile(event.target.files?.[0])}
              />
            </Label>
            <div className="flex gap-2">
              <Button variant={importMode === "append" ? "default" : "secondary"} onClick={() => setImportMode("append")}>追加导入</Button>
              <Button variant={importMode === "replace" ? "default" : "secondary"} onClick={() => setImportMode("replace")}>覆盖小说库</Button>
            </div>
            <Textarea
              value={props.novelDraft}
              onChange={(event) => props.setNovelDraft(event.target.value)}
              className="min-h-[360px] font-mono text-xs"
              placeholder="粘贴小说原文，或选择 .txt/.md 文件。"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>取消</Button>
            <Button onClick={handleConfirmImport} disabled={!props.novelDraft.trim()}>确认导入</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(detailChapter)} onOpenChange={(open) => !open && setDetailChapter(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{detailChapter?.index}. {detailChapter?.title}</DialogTitle>
            <DialogDescription>{detailChapter?.volume ?? "正文卷"}</DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[70vh] grid-cols-[1fr_280px] gap-3 overflow-hidden">
            <ScrollArea className="rounded-md border bg-muted/30 p-3">
              <pre className="whitespace-pre-wrap text-sm leading-7">{detailChapter?.sourceText}</pre>
            </ScrollArea>
            <div className="space-y-3">
              <div className="rounded-md border p-3">
                <div className="text-xs font-medium text-muted-foreground">事件摘要</div>
                <p className="mt-2 whitespace-pre-wrap text-sm">{detailChapter?.eventSummary || "未填写"}</p>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs font-medium text-muted-foreground">事件状态</div>
                <p className="mt-2 whitespace-pre-wrap text-sm">{detailChapter?.eventState || "未填写"}</p>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingChapter)} onOpenChange={(open) => !open && setEditingChapter(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>编辑章节</DialogTitle>
            <DialogDescription>保存后会同步更新项目存储位置下的章节文档。</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-[160px_1fr] gap-3">
            <Input value={editDraft.volume} onChange={(event) => setEditDraft((draft) => ({ ...draft, volume: event.target.value }))} placeholder="卷" />
            <Input value={editDraft.title} onChange={(event) => setEditDraft((draft) => ({ ...draft, title: event.target.value }))} placeholder="章节名称" />
            <Textarea className="col-span-2 min-h-[260px] font-mono text-xs" value={editDraft.sourceText} onChange={(event) => setEditDraft((draft) => ({ ...draft, sourceText: event.target.value }))} placeholder="章节内容" />
            <Textarea className="min-h-[120px]" value={editDraft.eventSummary} onChange={(event) => setEditDraft((draft) => ({ ...draft, eventSummary: event.target.value }))} placeholder="事件摘要" />
            <Textarea className="min-h-[120px]" value={editDraft.eventState} onChange={(event) => setEditDraft((draft) => ({ ...draft, eventState: event.target.value }))} placeholder="事件状态" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingChapter(null)}>取消</Button>
            <Button onClick={saveEdit}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除选中章节</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingChapter
                ? `将删除「${deletingChapter.title}」，并移除项目存储位置下对应的章节文档。`
                : `将删除 ${selectedIds.size} 个章节，并移除项目存储位置下对应的章节文档。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeletingChapter(null)}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ManualsTab(props: {
  workflowConfig: StudioWorkflowConfig;
  setWorkflowConfig: (updates: Partial<StudioWorkflowConfig>) => void;
  manualCatalog: StudioManualCatalog;
}) {
  const visualManuals = props.manualCatalog.visual ?? [];
  const directorManuals = props.manualCatalog.director ?? [];
  const [editing, setEditing] = useState<{ kind: "visual" | "director"; manual: StudioManualPreset } | null>(null);

  return (
    <div className="grid grid-cols-[320px_1fr] gap-5">
      {/* 左：项目配置（ToonFlow 风格）*/}
      <Card className="h-fit rounded-lg">
        <CardHeader><CardTitle className="text-sm">项目配置</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">项目类型</Label>
            <select className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm" value={props.workflowConfig.projectType ?? "novel"} onChange={(e) => props.setWorkflowConfig({ projectType: e.target.value })}>
              <option value="novel">基于小说原文</option>
              <option value="script">基于剧本</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">单集时长（分钟）</Label>
            <Input type="number" min={1} value={props.workflowConfig.episodeDurationMin ?? 3} onChange={(e) => props.setWorkflowConfig({ episodeDurationMin: e.target.value ? Number(e.target.value) : undefined })} className="h-8" placeholder="例如 3" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">小说类型</Label>
            <Input value={props.workflowConfig.novelGenre ?? ""} onChange={(e) => props.setWorkflowConfig({ novelGenre: e.target.value || undefined })} className="h-8" placeholder="例如 玄幻、科幻、言情" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">平台规格</Label>
            <select className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm" value={props.workflowConfig.platformSpec ?? ""} onChange={(e) => props.setWorkflowConfig({ platformSpec: e.target.value || undefined })}>
              <option value="">未选择</option>
              <option value="16:9">16:9 横屏</option>
              <option value="9:16">9:16 竖屏</option>
              <option value="1:1">1:1 方形</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">小说简介</Label>
            <Textarea value={props.workflowConfig.novelSynopsis ?? ""} onChange={(e) => props.setWorkflowConfig({ novelSynopsis: e.target.value || undefined })} className="min-h-[120px] text-sm" placeholder="请输入小说简介" />
          </div>
        </CardContent>
      </Card>

      {/* 右：视觉手册 + 导演手册 */}
      <div className="space-y-5">
      {/* 视觉手册网格 */}
      <section>
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          <Palette className="h-4 w-4" /> 视觉手册（画风）
          <span className="text-xs font-normal text-muted-foreground">{visualManuals.length} 个 · 点击选择</span>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          {visualManuals.map((manual) => {
            const active = manual.id === props.workflowConfig.visualManualId;
            return (
              <div
                key={manual.id}
                role="button"
                tabIndex={0}
                onClick={() => props.setWorkflowConfig({ visualManualId: active ? undefined : manual.id })}
                className={cn(
                  "group relative cursor-pointer overflow-hidden rounded-lg border bg-card text-left transition-colors",
                  active ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/40",
                )}
              >
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setEditing({ kind: "visual", manual }); }}
                  className="absolute right-1.5 top-1.5 z-10 hidden rounded-md bg-background/90 p-1 shadow group-hover:block hover:text-primary"
                  title="编辑文档"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                </button>
                <div className="aspect-video overflow-hidden bg-muted">
                  {manual.images?.[0] ? (
                    <img src={manual.images[0]} alt={manual.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center"><Palette className="h-6 w-6 opacity-30" /></div>
                  )}
                </div>
                <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                  <span className="truncate text-xs font-medium">{manual.name}</span>
                  {active ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 导演手册网格 */}
      <section>
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          <BookMarked className="h-4 w-4" /> 导演手册
          <span className="text-xs font-normal text-muted-foreground">{directorManuals.length} 个 · 点击选择</span>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
          {directorManuals.map((manual) => {
            const active = manual.id === props.workflowConfig.directorManualId;
            return (
              <div
                key={manual.id}
                role="button"
                tabIndex={0}
                onClick={() => props.setWorkflowConfig({ directorManualId: active ? undefined : manual.id })}
                className={cn(
                  "group relative cursor-pointer rounded-lg border p-3 text-left transition-colors",
                  active ? "border-primary bg-primary/5 ring-2 ring-primary/30" : "border-border hover:border-primary/40",
                )}
              >
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setEditing({ kind: "director", manual }); }}
                  className="absolute right-1.5 top-1.5 z-10 hidden rounded-md bg-background/90 p-1 shadow group-hover:block hover:text-primary"
                  title="编辑文档"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                </button>
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-sm font-medium">{manual.name}</span>
                  {active ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">导演叙事手法技能包</p>
              </div>
            );
          })}
        </div>
      </section>
      </div>
      <ManualEditDialog
        open={!!editing}
        kind={editing?.kind ?? "visual"}
        manual={editing?.manual ?? null}
        onOpenChange={(o) => { if (!o) setEditing(null); }}
      />
    </div>
  );
}

function isManualSkillMarkdownPath(relativePath: string) {
  return (
    relativePath.endsWith(".md")
    && (
      relativePath.startsWith("art_skills/")
      || relativePath.startsWith("story_skills/")
    )
  );
}

function SkillTab(props: {
  selectedTask: AgentWorkKey;
  setSelectedTask: (value: AgentWorkKey) => void;
  handleBuildContext: () => void;
  lastContextPackage: ReturnType<typeof useStudioStore.getState>["lastContextPackage"];
  agentWorkData: ReturnType<typeof useStudioStore.getState>["agentWorkData"];
  agentDraft: string;
  setAgentDraft: (value: string) => void;
  handleSaveAgentWork: () => void;
}) {
  return (
    <div className="grid grid-cols-[340px_1fr] gap-4">
      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="text-sm">Skill 对话任务</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Label>任务类型</Label>
          <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={props.selectedTask} onChange={(event) => props.setSelectedTask(event.target.value as AgentWorkKey)}>
            {taskOptions.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
          <Button onClick={props.handleBuildContext} className="w-full">
            <WandSparkles className="h-4 w-4" />
            生成上下文包
          </Button>
          <Textarea value={props.agentDraft} onChange={(event) => props.setAgentDraft(event.target.value)} className="min-h-[160px]" placeholder="保存人工整理的骨架、策略、剧本草稿或制作计划" />
          <Button variant="secondary" onClick={props.handleSaveAgentWork} className="w-full">
            <Check className="h-4 w-4" />
            保存工作数据
          </Button>
          <div className="space-y-2">
            {props.agentWorkData.map((item) => (
              <div key={item.id} className="rounded-md border border-border p-2 text-xs">
                <Badge variant="outline">{item.key}</Badge>
                <div className="mt-2 line-clamp-3 text-muted-foreground">{item.data}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="text-sm">上下文包预览</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea value={props.lastContextPackage?.markdown ?? ""} readOnly className="min-h-[560px] font-mono text-xs" />
        </CardContent>
      </Card>
    </div>
  );
}

function ScriptTab(props: {
  agentWorkData: ReturnType<typeof useStudioStore.getState>["agentWorkData"];
  agentDraft: string;
  setAgentDraft: (value: string) => void;
  handleSaveAgentWork: () => void;
  selectedTask: AgentWorkKey;
  setSelectedTask: (value: AgentWorkKey) => void;
}) {
  const drafts = props.agentWorkData.filter((item) => item.key === "scriptDraft");
  return (
    <div className="grid grid-cols-[minmax(360px,520px)_1fr] gap-4">
      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="text-sm">剧本草稿</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button variant={props.selectedTask === "scriptDraft" ? "default" : "secondary"} onClick={() => props.setSelectedTask("scriptDraft")}>切到剧本任务</Button>
          <Textarea value={props.agentDraft} onChange={(event) => props.setAgentDraft(event.target.value)} className="min-h-[420px]" placeholder="这里先保存人工剧本草稿，后续接模型后由 scriptAgent 写入" />
          <Button onClick={props.handleSaveAgentWork}>
            <FileText className="h-4 w-4" />
            保存剧本草稿
          </Button>
        </CardContent>
      </Card>
      <div className="space-y-3">
        {drafts.map((draft) => (
          <Card key={draft.id} className="rounded-lg">
            <CardHeader className="py-4">
              <CardTitle className="text-sm">剧本记录</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{draft.data}</pre>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function StoryboardTab(props: {
  storyboards: ReturnType<typeof useStudioStore.getState>["storyboards"];
  materials: ReturnType<typeof useStudioStore.getState>["materials"];
  importMaterials: (files?: FileList | null) => void;
  deleteMaterial: ReturnType<typeof useStudioStore.getState>["deleteMaterial"];
  bindMaterialToStoryboard: ReturnType<typeof useStudioStore.getState>["bindMaterialToStoryboard"];
  addStoryboard: ReturnType<typeof useStudioStore.getState>["addStoryboard"];
  updateStoryboard: ReturnType<typeof useStudioStore.getState>["updateStoryboard"];
  createStoryboardsFromChapters: ReturnType<typeof useStudioStore.getState>["createStoryboardsFromChapters"];
}) {
  return (
    <div className="grid grid-cols-[280px_1fr] gap-4">
      <MaterialLibrary materials={props.materials} importMaterials={props.importMaterials} deleteMaterial={props.deleteMaterial} />

      <Card className="rounded-lg">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">分镜表</CardTitle>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={props.createStoryboardsFromChapters}>
              <Split className="h-4 w-4" />
              从章节生成
            </Button>
            <Button onClick={() => props.addStoryboard()}>
              <Plus className="h-4 w-4" />
              添加分镜
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {props.storyboards.map((item) => (
            <div key={item.id} className="grid grid-cols-[56px_130px_80px_1fr_1fr_1.2fr] gap-2 rounded-md border border-border p-2">
              <Input type="number" value={item.index} onChange={(event) => props.updateStoryboard(item.id, { index: Number(event.target.value) })} />
              <Input value={item.trackKey} onChange={(event) => props.updateStoryboard(item.id, { trackKey: event.target.value })} />
              <Input type="number" value={item.duration} onChange={(event) => props.updateStoryboard(item.id, { duration: Number(event.target.value) })} />
              <Textarea value={item.prompt} onChange={(event) => props.updateStoryboard(item.id, { prompt: event.target.value })} placeholder="画面提示" />
              <Textarea value={item.videoDesc} onChange={(event) => props.updateStoryboard(item.id, { videoDesc: event.target.value })} placeholder="视频描述/台词" />
              <MediaRefEditor
                itemId={item.id}
                mediaRef={item.mediaRef}
                materials={props.materials}
                bindMaterialToStoryboard={props.bindMaterialToStoryboard}
                updateStoryboard={props.updateStoryboard}
              />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function MaterialLibrary(props: {
  materials: StudioMaterial[];
  importMaterials: (files?: FileList | null) => void;
  deleteMaterial: (id: string) => void;
}) {
  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle className="text-sm">素材管理</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Label className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-input text-sm">
          <Upload className="h-4 w-4" />
          导入素材
          <input
            type="file"
            multiple
            accept="image/*,video/*,audio/*"
            className="hidden"
            onChange={(event) => props.importMaterials(event.target.files)}
          />
        </Label>
        <div className="space-y-2">
          {props.materials.map((material) => (
            <div key={material.id} className="rounded-md border border-border p-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium">{material.name}</div>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                    <Badge variant="outline">{material.kind}</Badge>
                    <span>{Math.round(material.size / 1024)} KB</span>
                  </div>
                </div>
                <Button size="icon" variant="destructive" onClick={() => props.deleteMaterial(material.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              {material.kind !== "audio" && (
                <div className="mt-2 overflow-hidden rounded bg-muted">
                  {material.kind === "image" ? (
                    <img src={material.localPath} alt={material.name} className="aspect-video w-full object-cover" />
                  ) : (
                    <video src={material.localPath} className="aspect-video w-full bg-black" controls />
                  )}
                </div>
              )}
            </div>
          ))}
          {!props.materials.length && <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">还没有导入素材。</div>}
        </div>
      </CardContent>
    </Card>
  );
}

function MediaRefEditor(props: {
  itemId: string;
  mediaRef?: StoryboardMediaRef;
  materials: StudioMaterial[];
  bindMaterialToStoryboard: ReturnType<typeof useStudioStore.getState>["bindMaterialToStoryboard"];
  updateStoryboard: ReturnType<typeof useStudioStore.getState>["updateStoryboard"];
}) {
  const [kind, setKind] = useState<StoryboardMediaRef["kind"]>(props.mediaRef?.kind ?? "image");
  const selectedMaterialId = props.materials.find((material) => material.localPath === props.mediaRef?.path)?.id ?? "";
  return (
    <div className="grid grid-cols-[88px_1fr] gap-2">
      <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={kind} onChange={(event) => setKind(event.target.value as StoryboardMediaRef["kind"])}>
        <option value="image">图片</option>
        <option value="video">视频</option>
        <option value="audio">音频</option>
      </select>
      <select
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        value={selectedMaterialId}
        onChange={(event) => {
          if (event.target.value) props.bindMaterialToStoryboard(props.itemId, event.target.value);
        }}
      >
        <option value="">从素材库绑定</option>
        {props.materials.map((material) => (
          <option key={material.id} value={material.id}>{material.kind} / {material.name}</option>
        ))}
      </select>
      <Input
        className="col-span-2"
        value={props.mediaRef?.path ?? ""}
        onChange={(event) => props.updateStoryboard(props.itemId, { mediaRef: { kind, path: event.target.value } })}
        placeholder="/absolute/path 或 local-image://..."
      />
    </div>
  );
}

function WorkbenchTab(props: {
  storyboards: ReturnType<typeof useStudioStore.getState>["storyboards"];
  tracks: ReturnType<typeof useStudioStore.getState>["productionTracks"];
  candidates: ReturnType<typeof useStudioStore.getState>["videoCandidates"];
  renderingTrackId: string | null;
  merging: boolean;
  mergeOutput: string | null;
  rebuildTracks: () => void;
  renderTrack: (trackId: string) => void;
  selectVideoCandidate: ReturnType<typeof useStudioStore.getState>["selectVideoCandidate"];
  deleteVideoCandidate: ReturnType<typeof useStudioStore.getState>["deleteVideoCandidate"];
  mergeEpisode: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Boxes className="h-4 w-4" />
          {props.tracks.length} 条 track / {props.storyboards.length} 个分镜
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={props.rebuildTracks}><RefreshCw className="h-4 w-4" />重建轨道</Button>
          <Button onClick={props.mergeEpisode} disabled={props.merging}><Film className="h-4 w-4" />拼接成片</Button>
        </div>
      </div>
      {props.mergeOutput && <div className="rounded-md border border-border bg-muted p-3 text-xs">成片输出: {props.mergeOutput}</div>}
      <div className="grid grid-cols-1 gap-3">
        {props.tracks.map((track) => {
          const trackCandidates = props.candidates.filter((candidate) => candidate.trackId === track.id);
          return (
            <Card key={track.id} className="rounded-lg">
              <CardHeader className="flex-row items-center justify-between space-y-0 py-4">
                <div>
                  <CardTitle className="text-sm">{track.trackKey}</CardTitle>
                  <div className="mt-1 text-xs text-muted-foreground">{track.storyboardIds.length} 分镜 / {track.duration}s</div>
                </div>
                <Button onClick={() => props.renderTrack(track.id)} disabled={props.renderingTrackId === track.id}>
                  <Play className="h-4 w-4" />
                  {props.renderingTrackId === track.id ? "合成中" : "本地合成"}
                </Button>
              </CardHeader>
              <CardContent className="grid grid-cols-[1fr_280px] gap-3">
                <pre className="min-h-[120px] whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{track.prompt || "未设置 track prompt"}</pre>
                <div className="space-y-2">
                  {trackCandidates.map((candidate) => (
                    <div key={candidate.id} className="rounded-md border border-border p-2">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant={candidate.state === "ready" ? "default" : candidate.state === "failed" ? "destructive" : "outline"}>{candidate.state}</Badge>
                        <div className="flex gap-1">
                          <Button size="sm" variant={track.selectedVideoId === candidate.id ? "default" : "secondary"} onClick={() => props.selectVideoCandidate(track.id, candidate.id)}>选择</Button>
                          <Button size="sm" variant="destructive" onClick={() => props.deleteVideoCandidate(candidate.id)}>删除</Button>
                        </div>
                      </div>
                      {candidate.filePath && <video className="mt-2 aspect-video w-full rounded bg-black" src={toPreviewSrc(candidate.filePath)} controls />}
                      {candidate.errorReason && <div className="mt-2 text-xs text-destructive">{candidate.errorReason}</div>}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function toPreviewSrc(filePath: string) {
  if (filePath.startsWith("local-image://") || filePath.startsWith("file://")) return filePath;
  return `file://${filePath}`;
}
