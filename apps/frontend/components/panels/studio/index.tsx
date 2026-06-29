import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetOverlay,
  SheetPortal,
} from "@/components/ui/sheet";
import { LocalImage } from "@/components/ui/local-image";
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
  buildEntityExtractionMessages,
  dedupeEntities,
  parseEntityExtraction,
  type KnownEntity,
} from "@/lib/studio/entity-extraction";
import { syncExtractedEntities } from "@/lib/studio/entity-sync";
import {
  buildDirectorPlanMessages,
  parseDirectorPlan,
} from "@/lib/studio/director-plan";
import {
  buildStoryboardTableMessages,
  parseStoryboardTable,
  toStoryboardItems,
} from "@/lib/studio/storyboard-table";
import { buildSeriesBible } from "@/lib/studio/series-bible";
import {
  buildStageMessages,
  buildStageReviewMessages,
  SCRIPT_STAGE_REVIEW_KEY,
  extractPartialContent,
  getStageSkillContent,
  hasReviewIssues,
  parseStageOutput,
  SCRIPT_STAGE_LABEL,
  type ScriptStageKey,
  type ReviewableStage,
} from "@/lib/studio/script-planning";
import { aiManager } from "@/lib/ai/ai-manager";
import {
  buildStudioManualContext,
  buildStudioManualsFromSkillFiles,
  listStudioManualPresets,
  type StudioManualCatalog,
  type StudioManualSkillOverrideFile,
} from "@/lib/studio/manuals";
import {
  createEpisodeMergePlan,
  createTrackRenderPlan,
} from "@/lib/studio/production";
import { buildToonflowWorkbenchModel } from "@/lib/studio/workbench-view-model";
import type { ToonflowWorkbenchAssetMedia } from "@/lib/studio/workbench-view-model";
import {
  buildWorkflowReadiness,
  type WorkflowReadiness,
  type WorkflowStageReadiness,
} from "@/lib/studio/workflow-readiness";
import { useAPIConfigStore } from "@/stores/api-config-store";
import {
  useCharacterLibraryStore,
  type Character,
} from "@/stores/character-library-store";
import { useProjectStore } from "@/stores/project-store";
import { useSceneStore } from "@/stores/scene-store";
import { usePropsLibraryStore } from "@/stores/props-library-store";
import { useStudioStore } from "@/stores/studio-store";
import { useTtsStore } from "@/stores/tts-store";
import type {
  AgentWorkKey,
  NovelChapter,
  ScriptPlan,
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
  AlertCircle,
  ChevronDown,
  Check,
  CheckCircle2,
  Clapperboard,
  ClipboardList,
  Clock,
  Edit3,
  FileText,
  Film,
  GitBranch,
  Download,
  Palette,
  Play,
  Plus,
  RefreshCw,
  Search,
  Split,
  Square,
  Trash2,
  Upload,
  Volume2,
  X,
  WandSparkles,
} from "lucide-react";
import { toast } from "sonner";
import { MdEditor, MdPreview } from "md-editor-rt";
import "md-editor-rt/lib/style.css";
import { cn } from "@/lib/utils";
import { ManualEditDialog } from "./ManualEditDialog";
import { WorkflowNodeCanvas } from "./WorkflowNodeCanvas";
import {
  buildProductionFlowModel,
  type ProductionFlowNodeId,
} from "./workflow-node-model";

export const WORKFLOW_TABS = [
  { value: "manuals", label: "风格与导演", Icon: BookMarked },
  { value: "novel", label: "小说导入", Icon: BookOpen },
  { value: "script", label: "策划编剧", Icon: FileText },
  { value: "assets", label: "剧本资产提取", Icon: Boxes },
  { value: "generation", label: "剧本资产管理", Icon: WandSparkles },
  { value: "storyboard", label: "分镜视频生成", Icon: Split },
  { value: "workbench", label: "视频工作台", Icon: Film },
];

const VISIBLE_WORKFLOW_STAGES = new Set(WORKFLOW_TABS.map((tab) => tab.value));

export function resolveVisibleWorkflowStage(stage?: string): string {
  if (stage === "flow") return "storyboard";
  return stage && VISIBLE_WORKFLOW_STAGES.has(stage) ? stage : "manuals";
}

function WorkflowStageStatusBar({
  readiness,
  activeStage,
  onStageChange,
}: {
  readiness: WorkflowReadiness;
  activeStage: string;
  onStageChange: (stageId: string) => void;
}) {
  const currentStage =
    readiness.stages.find((stage) => stage.id === readiness.nextStageId) ??
    readiness.stages[0];
  const activeLabel =
    WORKFLOW_TABS.find((tab) => tab.value === activeStage)?.label ??
    "风格与导演";
  const activeStageReadiness = readiness.stages.find(
    (stage) => stage.id === activeStage,
  );

  return (
    <div className="mb-4 rounded-lg border border-border/70 bg-card/80 p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="gap-1">
              <Clock className="h-3 w-3" />
              当前所在：{activeLabel}
            </Badge>
            <span>进度 {readiness.progress}%</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-foreground">
              待推进：{currentStage?.label ?? "工作流"}
            </h3>
            <span className="text-sm text-muted-foreground">
              {readiness.nextActionLabel}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" className="gap-2">
                当前阶段：{activeLabel}
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <DropdownMenuLabel>选择工作流阶段</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {readiness.stages.map((stage) => (
                <WorkflowStageMenuItem
                  key={stage.id}
                  stage={stage}
                  active={stage.id === activeStage}
                  onClick={() => onStageChange(stage.id)}
                />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {activeStageReadiness ? (
        <div className="mt-3 rounded-md border border-border/60 bg-background/55 px-3 py-2 text-xs text-muted-foreground">
          {activeStageReadiness.status === "ready"
            ? (activeStageReadiness.completed[0] ?? "当前阶段已完成")
            : (activeStageReadiness.missing[0] ??
              activeStageReadiness.actionLabel)}
        </div>
      ) : null}
    </div>
  );
}

function WorkflowStageMenuItem({
  stage,
  active,
  onClick,
}: {
  stage: WorkflowStageReadiness;
  active: boolean;
  onClick: () => void;
}) {
  const Icon =
    stage.status === "ready"
      ? CheckCircle2
      : stage.status === "active"
        ? Clock
        : AlertCircle;
  return (
    <DropdownMenuItem
      onClick={onClick}
      className={cn(
        "items-start gap-3 py-2",
        stage.status === "ready" && "bg-emerald-500/8 text-emerald-900",
        stage.status === "active" && "bg-amber-500/12 text-amber-950",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 h-4 w-4",
          stage.status === "ready"
            ? "text-emerald-500"
            : stage.status === "active"
              ? "text-amber-500"
              : "text-muted-foreground",
        )}
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">
          {stage.label}
        </span>
        <span className="block text-xs text-muted-foreground">
          {stage.status === "ready"
            ? (stage.completed[0] ?? "已完成")
            : (stage.missing[0] ?? stage.actionLabel)}
        </span>
      </span>
      {active ? (
        <Check className="ml-auto mt-0.5 h-4 w-4 text-primary" />
      ) : null}
    </DropdownMenuItem>
  );
}

/** 把导演规划 ScriptPlan 关键维度压成分镜表的节奏/情绪基准文本。 */
function formatScriptPlanContext(plan: ScriptPlan): string {
  return [
    plan.theme && `①主题立意：${plan.theme}`,
    plan.visualStyle && `②视觉风格：${plan.visualStyle}`,
    plan.narrativeRhythm && `③叙事节奏：${plan.narrativeRhythm}`,
    plan.soundDirection && `⑤声音方向：${plan.soundDirection}`,
    plan.transitions && `⑥转场设计：${plan.transitions}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function latestAgentWork(
  items: { key: AgentWorkKey; episodeId?: string; data: string; updatedAt: number }[],
  key: AgentWorkKey,
  episodeId?: string,
): string {
  const scoped = items
    .filter((item) => item.key === key && item.data.trim())
    .filter((item) => !episodeId || item.episodeId === episodeId);
  const candidates = scoped.length
    ? scoped
    : items.filter((item) => item.key === key && item.data.trim());
  return (
    candidates.slice().sort((left, right) => right.updatedAt - left.updatedAt)[0]
      ?.data ?? ""
  );
}

export function resolveProductionEpisodeId(
  store: ReturnType<typeof useStudioStore.getState>,
  episodeId = "episode-1",
): string {
  if (episodeId !== "episode-1") return episodeId;
  const hasLegacyDraft = store.agentWorkData.some(
    (item) => item.key === "scriptDraft" && item.episodeId === episodeId,
  );
  if (hasLegacyDraft) return episodeId;
  return (
    [...store.agentWorkData]
      .reverse()
      .find((item) => item.key === "scriptDraft" && item.episodeId)
      ?.episodeId ??
    store.novelChapters[0]?.id ??
    episodeId
  );
}

export function resolveScriptTextForEpisode(
  store: ReturnType<typeof useStudioStore.getState>,
  episodeId: string,
): string {
  return (
    [...store.agentWorkData]
      .reverse()
      .find(
        (item) => item.key === "scriptDraft" && item.episodeId === episodeId,
      )?.data ??
    store.novelChapters.find((chapter) => chapter.id === episodeId)
      ?.sourceText ??
    (episodeId === "episode-1"
      ? [...store.agentWorkData]
          .reverse()
          .find((item) => item.key === "scriptDraft")?.data
      : undefined) ??
    store.novelChapters.map((chapter) => chapter.sourceText).join("\n\n")
  );
}

export function resolveScriptPlanEpisodeId(
  store: ReturnType<typeof useStudioStore.getState>,
  episodeId = "episode-1",
): string {
  if (episodeId !== "episode-1") return episodeId;
  if (store.scriptPlans.some((item) => item.episodeId === episodeId))
    return episodeId;
  return (
    store.scriptPlans[store.scriptPlans.length - 1]?.episodeId ??
    resolveProductionEpisodeId(store, episodeId)
  );
}

export function StudioView() {
  const activeProject = useProjectStore((state) => state.activeProject);
  const {
    novelChapters,
    agentWorkData,
    entityExtractions,
    scriptPlans,
    seriesBible,
    storyboards,
    productionTracks,
    videoCandidates,
    workflowConfig,
    appendNovelText,
    replaceNovelText,
    deleteNovelChapters,
    updateNovelChapter,
    setWorkflowConfig,
    saveAgentWorkData,
    saveEntityExtraction,
    saveScriptPlan,
    saveSeriesBible,
    rebuildTracks,
    addVideoCandidate,
    updateVideoCandidate,
    selectVideoCandidate,
    deleteVideoCandidate,
  } = useStudioStore();
  const [novelDraft, setNovelDraft] = useState("");
  const [renderingTrackId, setRenderingTrackId] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [mergeOutput, setMergeOutput] = useState<string | null>(null);
  const [editingWorkflowNodeId, setEditingWorkflowNodeId] =
    useState<ProductionFlowNodeId | null>(null);
  const [workflowNodeDraft, setWorkflowNodeDraft] = useState("");
  const [activeWorkflowTab, setActiveWorkflowTab] = useState(
    resolveVisibleWorkflowStage(workflowConfig.workflowStage),
  );
  const ttsProjectForReadiness = useTtsStore((s) =>
    s.activeProjectId ? s.projects[s.activeProjectId] : undefined,
  );
  const handleStageChange = useCallback(
    (value: string) => {
      const cfg = useStudioStore.getState().workflowConfig;
      if (
        value !== "manuals" &&
        (!cfg.visualManualId || !cfg.directorManualId)
      ) {
        toast.error("请先选择视觉风格与导演手册，才能进入下一步");
        return;
      }
      setActiveWorkflowTab(value);
      setWorkflowConfig({ workflowStage: value });
    },
    [setWorkflowConfig],
  );
  // 切换项目时，自动恢复到该项目保存的工作流阶段
  const prevProjectIdRef = useRef<string | undefined>(activeProject?.id);
  useEffect(() => {
    if (activeProject?.id !== prevProjectIdRef.current) {
      prevProjectIdRef.current = activeProject?.id;
      setActiveWorkflowTab(
        resolveVisibleWorkflowStage(
          useStudioStore.getState().workflowConfig.workflowStage,
        ),
      );
    }
  }, [activeProject?.id]);
  useEffect(() => {
    const visibleStage = resolveVisibleWorkflowStage(
      workflowConfig.workflowStage,
    );
    setActiveWorkflowTab((current) =>
      current === visibleStage ? current : visibleStage,
    );
  }, [workflowConfig.workflowStage]);
  const [novelHeaderActions, setNovelHeaderActions] = useState<ReactNode>(null);
  const [scriptHeaderActions, setScriptHeaderActions] =
    useState<ReactNode>(null);
  const [assetsHeaderActions, setAssetsHeaderActions] =
    useState<ReactNode>(null);
  const bundledManualCatalog = useMemo<StudioManualCatalog>(
    () => ({
      visual: listStudioManualPresets("visual"),
      director: listStudioManualPresets("director"),
    }),
    [],
  );
  const [storedManualCatalog, setStoredManualCatalog] =
    useState<StudioManualCatalog | null>(null);
  const usesStoredManualCatalog =
    typeof window !== "undefined" && Boolean(window.studioSkills?.list);
  const manualCatalog =
    storedManualCatalog ??
    (usesStoredManualCatalog ? {} : bundledManualCatalog);

  const projectName = activeProject?.name ?? "漫影工作室";

  const selectedCandidates = productionTracks
    .map((track) =>
      videoCandidates.find(
        (candidate) => candidate.id === track.selectedVideoId,
      ),
    )
    .filter((candidate): candidate is VideoCandidate => Boolean(candidate));
  const productionEpisodeId = resolveProductionEpisodeId(
    useStudioStore.getState(),
  );
  const workflowReadiness = useMemo(
    () =>
      buildWorkflowReadiness({
        workflowConfig,
        novelChapters,
        agentWorkData,
        entityExtractions,
        scriptPlans,
        seriesBible,
        storyboards,
        productionTracks,
        videoCandidates,
        voiceBindings: Object.values(
          ttsProjectForReadiness?.bindings ?? {},
        ),
        sceneVoiceLines: Object.values(
          ttsProjectForReadiness?.voiceLines ?? {},
        ),
        capabilities: {
          textCompletion: Boolean(window.electronAPI?.textCompletion),
          studioRenderer: Boolean(window.studioRenderer),
        },
      }),
    [
      agentWorkData,
      entityExtractions,
      novelChapters,
      productionTracks,
      scriptPlans,
      seriesBible,
      storyboards,
      ttsProjectForReadiness?.bindings,
      ttsProjectForReadiness?.voiceLines,
      videoCandidates,
      workflowConfig,
    ],
  );
  const productionFlowCharacters = useCharacterLibraryStore(
    (state) => state.characters,
  );
  const productionFlowScenes = useSceneStore((state) => state.scenes);
  const productionFlowProps = usePropsLibraryStore((state) => state.items);
  const productionFlowAssetMediaById = useMemo(
    () =>
      buildWorkbenchAssetMediaMap(
        productionFlowCharacters,
        productionFlowScenes,
        productionFlowProps,
      ),
    [productionFlowCharacters, productionFlowProps, productionFlowScenes],
  );
  const productionFlowModel = useMemo(
    () =>
      buildProductionFlowModel({
        agentWorkData,
        entityExtractions,
        scriptPlans,
        storyboards,
        productionTracks,
        videoCandidates,
        workflowConfig,
        manualCatalog,
        assetMediaById: productionFlowAssetMediaById,
      }),
    [
      agentWorkData,
      entityExtractions,
      productionFlowAssetMediaById,
      productionTracks,
      scriptPlans,
      storyboards,
      videoCandidates,
      workflowConfig,
      manualCatalog,
    ],
  );
  const workflowNodeEditTitle = useMemo(() => {
    const node = productionFlowModel.nodes.find(
      (item) => item.id === editingWorkflowNodeId,
    );
    return node ? `编辑${node.label}` : "编辑节点";
  }, [editingWorkflowNodeId, productionFlowModel.nodes]);
  const workflowNodeEditWritable =
    editingWorkflowNodeId === "script" ||
    editingWorkflowNodeId === "scriptPlan" ||
    editingWorkflowNodeId === "storyboardTable";
  const buildWorkflowNodeDraft = useCallback(
    (nodeId: ProductionFlowNodeId) => {
      const store = useStudioStore.getState();
      const episodeId = resolveProductionEpisodeId(store, productionEpisodeId);
      if (nodeId === "script") {
        return (
          latestAgentWork(store.agentWorkData, "scriptDraft", episodeId) ||
          resolveScriptTextForEpisode(store, episodeId)
        );
      }
      if (nodeId === "scriptPlan") {
        const plan = store.scriptPlans.find((item) => item.episodeId === episodeId);
        return plan
          ? formatScriptPlanContext(plan)
          : latestAgentWork(store.agentWorkData, "directorPlan", episodeId);
      }
      if (nodeId === "storyboardTable") {
        return latestAgentWork(store.agentWorkData, "storyboardTable", episodeId);
      }
      if (nodeId === "assets") {
        return store.entityExtractions
          .flatMap((batch) => [
            `# ${batch.episodeId} 衍生资产`,
            "",
            "## 角色",
            ...batch.characters.map((item) => `- ${item.name} (${item.characterId})${item.note ? `：${item.note}` : ""}`),
            "",
            "## 场景",
            ...batch.scenes.map((item) => `- ${item.name} (${item.sceneId})${item.note ? `：${item.note}` : ""}`),
            "",
            "## 道具",
            ...batch.props.map((item) => `- ${item.name} (${item.assetId})${item.note ? `：${item.note}` : ""}`),
            "",
          ])
          .join("\n");
      }
      if (nodeId === "storyboard") {
        return [
          "| 序号 | 分镜 | 时长 | 台词 | 音效 | 资产 |",
          "| --- | --- | ---: | --- | --- | --- |",
          ...store.storyboards
            .slice()
            .sort((left, right) => left.index - right.index)
            .map((item) =>
              [
                item.index,
                item.videoDesc || item.prompt || item.id,
                item.duration,
                item.lines ?? "",
                item.sound ?? "",
                item.assetIds.join(", "),
              ]
                .map((cell) => String(cell).replace(/\|/g, "\\|"))
                .join(" | "),
            )
            .map((row) => `| ${row} |`),
        ].join("\n");
      }
      return [
        "| Track | 时长 | 状态 | 分镜 | 候选 |",
        "| --- | ---: | --- | --- | --- |",
        ...store.productionTracks.map((track) =>
          `| ${track.trackKey || track.id} | ${track.duration} | ${track.state} | ${track.storyboardIds.length} | ${track.candidateVideoIds.length} |`,
        ),
      ].join("\n");
    },
    [productionEpisodeId],
  );
  const handleWorkflowNodeEdit = useCallback(
    (nodeId: ProductionFlowNodeId) => {
      setEditingWorkflowNodeId(nodeId);
      setWorkflowNodeDraft(buildWorkflowNodeDraft(nodeId));
    },
    [buildWorkflowNodeDraft],
  );
  const handleWorkflowNodeEditSave = useCallback(() => {
    if (!editingWorkflowNodeId) return;
    const store = useStudioStore.getState();
    const episodeId = resolveProductionEpisodeId(store, productionEpisodeId);
    const text = workflowNodeDraft.trim();
    if (editingWorkflowNodeId === "script") {
      saveAgentWorkData("scriptDraft", workflowNodeDraft, episodeId);
      toast.success("剧本已保存");
      setEditingWorkflowNodeId(null);
      return;
    }
    if (editingWorkflowNodeId === "scriptPlan") {
      try {
        const { plan, warnings } = parseDirectorPlan(workflowNodeDraft, episodeId);
        saveScriptPlan(plan);
        toast.success(warnings.length ? `导演规划已保存（提示 ${warnings.length} 条）` : "导演规划已保存");
        setEditingWorkflowNodeId(null);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "导演规划保存失败");
      }
      return;
    }
    if (editingWorkflowNodeId === "storyboardTable") {
      saveAgentWorkData("storyboardTable", workflowNodeDraft, episodeId);
      const parsed = parseStoryboardTable(text, episodeId);
      const items = toStoryboardItems(parsed.rows, episodeId);
      const workflowStore = useStudioStore.getState();
      for (const item of items) {
        if (workflowStore.storyboards.some((current) => current.id === item.id)) {
          workflowStore.updateStoryboard(item.id, item);
        } else {
          workflowStore.addStoryboard(item);
        }
      }
      workflowStore.rebuildTracks();
      const warningText = parsed.errors.length
        ? `，忽略非法行 ${parsed.errors.length} 条`
        : "";
      toast.success(`分镜表已保存：${items.length} 条分镜${warningText}`);
      setEditingWorkflowNodeId(null);
      return;
    }
    toast.info("该节点是结构化数据，请进入对应阶段编辑。");
  }, [
    editingWorkflowNodeId,
    productionEpisodeId,
    saveAgentWorkData,
    saveScriptPlan,
    workflowNodeDraft,
  ]);
  const handleNovelFile = async (file?: File) => {
    if (!file) return;
    const text = await file.text();
    setNovelDraft(text);
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
        const manualFiles = files.filter((file) =>
          isManualSkillMarkdownPath(file.relativePath),
        );
        const loaded = await Promise.all(
          manualFiles.map(async (file) => {
            const result = await studioSkills.readText(file.relativePath);
            if (!result.success) return null;
            return {
              relativePath: file.relativePath,
              content: result.content ?? "",
            } satisfies StudioManualSkillOverrideFile;
          }),
        );
        const skillFiles = loaded.filter(
          (file): file is StudioManualSkillOverrideFile => Boolean(file),
        );
        const imagesByManualId = Object.fromEntries(
          visualManuals.map((manual) => [
            manual.stylePath,
            manual.images.map((image) => image.url),
          ]),
        );
        if (!cancelled) {
          setStoredManualCatalog({
            visual: buildStudioManualsFromSkillFiles("visual", skillFiles, {
              imagesByManualId,
            }),
            director: buildStudioManualsFromSkillFiles("director", skillFiles),
          });
        }
      } catch (error) {
        console.warn(
          "[StudioView] Failed to load stored manual catalog:",
          error,
        );
      }
    };
    void loadStoredManualCatalog();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleNovelEventAnalysis = useCallback(
    async (chapters: NovelChapter[]) => {
      if (!chapters.length) return;
      if (!window.electronAPI?.textCompletion) {
        toast.error("当前环境不支持模型调用");
        return;
      }

      if (
        !aiManager.resolve({ agent: "eventAnalysisAgent" }) &&
        !aiManager.resolve({ agent: "universalAi" })
      ) {
        toast.error(
          "未配置事件分析模型，请先到设置的 API 管理中绑定事件分析Agent或通用AI",
        );
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
          const result = await aiManager.text({
            binding: { agent: "eventAnalysisAgent" },
            messages: [
              { role: "system", content: messages.system },
              { role: "user", content: messages.user },
            ],
            temperature: 0.2,
            maxTokens: 1024,
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
            eventErrorReason:
              error instanceof Error ? error.message : String(error),
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
    },
    [saveAgentWorkData, updateNovelChapter],
  );

  const handleEntityExtraction = useCallback(
    async (episodeId = "episode-1") => {
      if (!window.electronAPI?.textCompletion) {
        toast.error("当前环境不支持模型调用");
        return;
      }

      const store = useStudioStore.getState();
      const targetEpisodeId = resolveProductionEpisodeId(store, episodeId);
      const scriptText = resolveScriptTextForEpisode(store, targetEpisodeId);
      if (!scriptText.trim()) {
        toast.error("没有可提取的剧本：请先保存剧本草稿或导入小说正文");
        return;
      }

      // 合并已有提取结果 + 资产库里已有的角色/场景/道具
      const libChars = useCharacterLibraryStore.getState().characters;
      const libScenes = useSceneStore.getState().scenes;
      const libProps = usePropsLibraryStore.getState().items;

      const knownEntities: KnownEntity[] = [
        // 先收集已提取的实体
        ...store.entityExtractions.flatMap((batch) => [
          ...batch.characters.map((item) => ({
            id: item.characterId,
            kind: "character" as const,
            name: item.name,
            aliases: item.aliases,
          })),
          ...batch.scenes.map((item) => ({
            id: item.sceneId,
            kind: "scene" as const,
            name: item.name,
            aliases: [],
          })),
          ...batch.props.map((item) => ({
            id: item.assetId,
            kind: "prop" as const,
            name: item.name,
            aliases: [],
          })),
        ]),
        // 补充资产库里已有的角色（按 ID 去重）
        ...libChars
          .filter(
            (c) =>
              !store.entityExtractions.some((b) =>
                b.characters.some((bc) => bc.characterId === c.id),
              ),
          )
          .map((c) => ({
            id: c.id,
            kind: "character" as const,
            name: c.name,
            aliases:
              ((c as unknown as Record<string, unknown>).aliases as string[]) ??
              [],
          })),
        // 补充资产库里已有的场景
        ...libScenes
          .filter(
            (s) =>
              !store.entityExtractions.some((b) =>
                b.scenes.some((bs) => bs.sceneId === s.id),
              ),
          )
          .map((s) => ({
            id: s.id,
            kind: "scene" as const,
            name: s.name,
            aliases: [],
          })),
        // 补充资产库里已有的道具
        ...libProps
          .filter(
            (p) =>
              !store.entityExtractions.some((b) =>
                b.props.some((bp) => bp.assetId === p.id),
              ),
          )
          .map((p) => ({
            id: p.id,
            kind: "prop" as const,
            name: p.name,
            aliases: [],
          })),
      ];

      const messages = buildEntityExtractionMessages({
        episodeId: targetEpisodeId,
        scriptText,
        knownEntities,
      });
      try {
        const result = await aiManager.text({
          binding: { agent: "entityExtraction" },
          messages: [
            { role: "system", content: messages.system },
            { role: "user", content: messages.user },
          ],
          temperature: 0.2,
          maxTokens: 2048,
        });
        if (!result.success || !result.text) {
          throw new Error(result.error || "实体提取失败");
        }

        const parsed = parseEntityExtraction(result.text, targetEpisodeId);
        const { entities } = dedupeEntities(parsed.entities, knownEntities);
        if (!entities.length) {
          toast.error("未解析出任何实体，请检查模型输出格式");
          return;
        }

        // 写入 characters.json + assets.db，走完整管线
        const { createMystudioSinks } =
          await import("@/lib/studio/entity-sync");
        const sinks = createMystudioSinks();
        const { result: batch } = syncExtractedEntities(
          {
            episodeId: targetEpisodeId,
            entities,
            projectId: activeProject?.id ?? "",
            projectName,
          },
          sinks,
        );
        saveEntityExtraction(batch);

        const detail = `角色 ${batch.characters.length} / 场景 ${batch.scenes.length} / 道具 ${batch.props.length}`;
        if (parsed.errors.length) {
          toast.warning(
            `资产提取完成（忽略非法行 ${parsed.errors.length}）：${detail}`,
          );
        } else {
          toast.success(`资产提取完成：${detail}`);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
    },
    [activeProject?.id, projectName, saveEntityExtraction],
  );

  const handleDirectorPlan = useCallback(
    async (episodeId = "episode-1", userInstruction = "") => {
      if (!window.electronAPI?.textCompletion) {
        toast.error("当前环境不支持模型调用");
        return;
      }

      const store = useStudioStore.getState();
      const targetEpisodeId = resolveProductionEpisodeId(store, episodeId);
      const scriptText = resolveScriptTextForEpisode(store, targetEpisodeId);
      if (!scriptText.trim()) {
        toast.error("没有可规划的剧本：请先保存剧本草稿或导入小说正文");
        return;
      }

      const manualContext = buildStudioManualContext(
        store.workflowConfig,
        manualCatalog,
      );
      const messages = buildDirectorPlanMessages({
        episodeId: targetEpisodeId,
        scriptText,
        manualContext,
      });
      const userContent = userInstruction.trim()
        ? `${messages.user}\n\n【本次节点补充要求】\n${userInstruction.trim()}`
        : messages.user;
      try {
        const result = await aiManager.text({
          binding: { agent: "productionAgent:directorPlanAgent" },
          messages: [
            { role: "system", content: messages.system },
            { role: "user", content: userContent },
          ],
          temperature: 0.4,
          maxTokens: 4096,
        });
        if (!result.success || !result.text) {
          throw new Error(result.error || "导演规划失败");
        }

        const { plan, warnings } = parseDirectorPlan(
          result.text,
          targetEpisodeId,
        );
        saveScriptPlan(plan);

        const detail = `衍生预划 ${plan.derivedAssetPlan.length} 条`;
        if (warnings.length) {
          toast.warning(
            `导演规划完成（${detail}；光影提示 ${warnings.length} 处已剔除）`,
          );
        } else {
          toast.success(`导演规划完成（${detail}）`);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
    },
    [manualCatalog, saveScriptPlan],
  );

  const handleStoryboardTable = useCallback(
    async (episodeId = "episode-1", userInstruction = "") => {
      if (!window.electronAPI?.textCompletion) {
        toast.error("当前环境不支持模型调用");
        return;
      }

      const store = useStudioStore.getState();
      const targetEpisodeId = resolveScriptPlanEpisodeId(store, episodeId);
      const scriptText = resolveScriptTextForEpisode(store, targetEpisodeId);
      if (!scriptText.trim()) {
        toast.error("没有可生成分镜表的剧本：请先保存剧本草稿或导入小说正文");
        return;
      }

      const plan = store.scriptPlans.find(
        (item) => item.episodeId === targetEpisodeId,
      );
      if (!plan) {
        toast.error("尚无导演规划：请先在分镜视频生成节点中生成导演规划");
        return;
      }

      const messages = buildStoryboardTableMessages({
        episodeId: targetEpisodeId,
        scriptText,
        scriptPlanContext: formatScriptPlanContext(plan),
      });
      const userContent = userInstruction.trim()
        ? `${messages.user}\n\n【本次节点补充要求】\n${userInstruction.trim()}`
        : messages.user;

      try {
        const result = await aiManager.text({
          binding: { agent: "productionAgent:storyboardTableAgent" },
          messages: [
            { role: "system", content: messages.system },
            { role: "user", content: userContent },
          ],
          temperature: 0.35,
          maxTokens: 8192,
        });
        if (!result.success || !result.text) {
          throw new Error(result.error || "分镜表生成失败");
        }

        saveAgentWorkData("storyboardTable", result.text, targetEpisodeId);
        const parsed = parseStoryboardTable(result.text, targetEpisodeId);
        const items = toStoryboardItems(parsed.rows, targetEpisodeId);
        const workflowStore = useStudioStore.getState();
        for (const item of items) {
          if (workflowStore.storyboards.some((current) => current.id === item.id)) {
            workflowStore.updateStoryboard(item.id, item);
          } else {
            workflowStore.addStoryboard(item);
          }
        }
        workflowStore.rebuildTracks();

        const warningText = parsed.warnings.length
          ? `，提示 ${parsed.warnings.length} 条`
          : "";
        toast.success(`分镜表完成：${items.length} 条分镜${warningText}`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
    },
    [saveAgentWorkData],
  );

  const handleProductionNodeAction = useCallback(
    async (action: { id: string; targetStage: string; userInstruction?: string }) => {
      if (action.id === "generate-director-plan") {
        await handleDirectorPlan(productionEpisodeId, action.userInstruction ?? "");
        return;
      }
      if (action.id === "generate-storyboard-table") {
        await handleStoryboardTable(productionEpisodeId, action.userInstruction ?? "");
        return;
      }
      handleStageChange(action.targetStage);
    },
    [handleDirectorPlan, handleStageChange, handleStoryboardTable, productionEpisodeId],
  );

  const handleBuildSeriesBible = useCallback(() => {
    const projectId = activeProject?.id;
    if (!projectId) {
      toast.error("未选择项目，无法锁定剧集圣经");
      return;
    }

    const characters = useCharacterLibraryStore
      .getState()
      .characters.filter(
        (item) => !item.projectId || item.projectId === projectId,
      );
    const scenes = useSceneStore
      .getState()
      .scenes.filter((item) => !item.projectId || item.projectId === projectId);

    const config = useStudioStore.getState().workflowConfig;
    const bible = buildSeriesBible({
      projectId,
      characters: characters.map((item) => ({
        id: item.id,
        appearance: item.appearance,
        description: item.description,
      })),
      scenes: scenes.map((item) => ({ name: item.name })),
      config: {
        visualManualId: config.visualManualId,
        directorManualId: config.directorManualId,
        platformSpec: config.platformSpec,
        stylePositioning: config.stylePositioning,
      },
    });

    saveSeriesBible(bible);
    toast.success(
      `剧集圣经已锁定（角色 ${bible.characterLocks.length} / 场景 ${bible.sceneLocks.length}，画幅 ${bible.aspectRatio}）`,
    );
  }, [activeProject?.id, saveSeriesBible]);

  const scriptStyleSummary = useMemo(() => {
    const visual = manualCatalog.visual?.find(
      (p) => p.id === workflowConfig.visualManualId,
    )?.name;
    return [
      "## 项目信息",
      `小说名称：${projectName}`,
      workflowConfig.novelGenre ? `小说类型：${workflowConfig.novelGenre}` : "",
      `目标画风：${visual || workflowConfig.stylePositioning || "未设"}`,
      `目标画幅：${workflowConfig.platformSpec || "16:9"}`,
      workflowConfig.episodeCount
        ? `集数：${workflowConfig.episodeCount}集`
        : "",
      `单集时长：${workflowConfig.episodeDurationMin ?? 3}分钟`,
      `章节数量：${novelChapters.length}章`,
    ]
      .filter(Boolean)
      .join("\n");
  }, [
    projectName,
    workflowConfig.visualManualId,
    workflowConfig.novelGenre,
    workflowConfig.stylePositioning,
    workflowConfig.platformSpec,
    workflowConfig.episodeCount,
    workflowConfig.episodeDurationMin,
    manualCatalog,
    novelChapters.length,
  ]);

  const scriptDirectorContext = useMemo(
    () => buildStudioManualContext(workflowConfig, manualCatalog),
    [workflowConfig, manualCatalog],
  );

  const latestScriptStage = useCallback(
    (key: AgentWorkKey, scopeId: string) =>
      [...agentWorkData]
        .reverse()
        .find((item) => item.key === key && item.episodeId === scopeId)?.data ??
      "",
    [agentWorkData],
  );

  const [scriptStreaming, setScriptStreaming] = useState<{
    key: AgentWorkKey;
    scopeId: string;
    text: string;
  } | null>(null);

  const runScriptStage = useCallback(
    async (opts: {
      agentKey:
        | "storySkeletonAgent"
        | "adaptationStrategyAgent"
        | "scriptDraft";
      messages: { system: string; user: string };
      stageKey: AgentWorkKey;
      scopeId: string;
      label: string;
      revised?: boolean;
    }) => {
      setScriptStreaming({
        key: opts.stageKey,
        scopeId: opts.scopeId,
        text: "",
      });
      const result = await aiManager.textStream(
        {
          binding: { agent: opts.agentKey },
          maxTokens: 32000,
          messages: [
            { role: "system", content: opts.messages.system },
            { role: "user", content: opts.messages.user },
          ],
        },
        (delta) =>
          setScriptStreaming((s) =>
            s && s.key === opts.stageKey && s.scopeId === opts.scopeId
              ? { ...s, text: s.text + delta }
              : s,
          ),
      );
      setScriptStreaming(null);
      if (!result.success || !result.text) {
        toast.error(result.error || `${opts.label}生成失败`);
        return;
      }
      saveAgentWorkData(
        opts.stageKey,
        parseStageOutput(result.text),
        opts.scopeId,
      );
      toast.success(
        opts.revised
          ? `已按审核修订「${opts.label}」，请重新审核确认`
          : `${opts.label}已生成`,
      );
    },
    [saveAgentWorkData],
  );

  const handleScriptStage = useCallback(
    (stage: ScriptStageKey, chapter: NovelChapter, userOverride?: string) => {
      const skeleton = latestScriptStage("storySkeleton", chapter.id);
      const strategy = latestScriptStage("adaptationStrategy", chapter.id);
      const scriptDraft = latestScriptStage("scriptDraft", chapter.id);
      const reviewKey = SCRIPT_STAGE_REVIEW_KEY[stage as ReviewableStage];
      const review = reviewKey ? latestScriptStage(reviewKey, chapter.id) : "";
      if (stage === "adaptationStrategy" && !skeleton) {
        toast.error("请先生成故事骨架");
        return;
      }
      if (stage === "scriptDraft" && (!skeleton || !strategy)) {
        toast.error("请先生成故事骨架与改编策略");
        return;
      }
      const built = buildStageMessages(stage, {
        manualContext: scriptStyleSummary,
        directorContext: scriptDirectorContext,
        chapterTitle: chapter.title,
        chapterText: chapter.sourceText,
        eventState: chapter.eventState,
        skeleton,
        strategy,
        scriptDraft,
        reviewFeedback: hasReviewIssues(review) ? review : undefined,
        previousOutput: latestScriptStage(stage, chapter.id),
      });
      return runScriptStage({
        agentKey:
          stage === "storySkeleton"
            ? "storySkeletonAgent"
            : stage === "adaptationStrategy"
              ? "adaptationStrategyAgent"
              : "scriptDraft",
        messages: { system: built.system, user: userOverride || built.user },
        stageKey: stage,
        scopeId: chapter.id,
        label: SCRIPT_STAGE_LABEL[stage],
        revised: hasReviewIssues(review),
      });
    },
    [
      runScriptStage,
      latestScriptStage,
      scriptStyleSummary,
      scriptDirectorContext,
    ],
  );

  const handleStageReview = useCallback(
    (stage: ReviewableStage, chapter: NovelChapter) => {
      const target = latestScriptStage(stage, chapter.id);
      if (!target) {
        toast.error(`请先生成${SCRIPT_STAGE_LABEL[stage]}`);
        return;
      }
      const built = buildStageReviewMessages(stage, {
        manualContext: scriptStyleSummary,
        chapterTitle: chapter.title,
        chapterText: chapter.sourceText,
        eventState: chapter.eventState,
        skeleton: latestScriptStage("storySkeleton", chapter.id),
        strategy: latestScriptStage("adaptationStrategy", chapter.id),
        scriptDraft: latestScriptStage("scriptDraft", chapter.id),
      });
      return runScriptStage({
        agentKey: "scriptDraft",
        messages: { system: built.system, user: built.user },
        stageKey: SCRIPT_STAGE_REVIEW_KEY[stage],
        scopeId: chapter.id,
        label: `${SCRIPT_STAGE_LABEL[stage]}审核`,
      });
    },
    [runScriptStage, latestScriptStage, scriptStyleSummary],
  );

  const handleRenderTrack = async (trackId: string) => {
    const track = productionTracks.find((item) => item.id === trackId);
    if (!track) return;

    let candidateId = "";
    try {
      const plan = createTrackRenderPlan(track, storyboards);
      candidateId = addVideoCandidate({
        trackId,
        provider: "ffmpeg-local",
        state: "rendering",
      });
      setRenderingTrackId(trackId);

      const result = await window.studioRenderer?.renderTrackCandidate(plan);
      if (!result?.success || !result.filePath) {
        throw new Error(result?.error || "本地 FFmpeg 合成失败");
      }

      updateVideoCandidate(candidateId, {
        state: "ready",
        filePath: result.filePath,
      });
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
      const episodeId =
        productionTracks.find((track) =>
          selectedCandidates.some(
            (candidate) => candidate.trackId === track.id,
          ),
        )?.episodeId ?? resolveProductionEpisodeId(useStudioStore.getState());
      saveAgentWorkData(
        "productionPlan",
        `本地成片输出: ${result.filePath}`,
        episodeId,
      );
      toast.success("成片已拼接完成");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setMerging(false);
    }
  };

  return (
    <div className="studio-workspace studio-workspace-workflow h-full bg-[#20201f]">
      <Tabs
        value={activeWorkflowTab}
        onValueChange={handleStageChange}
        className="flex h-full flex-col"
      >
        <ScrollArea className="h-full min-h-0 flex-1 scrollbar-hidden">
          <div className="flex h-full min-h-0 flex-col bg-background p-5">
            <WorkflowStageStatusBar
              readiness={workflowReadiness}
              activeStage={activeWorkflowTab}
              onStageChange={handleStageChange}
            />

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

            <TabsContent value="script" className="m-0">
              <ScriptTab
                novelChapters={novelChapters}
                agentWorkData={agentWorkData}
                saveAgentWorkData={saveAgentWorkData}
                runStage={handleScriptStage}
                runReview={handleStageReview}
                manualContext={scriptStyleSummary}
                directorContext={scriptDirectorContext}
                styleSummary={scriptStyleSummary}
                setHeaderActions={setScriptHeaderActions}
                scriptStreaming={scriptStreaming}
              />
            </TabsContent>

            <TabsContent value="assets" className="m-0">
              <AssetsTab
                novelChapters={novelChapters}
                agentWorkData={agentWorkData}
                entityExtractions={entityExtractions}
                extractAssets={handleEntityExtraction}
                updateExtraction={saveEntityExtraction}
                setHeaderActions={setAssetsHeaderActions}
              />
            </TabsContent>

            <TabsContent value="generation" className="m-0">
              <AssetsTab
                mode="manage"
                novelChapters={novelChapters}
                agentWorkData={agentWorkData}
                entityExtractions={entityExtractions}
                extractAssets={handleEntityExtraction}
                updateExtraction={saveEntityExtraction}
                setHeaderActions={setAssetsHeaderActions}
              />
            </TabsContent>

            <TabsContent
              value="storyboard"
              className="m-0 min-h-0 flex-1 data-[state=active]:flex data-[state=inactive]:hidden"
            >
              <WorkflowNodeCanvas
                projectName={projectName}
                nodes={productionFlowModel.nodes}
                onStageChange={handleStageChange}
                onNodeEdit={handleWorkflowNodeEdit}
                onNodeAction={handleProductionNodeAction}
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
      <Dialog
        open={Boolean(editingWorkflowNodeId)}
        onOpenChange={(open) => {
          if (!open) setEditingWorkflowNodeId(null);
        }}
      >
        <DialogContent className="flex h-[88vh] max-w-[92vw] flex-col gap-3 border-white/10 bg-[#171817] text-zinc-100 sm:max-w-[92vw]">
          <DialogHeader>
            <DialogTitle>{workflowNodeEditTitle}</DialogTitle>
            <DialogDescription className="text-zinc-500">
              {workflowNodeEditWritable
                ? "编辑当前节点 FlowData Markdown，保存后会回写工作流数据。"
                : "该节点由结构化数据生成，可查看 Markdown 摘要；请进入对应阶段编辑明细。"}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-white/10">
            <MdEditor
              modelValue={workflowNodeDraft}
              onChange={setWorkflowNodeDraft}
              theme="dark"
              language="zh-CN"
              toolbarsExclude={["github"]}
              readOnly={!workflowNodeEditWritable}
              style={{ height: "100%" }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditingWorkflowNodeId(null)}
            >
              取消
            </Button>
            {workflowNodeEditWritable ? (
              <Button onClick={handleWorkflowNodeEditSave}>保存</Button>
            ) : (
              <Button
                type="button"
                onClick={() => {
                  if (editingWorkflowNodeId) {
                    const node = productionFlowModel.nodes.find(
                      (item) => item.id === editingWorkflowNodeId,
                    );
                    if (node) handleStageChange(node.targetStage);
                  }
                  setEditingWorkflowNodeId(null);
                }}
              >
                进入阶段
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
      <span className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
        <Plus className="h-4 w-4" />
        导入原文
      </span>
    </button>
  );
}

export function NovelTab(props: {
  novelDraft: string;
  setNovelDraft: (value: string) => void;
  handleNovelFile: (file?: File) => void | Promise<void>;
  appendNovelText: (value: string, sourceName?: string) => void;
  replaceNovelText: (value: string, sourceName?: string) => void;
  deleteNovelChapters: ReturnType<
    typeof useStudioStore.getState
  >["deleteNovelChapters"];
  novelChapters: ReturnType<typeof useStudioStore.getState>["novelChapters"];
  updateNovelChapter: ReturnType<
    typeof useStudioStore.getState
  >["updateNovelChapter"];
  analyzeEvents: (chapters: NovelChapter[]) => void | Promise<void>;
  setHeaderActions: (actions: ReactNode) => void;
}) {
  const setHeaderActions = props.setHeaderActions;
  const [importOpen, setImportOpen] = useState(false);
  const [importMode, setImportMode] = useState<"append" | "replace">("append");
  const [importSourceName, setImportSourceName] = useState("");
  const [searchText, setSearchText] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingChapter, setEditingChapter] = useState<NovelChapter | null>(
    null,
  );
  const [deletingChapter, setDeletingChapter] = useState<NovelChapter | null>(
    null,
  );
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
  const visibleSelectedCount = filteredChapters.filter((chapter) =>
    selectedIds.has(chapter.id),
  ).length;
  const allVisibleSelected =
    filteredChapters.length > 0 &&
    visibleSelectedCount === filteredChapters.length;

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
    toast.success(
      importMode === "replace" ? "小说章节已覆盖导入" : "小说章节已追加导入",
    );
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
    const ids = deletingChapter
      ? [deletingChapter.id]
      : Array.from(selectedIds);
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
        <Button
          variant="destructive"
          disabled={selectedIds.size === 0}
          onClick={openBatchDelete}
        >
          <Trash2 className="h-4 w-4" />
          批量删除 ({selectedIds.size})
        </Button>
        <Button
          variant="secondary"
          disabled={selectedIds.size === 0}
          onClick={handleAnalyzeSelectedChapters}
        >
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
                <Checkbox
                  checked={allVisibleSelected}
                  onCheckedChange={(checked) =>
                    toggleAllVisible(checked === true)
                  }
                />
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
              <TableRow
                key={chapter.id}
                data-state={
                  selectedIds.has(chapter.id) ? "selected" : undefined
                }
              >
                <TableCell>
                  <Checkbox
                    checked={selectedIds.has(chapter.id)}
                    onCheckedChange={(checked) =>
                      toggleChapter(chapter.id, checked === true)
                    }
                  />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {chapter.index}
                </TableCell>
                <TableCell className="text-xs">
                  {chapter.volume ?? "正文卷"}
                </TableCell>
                <TableCell>
                  <div className="line-clamp-2 font-medium">
                    {chapter.title}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {chapter.sourceText}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {chapter.eventSummary || "未填写"}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {chapter.eventState || "未填写"}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="text"
                      onClick={() => openEdit(chapter)}
                    >
                      <Edit3 className="h-4 w-4" />
                      编辑
                    </Button>
                    <Button
                      size="sm"
                      variant="text"
                      className="text-destructive hover:text-destructive"
                      onClick={() => openSingleDelete(chapter)}
                    >
                      <Trash2 className="h-4 w-4" />
                      删除
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!filteredChapters.length && (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="h-40 text-center text-sm text-muted-foreground"
                >
                  <NovelEmptyState
                    hasNovelChapters={props.novelChapters.length > 0}
                    onImport={handleOpenImport}
                  />
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
            <DialogDescription>
              TXT/Markdown 会拆成章节，并把原文写成文档保存到当前项目存储位置。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label className="flex min-h-20 cursor-pointer items-center justify-between gap-4 rounded-lg border border-dashed border-primary/45 bg-primary/5 px-4 py-3 transition-colors hover:bg-primary/10">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                  <Upload className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    选择 TXT/Markdown 文件
                  </span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    {importSourceName ||
                      "支持 .txt、.md，也可以直接在下方粘贴原文。"}
                  </span>
                </span>
              </div>
              <span className="shrink-0 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium">
                选择文件
              </span>
              <input
                type="file"
                accept=".txt,.md,text/plain,text/markdown"
                className="sr-only"
                onChange={(event) => handleImportFile(event.target.files?.[0])}
              />
            </Label>
            <div className="flex gap-2">
              <Button
                variant={importMode === "append" ? "default" : "secondary"}
                onClick={() => setImportMode("append")}
              >
                追加导入
              </Button>
              <Button
                variant={importMode === "replace" ? "default" : "secondary"}
                onClick={() => setImportMode("replace")}
              >
                覆盖导入
              </Button>
            </div>
            <Textarea
              value={props.novelDraft}
              onChange={(event) => props.setNovelDraft(event.target.value)}
              className="min-h-[360px] font-mono text-xs"
              placeholder="粘贴小说原文，或选择 .txt/.md 文件。"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              取消
            </Button>
            <Button
              onClick={handleConfirmImport}
              disabled={!props.novelDraft.trim()}
            >
              确认导入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(editingChapter)}
        onOpenChange={(open) => !open && setEditingChapter(null)}
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>编辑章节</DialogTitle>
            <DialogDescription>
              保存后会同步更新项目存储位置下的章节文档。
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-[160px_1fr] gap-3">
            <Input
              value={editDraft.volume}
              onChange={(event) =>
                setEditDraft((draft) => ({
                  ...draft,
                  volume: event.target.value,
                }))
              }
              placeholder="卷"
            />
            <Input
              value={editDraft.title}
              onChange={(event) =>
                setEditDraft((draft) => ({
                  ...draft,
                  title: event.target.value,
                }))
              }
              placeholder="章节名称"
            />
            <Textarea
              className="col-span-2 min-h-[260px] font-mono text-xs"
              value={editDraft.sourceText}
              onChange={(event) =>
                setEditDraft((draft) => ({
                  ...draft,
                  sourceText: event.target.value,
                }))
              }
              placeholder="章节内容"
            />
            <Textarea
              className="min-h-[120px]"
              value={editDraft.eventSummary}
              onChange={(event) =>
                setEditDraft((draft) => ({
                  ...draft,
                  eventSummary: event.target.value,
                }))
              }
              placeholder="事件摘要"
            />
            <Textarea
              className="min-h-[120px]"
              value={editDraft.eventState}
              onChange={(event) =>
                setEditDraft((draft) => ({
                  ...draft,
                  eventState: event.target.value,
                }))
              }
              placeholder="事件状态"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingChapter(null)}>
              取消
            </Button>
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
            <AlertDialogCancel onClick={() => setDeletingChapter(null)}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              删除
            </AlertDialogAction>
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
  const [editing, setEditing] = useState<{
    kind: "visual" | "director";
    manual: StudioManualPreset;
  } | null>(null);

  return (
    <div className="grid grid-cols-[320px_1fr] gap-5">
      {/* 左：项目配置（ToonFlow 风格）*/}
      <Card className="h-fit rounded-lg">
        <CardHeader>
          <CardTitle className="text-sm">项目配置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">项目类型</Label>
            <select
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={props.workflowConfig.projectType ?? "novel"}
              onChange={(e) =>
                props.setWorkflowConfig({ projectType: e.target.value })
              }
            >
              <option value="novel">基于小说原文</option>
              <option value="script">基于剧本</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              单集时长（分钟）
            </Label>
            <Input
              type="number"
              min={1}
              value={props.workflowConfig.episodeDurationMin ?? 3}
              onChange={(e) =>
                props.setWorkflowConfig({
                  episodeDurationMin: e.target.value
                    ? Number(e.target.value)
                    : undefined,
                })
              }
              className="h-8"
              placeholder="例如 3"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">集数</Label>
            <Input
              type="number"
              min={1}
              value={props.workflowConfig.episodeCount ?? ""}
              onChange={(e) =>
                props.setWorkflowConfig({
                  episodeCount: e.target.value
                    ? Number(e.target.value)
                    : undefined,
                })
              }
              className="h-8"
              placeholder="例如 12"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">小说类型</Label>
            <Input
              value={props.workflowConfig.novelGenre ?? ""}
              onChange={(e) =>
                props.setWorkflowConfig({
                  novelGenre: e.target.value || undefined,
                })
              }
              className="h-8"
              placeholder="例如 玄幻、科幻、言情"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">平台规格</Label>
            <select
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={props.workflowConfig.platformSpec ?? ""}
              onChange={(e) =>
                props.setWorkflowConfig({
                  platformSpec: e.target.value || undefined,
                })
              }
            >
              <option value="">未选择</option>
              <option value="16:9">16:9 横屏</option>
              <option value="9:16">9:16 竖屏</option>
              <option value="1:1">1:1 方形</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">小说简介</Label>
            <Textarea
              value={props.workflowConfig.novelSynopsis ?? ""}
              onChange={(e) =>
                props.setWorkflowConfig({
                  novelSynopsis: e.target.value || undefined,
                })
              }
              className="min-h-[120px] text-sm"
              placeholder="请输入小说简介"
            />
          </div>
        </CardContent>
      </Card>

      {/* 右：视觉手册 + 导演手册 */}
      <div className="space-y-5">
        {/* 视觉手册网格 */}
        <section>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Palette className="h-4 w-4" /> 视觉手册（画风）
            <span className="text-xs font-normal text-muted-foreground">
              {visualManuals.length} 个 · 点击选择
            </span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
            {visualManuals.map((manual) => {
              const active = manual.id === props.workflowConfig.visualManualId;
              return (
                <div
                  key={manual.id}
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    props.setWorkflowConfig({
                      visualManualId: active ? undefined : manual.id,
                    })
                  }
                  className={cn(
                    "group relative cursor-pointer overflow-hidden rounded-lg border bg-card text-left transition-colors",
                    active
                      ? "border-primary ring-2 ring-primary/30"
                      : "border-border hover:border-primary/40",
                  )}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditing({ kind: "visual", manual });
                    }}
                    className="absolute right-1.5 top-1.5 z-10 hidden rounded-md bg-background/90 p-1 shadow group-hover:block hover:text-primary"
                    title="编辑文档"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                  </button>
                  <div className="aspect-video overflow-hidden bg-muted">
                    {manual.images?.[0] ? (
                      <img
                        src={manual.images[0]}
                        alt={manual.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <Palette className="h-6 w-6 opacity-30" />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                    <span className="truncate text-xs font-medium">
                      {manual.name}
                    </span>
                    {active ? (
                      <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                    ) : null}
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
            <span className="text-xs font-normal text-muted-foreground">
              {directorManuals.length} 个 · 点击选择
            </span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
            {directorManuals.map((manual) => {
              const active =
                manual.id === props.workflowConfig.directorManualId;
              return (
                <div
                  key={manual.id}
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    props.setWorkflowConfig({
                      directorManualId: active ? undefined : manual.id,
                    })
                  }
                  className={cn(
                    "group relative cursor-pointer rounded-lg border p-3 text-left transition-colors",
                    active
                      ? "border-primary bg-primary/5 ring-2 ring-primary/30"
                      : "border-border hover:border-primary/40",
                  )}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditing({ kind: "director", manual });
                    }}
                    className="absolute right-1.5 top-1.5 z-10 hidden rounded-md bg-background/90 p-1 shadow group-hover:block hover:text-primary"
                    title="编辑文档"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                  </button>
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-sm font-medium">
                      {manual.name}
                    </span>
                    {active ? (
                      <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                    ) : null}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    导演叙事手法技能包
                  </p>
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
        onOpenChange={(o) => {
          if (!o) setEditing(null);
        }}
      />
    </div>
  );
}

function isManualSkillMarkdownPath(relativePath: string) {
  return (
    relativePath.endsWith(".md") &&
    (relativePath.startsWith("art_skills/") ||
      relativePath.startsWith("story_skills/"))
  );
}

function ScriptTab(props: {
  novelChapters: ReturnType<typeof useStudioStore.getState>["novelChapters"];
  agentWorkData: ReturnType<typeof useStudioStore.getState>["agentWorkData"];
  saveAgentWorkData: ReturnType<
    typeof useStudioStore.getState
  >["saveAgentWorkData"];
  runStage: (
    stage: ScriptStageKey,
    chapter: NovelChapter,
    userOverride?: string,
  ) => void;
  runReview: (stage: ReviewableStage, chapter: NovelChapter) => void;
  manualContext: string;
  directorContext: string;
  styleSummary: string;
  setHeaderActions: (actions: ReactNode) => void;
  scriptStreaming: { key: AgentWorkKey; scopeId: string; text: string } | null;
}) {
  const SCRIPT_STAGES: ScriptStageKey[] = [
    "storySkeleton",
    "adaptationStrategy",
    "scriptDraft",
  ];
  const PREREQ: Partial<Record<ScriptStageKey, ScriptStageKey>> = {
    adaptationStrategy: "storySkeleton",
    scriptDraft: "adaptationStrategy",
  };

  const [chapterId, setChapterId] = useState(props.novelChapters[0]?.id ?? "");
  const [activeStage, setActiveStage] =
    useState<ScriptStageKey>("storySkeleton");
  const [editor, setEditor] = useState<{
    target: "output" | "context";
    value: string;
  } | null>(null);
  const [userDraft, setUserDraft] = useState<string | undefined>(undefined);
  useEffect(() => {
    setEditor(null);
    setUserDraft(undefined);
  }, [chapterId, activeStage]);

  const chapter =
    props.novelChapters.find((item) => item.id === chapterId) ??
    props.novelChapters[0];
  const stageData = (key: AgentWorkKey) =>
    chapter
      ? [...props.agentWorkData]
          .reverse()
          .find((item) => item.key === key && item.episodeId === chapter.id)
      : undefined;

  const reviewKey = SCRIPT_STAGE_REVIEW_KEY[activeStage as ReviewableStage];
  const reviewData = reviewKey ? stageData(reviewKey)?.data : undefined;
  const reviseMode = hasReviewIssues(reviewData);

  const setHeaderActions = props.setHeaderActions;
  useEffect(() => {
    if (!props.novelChapters.length) {
      setHeaderActions(null);
      return;
    }
    setHeaderActions(
      <div className="flex flex-wrap items-center gap-3">
        <Label className="text-sm">章节（1 章 = 1 集）</Label>
        <select
          className="h-9 min-w-[280px] rounded-md border border-input bg-background px-3 text-sm"
          value={chapterId || props.novelChapters[0]?.id || ""}
          onChange={(event) => setChapterId(event.target.value)}
        >
          {props.novelChapters.map((item) => (
            <option key={item.id} value={item.id}>
              {item.index}. {item.title}
            </option>
          ))}
        </select>
      </div>,
    );
    return () => setHeaderActions(null);
  }, [setHeaderActions, props.novelChapters, chapterId]);

  const streamingText =
    props.scriptStreaming &&
    props.scriptStreaming.key === activeStage &&
    props.scriptStreaming.scopeId === (chapter?.id ?? "")
      ? props.scriptStreaming.text
      : null;
  const isStreaming = streamingText !== null;
  const reviewStreaming =
    props.scriptStreaming &&
    reviewKey &&
    props.scriptStreaming.key === reviewKey &&
    props.scriptStreaming.scopeId === (chapter?.id ?? "")
      ? props.scriptStreaming.text
      : null;
  const streamRef = useRef("");
  streamRef.current = streamingText ?? "";
  const [liveMd, setLiveMd] = useState("");
  useEffect(() => {
    if (!isStreaming) {
      setLiveMd("");
      return;
    }
    setLiveMd(extractPartialContent(streamRef.current));
    const id = setInterval(
      () => setLiveMd(extractPartialContent(streamRef.current)),
      300,
    );
    return () => clearInterval(id);
  }, [isStreaming]);
  const livePreview = useMemo(
    () => <MdPreview modelValue={liveMd} theme="dark" language="zh-CN" />,
    [liveMd],
  );

  if (!props.novelChapters.length) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        请先在「小说导入」导入章节（建议先做事件分析），再来这里逐章生成剧本。
      </div>
    );
  }

  const prereq = PREREQ[activeStage];
  const hasPrereq = !prereq || Boolean(stageData(prereq));
  const data = stageData(activeStage);
  const output = data?.data ?? "";
  const messages = chapter
    ? buildStageMessages(activeStage, {
        manualContext: props.manualContext,
        directorContext: props.directorContext,
        chapterTitle: chapter.title,
        chapterText: chapter.sourceText,
        eventState: chapter.eventState,
        skeleton: stageData("storySkeleton")?.data,
        strategy: stageData("adaptationStrategy")?.data,
        scriptDraft: stageData("scriptDraft")?.data,
        reviewFeedback: reviseMode ? reviewData : undefined,
        previousOutput: output,
      })
    : { system: "", user: "" };
  const skill = getStageSkillContent(activeStage);
  const sentSummary = [
    "项目信息",
    activeStage === "adaptationStrategy" || activeStage === "scriptDraft"
      ? "导演手法"
      : "",
    chapter ? `章节：${chapter.title}` : "",
    chapter?.eventState ? "事件分析" : "",
    activeStage !== "storySkeleton" && stageData("storySkeleton")
      ? "故事骨架"
      : "",
    activeStage === "scriptDraft" && stageData("adaptationStrategy")
      ? "改编策略"
      : "",
    reviseMode ? "审核意见(修订模式)" : "",
    "本章正文",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-border">
        {SCRIPT_STAGES.map((stage, idx) => (
          <button
            key={stage}
            type="button"
            onClick={() => setActiveStage(stage)}
            className={`px-4 py-2 text-sm ${activeStage === stage ? "border-b-2 border-primary font-medium text-primary" : "text-muted-foreground"}`}
          >
            {idx + 1}. {SCRIPT_STAGE_LABEL[stage]}
            {stageData(stage) ? " ✓" : ""}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <details className="rounded-md border border-border p-2 text-xs" open>
            <summary className="cursor-pointer font-medium">
              事件（本章）
            </summary>
            <pre className="mt-2 h-40 min-h-[80px] resize-y overflow-auto whitespace-pre-wrap leading-5">
              {[
                `章节：${chapter?.title ?? ""}`,
                chapter?.eventSummary
                  ? `事件摘要：${chapter.eventSummary}`
                  : "",
                chapter?.eventState ? `事件状态：\n${chapter.eventState}` : "",
              ]
                .filter(Boolean)
                .join("\n\n")}
            </pre>
          </details>
          <details className="rounded-md border border-border p-2 text-xs">
            <summary className="cursor-pointer font-medium">Skill 手册</summary>
            <pre className="mt-2 h-40 min-h-[80px] resize-y overflow-auto whitespace-pre-wrap leading-5">
              {skill || "（未找到该阶段 skill 手册）"}
            </pre>
          </details>
          <details className="rounded-md border border-border p-2 text-xs">
            <summary className="cursor-pointer font-medium">
              发送内容（上下文）
            </summary>
            <div className="mt-2 flex items-start justify-between gap-2">
              <p className="text-muted-foreground">含：{sentSummary}</p>
              <Button
                size="sm"
                variant="secondary"
                className="shrink-0"
                onClick={() =>
                  setEditor({
                    target: "context",
                    value: userDraft ?? messages.user,
                  })
                }
              >
                <Edit3 className="h-4 w-4" />
                可编辑
              </Button>
            </div>
            <pre className="mt-2 h-40 min-h-[80px] resize-y overflow-auto whitespace-pre-wrap leading-5">
              {userDraft ?? messages.user}
            </pre>
          </details>
          <Button
            className="w-full"
            disabled={!chapter || !hasPrereq || props.scriptStreaming !== null}
            onClick={() =>
              chapter && props.runStage(activeStage, chapter, userDraft)
            }
          >
            <WandSparkles className="h-4 w-4" />
            {streamingText !== null
              ? "生成中…"
              : reviseMode
                ? "根据审核报告一键修复"
                : `一键生成${SCRIPT_STAGE_LABEL[activeStage]}`}
          </Button>
          <Button
            variant="secondary"
            className="w-full"
            disabled={!chapter || !output || props.scriptStreaming !== null}
            onClick={() =>
              chapter &&
              props.runReview(activeStage as ReviewableStage, chapter)
            }
          >
            <ClipboardList className="h-4 w-4" />
            {reviewStreaming !== null
              ? "审核中…"
              : `审核${SCRIPT_STAGE_LABEL[activeStage]}`}
          </Button>
          {!hasPrereq && prereq ? (
            <p className="text-xs text-muted-foreground">
              请先完成「{SCRIPT_STAGE_LABEL[prereq]}」
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm">输出结果</Label>
            <div className="flex items-center gap-2">
              {data ? (
                <Badge variant="outline">已生成</Badge>
              ) : (
                <Badge variant="secondary">未生成</Badge>
              )}
              <Button
                size="sm"
                variant="secondary"
                disabled={!output}
                onClick={() => setEditor({ target: "output", value: output })}
              >
                <Edit3 className="h-4 w-4" />
                可编辑
              </Button>
            </div>
          </div>
          <div className="min-h-[460px] rounded-md border border-border p-3 text-sm">
            {streamingText !== null ? (
              liveMd ? (
                livePreview
              ) : (
                <p className="text-muted-foreground">生成中…</p>
              )
            ) : output ? (
              <MdPreview modelValue={output} theme="dark" language="zh-CN" />
            ) : (
              <p className="text-muted-foreground">
                {hasPrereq
                  ? "点上方「一键生成」由 AI 产出"
                  : "请先完成前置阶段"}
              </p>
            )}
          </div>
          {(reviewStreaming !== null || reviewData) && (
            <div className="space-y-1">
              <Label className="text-sm">
                审核报告（{SCRIPT_STAGE_LABEL[activeStage]}）
                {reviseMode ? " · 有待修复问题" : ""}
              </Label>
              <div className="rounded-md border border-border p-3 text-sm">
                {reviewStreaming !== null ? (
                  <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap text-xs leading-5">
                    {extractPartialContent(reviewStreaming) || "审核中…"}
                  </pre>
                ) : (
                  <MdPreview
                    modelValue={reviewData ?? ""}
                    theme="dark"
                    language="zh-CN"
                  />
                )}
              </div>
            </div>
          )}
          <Dialog
            open={!!editor}
            onOpenChange={(open) => !open && setEditor(null)}
          >
            <DialogContent className="flex h-[88vh] max-w-[92vw] flex-col gap-3 sm:max-w-[92vw]">
              <DialogHeader>
                <DialogTitle>
                  编辑 ·{" "}
                  {editor?.target === "context"
                    ? "发送内容"
                    : SCRIPT_STAGE_LABEL[activeStage]}
                </DialogTitle>
              </DialogHeader>
              <div className="min-h-0 flex-1">
                <MdEditor
                  modelValue={editor?.value ?? ""}
                  onChange={(value) =>
                    setEditor((prev) => (prev ? { ...prev, value } : prev))
                  }
                  theme="dark"
                  language="zh-CN"
                  toolbarsExclude={["github"]}
                  style={{ height: "100%" }}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditor(null)}>
                  取消
                </Button>
                <Button
                  onClick={() => {
                    if (!editor) return;
                    if (editor.target === "output") {
                      if (chapter)
                        props.saveAgentWorkData(
                          activeStage,
                          editor.value,
                          chapter.id,
                        );
                    } else {
                      setUserDraft(editor.value);
                    }
                    setEditor(null);
                  }}
                >
                  保存
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
}

export function AssetsTab(props: {
  mode?: "extract" | "manage";
  novelChapters: ReturnType<typeof useStudioStore.getState>["novelChapters"];
  agentWorkData: ReturnType<typeof useStudioStore.getState>["agentWorkData"];
  entityExtractions: ReturnType<
    typeof useStudioStore.getState
  >["entityExtractions"];
  extractAssets: (episodeId: string) => Promise<void> | void;
  updateExtraction: (
    batch: ReturnType<
      typeof useStudioStore.getState
    >["entityExtractions"][number],
  ) => void;
  setHeaderActions: (actions: ReactNode) => void;
}) {
  type Batch = ReturnType<
    typeof useStudioStore.getState
  >["entityExtractions"][number];
  type AssetType = "character" | "scene" | "prop";
  const mode = props.mode ?? "extract";
  const [extractingId, setExtractingId] = useState<string | null>(null);
  const [adding, setAdding] = useState<{
    episodeId: string;
    type: AssetType;
  } | null>(null);
  const [addValue, setAddValue] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // 对接资产中心（assets.db）+ 本地轻量库：按名字 + 别名 + 模糊匹配 + 描述相似匹配
  const libChars = useCharacterLibraryStore((s) => s.characters);
  const libScenes = useSceneStore((s) => s.scenes);
  const libProps = usePropsLibraryStore((s) => s.items);

  // 资产中心缓存（异步加载，一次全取）
  const [assetCenterNames, setAssetCenterNames] = useState<
    Record<string, { name: string; desc: string }[]>
  >({ role: [], scene: [], tool: [] });
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !(window as unknown as Record<string, unknown>).studioAssets
    )
      return;
    const sa = (window as unknown as Record<string, unknown>).studioAssets as {
      list: (
        p: Record<string, unknown>,
      ) => Promise<{ items: Record<string, unknown>[] }>;
    };
    for (const t of ["role", "scene", "tool"]) {
      sa.list({ type: t, limit: 99999 })
        .then((res) => {
          setAssetCenterNames((prev) => ({
            ...prev,
            [t]: (res.items || []).map((it) => ({
              name: String(it.name ?? ""),
              desc: String(it.description ?? ""),
            })),
          }));
        })
        .catch(() => {});
    }
  }, []);

  /** 规范化名字：去空白、标点，统一比较 */
  const normalize = (s: string) =>
    s.replace(/[\s\u3000·•\-—\-\(\)（）\[\]【】]/g, "").toLowerCase();

  /** 检查提取名是否匹配资产库名（精确 or 规范化 or 包含） */
  const nameMatches = (
    extractedName: string,
    libName: string,
    aliases: string[] = [],
  ): boolean => {
    const en = normalize(extractedName);
    const ln = normalize(libName);
    if (en === ln) return true;
    if (en.includes(ln) || ln.includes(en)) return true;
    for (const alias of aliases) {
      const an = normalize(alias);
      if (an === ln || an.includes(ln) || ln.includes(an)) return true;
    }
    return false;
  };

  /** 描述关键词相似匹配：提取 note 中的关键词在资产库描述中出现 >= threshold 个则认为匹配 */
  const descMatches = (
    note: string | undefined,
    libDesc: string,
    threshold = 2,
  ): boolean => {
    if (!note || !libDesc) return false;
    const keywords = note
      .split(/[,，、\s;；。！？!?·]+/)
      .filter((w) => w.length >= 2);
    if (keywords.length === 0) return false;
    const normLib = normalize(libDesc);
    let hits = 0;
    for (const kw of keywords) {
      if (normLib.includes(normalize(kw))) hits++;
      if (hits >= threshold) return true;
    }
    return false;
  };

  /** 判断是否为不记名NPC（泛称角色，如"孩童甲""丫头""老苦力"） */
  const isGenericNPC = (name: string): boolean => {
    // 以甲/乙/丙/丁/若干/若干人/群众结尾
    if (/[甲乙丙丁戊己]$/.test(name)) return true;
    // 常见泛称关键词
    const genericKws = [
      "孩童",
      "丫头",
      "丫鬟",
      "苦力",
      "杂役",
      "小厮",
      "路人",
      "村民",
      "仆人",
      "仆从",
      "侍女",
      "侍者",
      "守卫",
      "卫兵",
      "弟子",
      "门人",
      "长老",
      "执事",
      "掌柜",
    ];
    return genericKws.some((kw) => name.includes(kw));
  };

  /** 资产匹配状态：不存在(爆红) / 已有但无图(黄) / 已制作(绿)
   *  匹配策略：先查本地轻量库，再查资产中心（assets.db），按名字+别名+描述+泛称NPC兜底 */
  const getAssetStatus = (
    type: AssetType,
    name: string,
    note?: string,
  ): "missing" | "exists" | "made" => {
    // 规范化匹配辅助
    const findMatch = (
      localItems: { name: string; aliases?: string[]; desc?: string }[],
      centerItems: { name: string; desc: string }[],
      fallbackGeneric?: boolean,
    ): boolean => {
      // 先查本地库
      if (localItems.some((it) => nameMatches(name, it.name, it.aliases ?? [])))
        return true;
      // 再查资产中心
      if (centerItems.some((it) => nameMatches(name, it.name))) return true;
      // 名字都不匹配，尝试描述匹配
      if (note) {
        const allDescs = [
          ...localItems.map((it) => it.desc ?? "").filter(Boolean),
          ...centerItems.map((it) => it.desc).filter(Boolean),
        ];
        if (allDescs.some((d) => descMatches(note, d))) return true;
      }
      // 兜底：不记名NPC 匹配 "全体NPC" / "NPC" 等通用资产
      if (fallbackGeneric && isGenericNPC(name)) {
        const genericNames = ["全体NPC", "NPC", "通用NPC", "群众", "路人"];
        if (
          centerItems.some((it) =>
            genericNames.some((gn) =>
              normalize(it.name).includes(normalize(gn)),
            ),
          )
        )
          return true;
      }
      return false;
    };

    if (type === "character") {
      const localItems = libChars.map((c) => ({
        name: c.name,
        aliases:
          ((c as unknown as Record<string, unknown>).aliases as string[]) ?? [],
        desc: [c.description, c.role, c.personality, c.traits]
          .filter(Boolean)
          .join(" "),
      }));
      const found = findMatch(localItems, assetCenterNames.role, true);
      if (!found) return "missing";
      const hasImg = libChars.some(
        (c) =>
          nameMatches(name, c.name) &&
          (!!c.thumbnailUrl || (c.views?.length ?? 0) > 0),
      );
      return hasImg ? "made" : "exists";
    }
    if (type === "scene") {
      const localItems = libScenes.map((s) => ({
        name: s.name,
        desc: [
          (s as unknown as Record<string, unknown>).atmosphere as string,
          (s as unknown as Record<string, unknown>).location as string,
          s.name,
        ]
          .filter(Boolean)
          .join(" "),
      }));
      const found = findMatch(localItems, assetCenterNames.scene);
      if (!found) return "missing";
      const hasImg = libScenes.some(
        (s) =>
          nameMatches(name, s.name) &&
          (!!s.referenceImage || !!s.referenceImageBase64),
      );
      return hasImg ? "made" : "exists";
    }
    // prop
    const localItems = libProps.map((p) => ({
      name: p.name,
      desc:
        ((p as unknown as Record<string, unknown>).description as string) ?? "",
    }));
    const found = findMatch(localItems, assetCenterNames.tool);
    if (!found) return "missing";
    const hasImg = libProps.some(
      (p) =>
        nameMatches(name, p.name) &&
        !!(p as unknown as Record<string, unknown>).imageUrl,
    );
    return hasImg ? "made" : "exists";
  };

  const scriptChapters = useMemo(
    () =>
      props.novelChapters.filter((ch) =>
        props.agentWorkData.some(
          (w) => w.key === "scriptDraft" && w.episodeId === ch.id,
        ),
      ),
    [props.novelChapters, props.agentWorkData],
  );

  const run = async (id: string) => {
    setExtractingId(id);
    try {
      await props.extractAssets(id);
    } finally {
      setExtractingId(null);
    }
  };

  const setHeaderActions = props.setHeaderActions;
  const extractAssets = props.extractAssets;
  useEffect(() => {
    setHeaderActions(
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground">
          {mode === "manage"
            ? "管理本章剧本资产（角色 / 场景 / 道具）与资产库制作状态；"
            : "从剧本提取资产（角色 / 场景 / 道具），与资产库匹配；"}
          <span className="text-destructive">红色=未制作</span>
          {mode === "manage" ? "。" : "，需到「剧本资产管理」生成。"}
        </span>
        <Button
          size="sm"
          disabled={extractingId !== null || scriptChapters.length === 0}
          onClick={async () => {
            for (const ch of scriptChapters) {
              setExtractingId(ch.id);
              try {
                await extractAssets(ch.id);
              } finally {
                setExtractingId(null);
              }
            }
          }}
        >
          <Boxes className="h-4 w-4" />
          {extractingId !== null ? "提取中…" : "批量提取全部"}
        </Button>
      </div>,
    );
    return () => setHeaderActions(null);
  }, [setHeaderActions, extractAssets, scriptChapters, extractingId, mode]);

  const genId = (p: string) =>
    `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const removeAsset = (batch: Batch, type: AssetType, id: string) => {
    const next: Batch =
      type === "character"
        ? {
            ...batch,
            characters: batch.characters.filter((c) => c.characterId !== id),
          }
        : type === "scene"
          ? { ...batch, scenes: batch.scenes.filter((s) => s.sceneId !== id) }
          : { ...batch, props: batch.props.filter((p) => p.assetId !== id) };
    props.updateExtraction(next);
  };
  const submitAdd = (batch: Batch) => {
    const name = addValue.trim();
    if (!adding || !name) {
      setAdding(null);
      setAddValue("");
      return;
    }
    const next: Batch =
      adding.type === "character"
        ? {
            ...batch,
            characters: [
              ...batch.characters,
              { characterId: genId("char"), name, aliases: [] },
            ],
          }
        : adding.type === "scene"
          ? {
              ...batch,
              scenes: [...batch.scenes, { sceneId: genId("scene"), name }],
            }
          : {
              ...batch,
              props: [...batch.props, { assetId: genId("asset"), name }],
            };
    props.updateExtraction(next);
    setAdding(null);
    setAddValue("");
  };

  if (!scriptChapters.length) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        还没有剧本：请先在「策划编剧」生成各章剧本，再来管理资产（角色/场景/道具）。
      </div>
    );
  }

  const renderCat = (
    batch: Batch,
    type: AssetType,
    label: string,
    items: { id: string; name: string; note?: string }[],
  ) => (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 font-medium">{label}：</span>
      {items.map(({ id, name, note }) => {
        const status = getAssetStatus(type, name, note);
        const badgeClass = cn(
          "font-normal",
          status === "missing" && "border-destructive text-destructive",
          status === "exists" &&
            "border-yellow-500 text-yellow-600 dark:text-yellow-400",
        );
        const title =
          status === "made"
            ? "已制作"
            : status === "exists"
              ? "资产库已有，尚未生成图片"
              : "资产库中不存在，请先创建";
        return (
          <span key={id} className="group relative inline-flex">
            <Badge
              variant={status === "made" ? "secondary" : "outline"}
              className={badgeClass}
              title={title}
            >
              {name}
            </Badge>
            <button
              type="button"
              title="删除"
              onClick={() => removeAsset(batch, type, id)}
              className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold leading-none text-destructive-foreground shadow group-hover:flex"
            >
              ×
            </button>
          </span>
        );
      })}
      {adding?.episodeId === batch.episodeId && adding.type === type ? (
        <span className="inline-flex items-center gap-1">
          <Input
            autoFocus
            value={addValue}
            onChange={(e) => setAddValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitAdd(batch);
              if (e.key === "Escape") {
                setAdding(null);
                setAddValue("");
              }
            }}
            className="h-6 w-28 text-xs"
            placeholder={`新${label}`}
          />
          <Button
            size="sm"
            variant="secondary"
            className="h-6 px-2"
            onClick={() => submitAdd(batch)}
          >
            确定
          </Button>
        </span>
      ) : (
        <button
          type="button"
          className="text-xs text-primary hover:underline"
          onClick={() => {
            setAdding({ episodeId: batch.episodeId, type });
            setAddValue("");
          }}
        >
          + 添加
        </button>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {mode === "manage" ? (
        <div className="rounded-lg border border-border/70 bg-panel/80 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">剧本资产管理</h3>
                <Badge variant="secondary">
                  资产批次 {props.entityExtractions.length}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                管理从剧本抽取出的角色、场景、道具，并检查资产库制作状态。
              </p>
            </div>
          </div>
        </div>
      ) : null}
      {scriptChapters.map((ch) => {
        const batch = props.entityExtractions.find(
          (b) => b.episodeId === ch.id,
        );
        const script = [...props.agentWorkData]
          .reverse()
          .find((w) => w.key === "scriptDraft" && w.episodeId === ch.id)?.data;
        const open = !collapsed.has(ch.id);
        return (
          <Card key={ch.id} className="rounded-lg">
            <CardHeader className="flex-row items-center justify-between space-y-0 py-3">
              <button
                type="button"
                className="flex min-w-0 items-center gap-2 text-left"
                onClick={() => toggle(ch.id)}
              >
                <ChevronDown
                  className={cn(
                    "h-4 w-4 shrink-0 transition-transform",
                    !open && "-rotate-90",
                  )}
                />
                <CardTitle className="truncate text-sm">
                  {ch.index}. {ch.title}
                </CardTitle>
                {batch ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    （角色 {batch.characters.length} / 场景{" "}
                    {batch.scenes.length} / 道具 {batch.props.length}）
                  </span>
                ) : !script ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    （暂无剧本）
                  </span>
                ) : null}
              </button>
              <Button
                size="sm"
                disabled={!script || extractingId !== null}
                onClick={() => run(ch.id)}
              >
                <Boxes className="h-4 w-4" />
                {extractingId === ch.id
                  ? "提取中…"
                  : batch
                    ? "重新提取资产"
                    : "提取资产"}
              </Button>
            </CardHeader>
            {open && (
              <CardContent className="space-y-3 text-xs">
                <details className="rounded-md border border-border p-2">
                  <summary className="cursor-pointer font-medium">
                    剧本内容
                  </summary>
                  <pre className="mt-2 max-h-[320px] overflow-auto whitespace-pre-wrap leading-5">
                    {script || "本章暂无剧本：请先在「策划编剧」生成本章剧本。"}
                  </pre>
                </details>
                {!batch ? (
                  <p className="text-muted-foreground">
                    {script
                      ? "尚未提取。点「提取资产」从本章剧本抽取角色/场景/道具。"
                      : "本章暂无剧本，无法提取资产。"}
                  </p>
                ) : (
                  <>
                    {renderCat(
                      batch,
                      "character",
                      "角色",
                      batch.characters.map((c) => ({
                        id: c.characterId,
                        name: c.name,
                        note: c.note,
                      })),
                    )}
                    {renderCat(
                      batch,
                      "scene",
                      "场景",
                      batch.scenes.map((s) => ({
                        id: s.sceneId,
                        name: s.name,
                        note: s.note,
                      })),
                    )}
                    {renderCat(
                      batch,
                      "prop",
                      "道具",
                      batch.props.map((p) => ({
                        id: p.assetId,
                        name: p.name,
                        note: p.note,
                      })),
                    )}
                  </>
                )}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}

export function StoryboardTab(props: {
  storyboards: ReturnType<typeof useStudioStore.getState>["storyboards"];
  materials: ReturnType<typeof useStudioStore.getState>["materials"];
  importMaterials: (files?: FileList | null) => void;
  deleteMaterial: ReturnType<typeof useStudioStore.getState>["deleteMaterial"];
  bindMaterialToStoryboard: ReturnType<
    typeof useStudioStore.getState
  >["bindMaterialToStoryboard"];
  addStoryboard: ReturnType<typeof useStudioStore.getState>["addStoryboard"];
  updateStoryboard: ReturnType<
    typeof useStudioStore.getState
  >["updateStoryboard"];
  createStoryboardsFromChapters: ReturnType<
    typeof useStudioStore.getState
  >["createStoryboardsFromChapters"];
  generateStoryboardTable: (episodeId?: string) => void;
}) {
  return (
    <div className="grid grid-cols-[340px_1fr] gap-4">
      <MaterialLibrary
        materials={props.materials}
        importMaterials={props.importMaterials}
        deleteMaterial={props.deleteMaterial}
      />

      <Card className="rounded-lg border-border/80 bg-card/95">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-sm">分镜表与分镜视频生成</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              按 Toonflow 的 storyboard 面板组织镜头、资产引用、画面提示、台词和音频。
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => props.generateStoryboardTable()}
            >
              <WandSparkles className="h-4 w-4" />
              运行 AI 分镜计划
            </Button>
            <Button variant="secondary" type="button">
              <Volume2 className="h-4 w-4" />
              生成配音
            </Button>
            <Button variant="secondary" type="button">
              <Play className="h-4 w-4" />
              试听配音
            </Button>
            <Button
              variant="secondary"
              onClick={props.createStoryboardsFromChapters}
            >
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
            <div
              key={item.id}
              className="grid grid-cols-[160px_1fr_260px] gap-3 rounded-lg border border-border/80 bg-background/65 p-3"
            >
              <div className="overflow-hidden rounded-md border border-border bg-muted/45">
                {item.mediaRef?.kind === "image" ? (
                  <LocalImage
                    src={item.mediaRef.path}
                    alt={`分镜 ${item.index}`}
                    className="aspect-video w-full object-cover"
                  />
                ) : item.mediaRef?.kind === "video" ? (
                  <video
                    src={item.mediaRef.path}
                    className="aspect-video w-full bg-black object-cover"
                    controls
                  />
                ) : (
                  <div className="flex aspect-video items-center justify-center text-xs text-muted-foreground">
                    storyboard / image
                  </div>
                )}
                <div className="flex items-center justify-between gap-2 border-t border-border/70 px-2 py-1.5 text-[11px] text-muted-foreground">
                  <span>#{item.index}</span>
                  <span>{item.duration}s</span>
                  <Badge variant="outline">{item.state}</Badge>
                </div>
              </div>

              <div className="space-y-2">
                <div className="grid grid-cols-[72px_1fr_82px] gap-2">
                  <Input
                    type="number"
                    value={item.index}
                    onChange={(event) =>
                      props.updateStoryboard(item.id, {
                        index: Number(event.target.value),
                      })
                    }
                  />
                  <Input
                    value={item.trackKey}
                    onChange={(event) =>
                      props.updateStoryboard(item.id, {
                        trackKey: event.target.value,
                      })
                    }
                    placeholder="track"
                  />
                  <Input
                    type="number"
                    value={item.duration}
                    onChange={(event) =>
                      props.updateStoryboard(item.id, {
                        duration: Number(event.target.value),
                      })
                    }
                  />
                </div>
                <Textarea
                  value={item.prompt}
                  onChange={(event) =>
                    props.updateStoryboard(item.id, {
                      prompt: event.target.value,
                    })
                  }
                  placeholder="画面提示"
                  className="min-h-[74px]"
                />
                <Textarea
                  value={item.videoDesc}
                  onChange={(event) =>
                    props.updateStoryboard(item.id, {
                      videoDesc: event.target.value,
                    })
                  }
                  placeholder="视频描述/台词"
                  className="min-h-[74px]"
                />
                <div className="flex flex-wrap gap-1.5">
                  {item.assetIds.map((assetId) => (
                    <Badge key={assetId} variant="secondary">
                      asset · {assetId}
                    </Badge>
                  ))}
                  {item.audioRef?.path && (
                    <Badge variant="outline">audio · 已绑定</Badge>
                  )}
                </div>
              </div>

              <MediaRefEditor
                itemId={item.id}
                mediaRef={item.mediaRef}
                materials={props.materials}
                bindMaterialToStoryboard={props.bindMaterialToStoryboard}
                updateStoryboard={props.updateStoryboard}
              />
            </div>
          ))}
          {!props.storyboards.length && (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              暂无分镜。先生成分镜表，再写入分镜视频生成面板。
            </div>
          )}
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
  const materialCounts = props.materials.reduce(
    (counts, material) => ({
      ...counts,
      [material.kind]: counts[material.kind] + 1,
    }),
    { image: 0, video: 0, audio: 0 },
  );
  return (
    <Card className="rounded-lg border-border/80 bg-card/95">
      <CardHeader>
        <CardTitle className="text-sm">素材管理</CardTitle>
        <p className="text-xs text-muted-foreground">
          作为分镜的 image / video / audio 引用源。
        </p>
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
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-md border border-border bg-background/60 p-2 text-center">
            <div className="text-sm font-semibold">{materialCounts.image}</div>
            <div className="text-[10px] text-muted-foreground">image</div>
          </div>
          <div className="rounded-md border border-border bg-background/60 p-2 text-center">
            <div className="text-sm font-semibold">{materialCounts.video}</div>
            <div className="text-[10px] text-muted-foreground">video</div>
          </div>
          <div className="rounded-md border border-border bg-background/60 p-2 text-center">
            <div className="text-sm font-semibold">{materialCounts.audio}</div>
            <div className="text-[10px] text-muted-foreground">audio</div>
          </div>
        </div>
        <div className="space-y-2">
          {props.materials.map((material) => (
            <div
              key={material.id}
              className="rounded-md border border-border bg-background/65 p-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium">
                    {material.name}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                    <Badge variant="outline">{material.kind}</Badge>
                    <span>{Math.round(material.size / 1024)} KB</span>
                  </div>
                </div>
                <Button
                  size="icon"
                  variant="destructive"
                  onClick={() => props.deleteMaterial(material.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              {material.kind !== "audio" && (
                <div className="mt-2 overflow-hidden rounded bg-muted">
                  {material.kind === "image" ? (
                    <img
                      src={material.localPath}
                      alt={material.name}
                      className="aspect-video w-full object-cover"
                    />
                  ) : (
                    <video
                      src={material.localPath}
                      className="aspect-video w-full bg-black"
                      controls
                    />
                  )}
                </div>
              )}
            </div>
          ))}
          {!props.materials.length && (
            <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
              还没有导入素材。
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function MediaRefEditor(props: {
  itemId: string;
  mediaRef?: StoryboardMediaRef;
  materials: StudioMaterial[];
  bindMaterialToStoryboard: ReturnType<
    typeof useStudioStore.getState
  >["bindMaterialToStoryboard"];
  updateStoryboard: ReturnType<
    typeof useStudioStore.getState
  >["updateStoryboard"];
}) {
  const [kind, setKind] = useState<StoryboardMediaRef["kind"]>(
    props.mediaRef?.kind ?? "image",
  );
  const selectedMaterialId =
    props.materials.find(
      (material) => material.localPath === props.mediaRef?.path,
    )?.id ?? "";
  return (
    <div className="grid grid-cols-[88px_1fr] gap-2">
      <select
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        value={kind}
        onChange={(event) =>
          setKind(event.target.value as StoryboardMediaRef["kind"])
        }
      >
        <option value="image">图片</option>
        <option value="video">视频</option>
        <option value="audio">音频</option>
      </select>
      <select
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        value={selectedMaterialId}
        onChange={(event) => {
          if (event.target.value)
            props.bindMaterialToStoryboard(props.itemId, event.target.value);
        }}
      >
        <option value="">从素材库绑定</option>
        {props.materials.map((material) => (
          <option key={material.id} value={material.id}>
            {material.kind} / {material.name}
          </option>
        ))}
      </select>
      <Input
        className="col-span-2"
        value={props.mediaRef?.path ?? ""}
        onChange={(event) =>
          props.updateStoryboard(props.itemId, {
            mediaRef: { kind, path: event.target.value },
          })
        }
        placeholder="/absolute/path 或 local-image://..."
      />
    </div>
  );
}

export function WorkbenchTab(props: {
  storyboards: ReturnType<typeof useStudioStore.getState>["storyboards"];
  tracks: ReturnType<typeof useStudioStore.getState>["productionTracks"];
  candidates: ReturnType<typeof useStudioStore.getState>["videoCandidates"];
  renderingTrackId: string | null;
  merging: boolean;
  mergeOutput: string | null;
  rebuildTracks: () => void;
  renderTrack: (trackId: string) => void;
  selectVideoCandidate: ReturnType<
    typeof useStudioStore.getState
  >["selectVideoCandidate"];
  deleteVideoCandidate: ReturnType<
    typeof useStudioStore.getState
  >["deleteVideoCandidate"];
  mergeEpisode: () => void;
}) {
  const characters = useCharacterLibraryStore((state) => state.characters);
  const scenes = useSceneStore((state) => state.scenes);
  const propsItems = usePropsLibraryStore((state) => state.items);
  const assetMediaById = useMemo(
    () => buildWorkbenchAssetMediaMap(characters, scenes, propsItems),
    [characters, scenes, propsItems],
  );
  const workbench = buildToonflowWorkbenchModel({
    tracks: props.tracks,
    storyboards: props.storyboards,
    candidates: props.candidates,
    assetMediaById,
  });
  return (
    <div className="space-y-3">
      <div className="grid gap-3 rounded-lg border border-border bg-card p-3 lg:grid-cols-[1fr_auto]">
        <div className="grid gap-2 md:grid-cols-4">
          <div className="rounded-md border border-border bg-background px-3 py-2">
            <div className="text-[11px] text-muted-foreground">model</div>
            <div className="text-sm font-medium">ffmpeg-local</div>
          </div>
          <div className="rounded-md border border-border bg-background px-3 py-2">
            <div className="text-[11px] text-muted-foreground">mode</div>
            <div className="text-sm font-medium">track-candidate</div>
          </div>
          <div className="rounded-md border border-border bg-background px-3 py-2">
            <div className="text-[11px] text-muted-foreground">resolution</div>
            <div className="text-sm font-medium">16:9</div>
          </div>
          <label className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm">
            <Checkbox checked disabled />
            audio
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="secondary" onClick={props.rebuildTracks}>
            <RefreshCw className="h-4 w-4" />
            添加 track
          </Button>
          <Button type="button" variant="outline" disabled>
            <WandSparkles className="h-4 w-4" />
            生成提示词
          </Button>
          <Button
            onClick={props.mergeEpisode}
            disabled={props.merging || !workbench.canMergeEpisode}
          >
            <Film className="h-4 w-4" />
            导出成片
          </Button>
        </div>
      </div>
      {props.mergeOutput && (
        <div className="rounded-md border border-border bg-muted p-3 text-xs">
          导出文件: {props.mergeOutput}
        </div>
      )}
      <div className="space-y-3">
        {workbench.trackList.map((track) => (
          <Card key={track.id} className="overflow-hidden rounded-lg">
            <CardHeader className="grid gap-3 border-b border-border bg-muted/35 py-3 lg:grid-cols-[180px_1fr_auto]">
              <div>
                <CardTitle className="text-sm">{track.name}</CardTitle>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>{track.duration}s</span>
                  <span>{track.state}</span>
                  <span>{track.medias.length} medias</span>
                </div>
              </div>
              <div className="min-w-0">
                <Textarea
                  readOnly
                  value={track.prompt || ""}
                  placeholder="prompt"
                  className="min-h-[70px] resize-none bg-background text-xs"
                />
                {track.reason ? (
                  <div className="mt-1 text-xs text-destructive">
                    {track.reason}
                  </div>
                ) : null}
              </div>
              <div className="flex items-start justify-end gap-2">
                <Button type="button" variant="outline" size="sm" disabled>
                  检查提示词
                </Button>
                <Button
                  size="sm"
                  onClick={() => props.renderTrack(track.id)}
                  disabled={props.renderingTrackId === track.id}
                >
                  <Play className="h-4 w-4" />
                  {props.renderingTrackId === track.id
                    ? "生成中"
                    : "生成视频"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 p-3 lg:grid-cols-[1fr_360px]">
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  {track.medias.map((media, index) => (
                    <div
                      key={`${media.sources}-${media.id}-${media.fileType}-${index}`}
                      className="overflow-hidden rounded-md border border-border bg-background"
                    >
                      <div className="aspect-video bg-black">
                        {media.fileType === "audio" ? (
                          <div className="flex h-full items-center justify-center text-xs text-zinc-300">
                            audio
                          </div>
                        ) : media.fileType === "video" ? (
                          <video
                            className="h-full w-full object-cover"
                            src={toPreviewSrc(media.src)}
                            muted
                          />
                        ) : (
                          <img
                            className="h-full w-full object-cover"
                            src={toPreviewSrc(media.src)}
                            alt={media.name ?? media.id}
                          />
                        )}
                      </div>
                      <div className="space-y-1 p-2">
                        <Badge variant="outline">
                          {media.sources}/{media.fileType}
                        </Badge>
                        <div className="truncate text-xs">
                          {media.name ?? media.id}
                        </div>
                      </div>
                    </div>
                  ))}
                  {track.medias.length === 0 ? (
                    <div className="rounded-md border border-dashed border-border bg-background p-3 text-xs text-muted-foreground">
                      no media
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="grid gap-2">
                {track.videoList.map((video) => (
                  <div
                    key={video.id}
                    className="rounded-md border border-border bg-background p-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Badge
                        variant={
                          video.state === "ready"
                            ? "default"
                            : video.state === "failed"
                              ? "destructive"
                              : "outline"
                        }
                      >
                        {video.state}
                      </Badge>
                      <div className="flex gap-1">
                          <Button
                            size="sm"
                          variant={video.selected ? "default" : "secondary"}
                            onClick={() =>
                            props.selectVideoCandidate(track.id, video.id)
                            }
                          >
                            选择
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                          onClick={() => props.deleteVideoCandidate(video.id)}
                          >
                            删除
                          </Button>
                      </div>
                    </div>
                    {video.path ? (
                      <video
                        className="mt-2 aspect-video w-full rounded bg-black"
                        src={toPreviewSrc(video.path)}
                        controls
                      />
                    ) : null}
                    {video.errorReason ? (
                      <div className="mt-2 text-xs text-destructive">
                        {video.errorReason}
                      </div>
                    ) : null}
                  </div>
                ))}
                {track.videoList.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border bg-background p-3 text-xs text-muted-foreground">
                    no video
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function toPreviewSrc(filePath: string) {
  if (
    filePath.startsWith("local-image://") ||
    filePath.startsWith("file://") ||
    filePath.startsWith("data:") ||
    filePath.startsWith("blob:") ||
    filePath.startsWith("http://") ||
    filePath.startsWith("https://")
  )
    return filePath;
  return `file://${filePath}`;
}

function buildWorkbenchAssetMediaMap(
  characters: ReturnType<typeof useCharacterLibraryStore.getState>["characters"],
  scenes: ReturnType<typeof useSceneStore.getState>["scenes"],
  propsItems: ReturnType<typeof usePropsLibraryStore.getState>["items"],
): Record<string, ToonflowWorkbenchAssetMedia> {
  const entries: Record<string, ToonflowWorkbenchAssetMedia> = {};
  for (const character of characters) {
    const path =
      character.thumbnailUrl ??
      character.views.find((view) => view.imageUrl)?.imageUrl ??
      character.referenceImages?.[0];
    if (path) {
      entries[character.id] = {
        id: character.id,
        name: character.name,
        fileType: "image",
        path,
        prompt: character.visualTraits || character.description,
      };
    }
    for (const variation of character.variations ?? []) {
      if (!variation.referenceImage) continue;
      entries[variation.id] = {
        id: variation.id,
        name: variation.name,
        fileType: "image",
        path: variation.referenceImage,
        prompt: variation.visualPromptZh || variation.visualPrompt,
      };
    }
  }
  for (const scene of scenes) {
    const path =
      scene.referenceImage ??
      scene.referenceImageBase64 ??
      getOptionalStringField(scene, "contactSheetImage");
    if (!path) continue;
    entries[scene.id] = {
      id: scene.id,
      name: scene.name,
      fileType: "image",
      path,
      prompt: scene.visualPrompt || scene.location || scene.atmosphere,
    };
  }
  for (const item of propsItems) {
    if (!item.imageUrl) continue;
    entries[item.id] = {
      id: item.id,
      name: item.name,
      fileType: "image",
      path: item.imageUrl,
      prompt: item.visualPrompt || item.description,
    };
  }
  return entries;
}

function getOptionalStringField(value: unknown, key: string) {
  if (!value || typeof value !== "object") return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.trim() ? field : undefined;
}
