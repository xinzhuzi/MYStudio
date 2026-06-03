import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  buildEntityExtractionMessages,
  dedupeEntities,
  parseEntityExtraction,
  type KnownEntity,
} from "@/lib/studio/entity-extraction";
import { syncExtractedEntities } from "@/lib/studio/entity-sync";
import { buildDirectorPlanMessages, parseDirectorPlan } from "@/lib/studio/director-plan";
import {
  buildEntityResolver,
  createMystudioDerivedSinks,
  syncDerivedAssets,
} from "@/lib/studio/derived-asset-sync";
import {
  buildStoryboardTableMessages,
  parseStoryboardTable,
  toStoryboardItems,
} from "@/lib/studio/storyboard-table";
import { buildSeriesBible } from "@/lib/studio/series-bible";
import {
  buildEpisodeOutlineMessages,
  parseEpisodeOutline,
} from "@/lib/studio/episode-outline";
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
  assignVoicesForCharacters,
  type VoiceAssignment,
  type VoiceAssignerCharacter,
} from "@/lib/studio/voice-assigner";
import { createMystudioTtsSink, syncCharacterVoices } from "@/lib/studio/voice-sync";
import {
  createBackendVoiceProfile,
  getTtsRuntimeStatus,
} from "@/lib/tts/client";
import {
  QWEN_CUSTOM_VOICES,
} from "@/lib/tts/voice-profile-capabilities";
import {
  buildStudioManualContext,
  buildStudioManualsFromSkillFiles,
  listStudioManualPresets,
  type StudioManualCatalog,
  type StudioManualSkillOverrideFile,
} from "@/lib/studio/manuals";
import { createEpisodeMergePlan, createTrackRenderPlan } from "@/lib/studio/production";
import { useAPIConfigStore } from "@/stores/api-config-store";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { useProjectStore } from "@/stores/project-store";
import { useSceneStore } from "@/stores/scene-store";
import { usePropsLibraryStore } from "@/stores/props-library-store";
import { useStudioStore } from "@/stores/studio-store";
import { useTtsStore } from "@/stores/tts-store";
import type {
  ProjectVoiceBinding,
  TtsEngine,
  TtsSpeakerId,
  VoiceProfile,
} from "@/types/tts";
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
  ChevronDown,
  Check,
  ClipboardList,
  Edit3,
  FileText,
  Film,
  Gem,
  MapPin,
  Mic,
  Palette,
  Play,
  Plus,
  RefreshCw,
  Search,
  Split,
  Trash2,
  Upload,
  Users,
  Volume2,
  WandSparkles,
} from "lucide-react";
import { toast } from "sonner";
import { MdEditor, MdPreview } from "md-editor-rt";
import "md-editor-rt/lib/style.css";
import { cn } from "@/lib/utils";
import { ManualEditDialog } from "./ManualEditDialog";

const taskOptions: Array<{ key: AgentWorkKey; label: string }> = [
  { key: "eventAnalysis", label: "事件分析" },
  { key: "storySkeleton", label: "故事骨架" },
  { key: "adaptationStrategy", label: "改编策略" },
  { key: "episodeOutline", label: "分集细纲" },
  { key: "scriptDraft", label: "剧本草稿" },
  { key: "entityExtraction", label: "实体提取" },
  { key: "directorPlan", label: "导演规划" },
  { key: "deriveAssets", label: "衍生资产" },
  { key: "storyboardTable", label: "分镜表" },
  { key: "voiceAssign", label: "音色分配" },
  { key: "productionPlan", label: "制作计划" },
];

export const WORKFLOW_TABS = [
  { value: "manuals", label: "风格与导演选择", Icon: BookMarked },
  { value: "novel", label: "小说导入", Icon: BookOpen },
  { value: "script", label: "剧本策划", Icon: FileText },
  { value: "assets", label: "剧本资产管理", Icon: Boxes },
  { value: "generation", label: "剧情产物生成", Icon: WandSparkles },
  { value: "storyboard", label: "分镜表", Icon: Split },
  { value: "workbench", label: "剪辑工作台", Icon: Film },
];

// Skill 对话暂时从工作流导航屏蔽（功能代码与 TabsContent 保留，未删除）；
// 恢复：把 { value: "skill", ... } 加回 WORKFLOW_TABS 并从下方集合移除即可。
const HIDDEN_WORKFLOW_STAGES = new Set(["skill"]);
function resolveVisibleWorkflowStage(stage?: string): string {
  return stage && !HIDDEN_WORKFLOW_STAGES.has(stage) ? stage : "manuals";
}

/** 把导演规划 ScriptPlan 关键维度压成分镜表的节奏/情绪基准文本。 */
function formatScriptPlanContext(plan: ScriptPlan): string {
  return [
    plan.theme && `①主题立意：${plan.theme}`,
    plan.visualStyle && `②视觉风格：${plan.visualStyle}`,
    plan.narrativeRhythm && `③叙事节奏：${plan.narrativeRhythm}`,
    plan.soundDirection && `⑤声音方向：${plan.soundDirection}`,
    plan.transitions && `⑥转场设计：${plan.transitions}`,
  ].filter(Boolean).join("\n");
}

export function StudioView() {
  const activeProject = useProjectStore((state) => state.activeProject);
  const {
    materials,
    novelChapters,
    agentWorkData,
    entityExtractions,
    scriptPlans,
    episodeOutlines,
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
    saveEntityExtraction,
    saveScriptPlan,
    saveSeriesBible,
    saveEpisodeOutline,
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
  const [novelDraft, setNovelDraft] = useState("");
  const [selectedTask, setSelectedTask] = useState<AgentWorkKey>("scriptDraft");
  const [agentDraft, setAgentDraft] = useState("");
  const [renderingTrackId, setRenderingTrackId] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [mergeOutput, setMergeOutput] = useState<string | null>(null);
  const [activeWorkflowTab, setActiveWorkflowTab] = useState(resolveVisibleWorkflowStage(workflowConfig.workflowStage));
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
    setActiveWorkflowTab(resolveVisibleWorkflowStage(useStudioStore.getState().workflowConfig.workflowStage));
  }, [activeProject?.id]);
  const [novelHeaderActions, setNovelHeaderActions] = useState<ReactNode>(null);
  const [scriptHeaderActions, setScriptHeaderActions] = useState<ReactNode>(null);
  const [assetsHeaderActions, setAssetsHeaderActions] = useState<ReactNode>(null);
  const bundledManualCatalog = useMemo<StudioManualCatalog>(() => ({
    visual: listStudioManualPresets("visual"),
    director: listStudioManualPresets("director"),
  }), []);
  const [storedManualCatalog, setStoredManualCatalog] = useState<StudioManualCatalog | null>(null);
  const [voiceAssignments, setVoiceAssignments] = useState<VoiceAssignment[]>([]);
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

    if (!aiManager.resolve({ agent: "eventAnalysisAgent" }) && !aiManager.resolve({ agent: "universalAi" })) {
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
  }, [saveAgentWorkData, updateNovelChapter]);

  const handleEntityExtraction = useCallback(async (episodeId = "episode-1") => {
    if (!window.electronAPI?.textCompletion) {
      toast.error("当前环境不支持模型调用");
      return;
    }

    const store = useStudioStore.getState();
    const scriptText =
      [...store.agentWorkData].reverse().find((item) => item.key === "scriptDraft" && item.episodeId === episodeId)?.data
      ?? store.novelChapters.find((chapter) => chapter.id === episodeId)?.sourceText
      ?? [...store.agentWorkData].reverse().find((item) => item.key === "scriptDraft")?.data
      ?? store.novelChapters.map((chapter) => chapter.sourceText).join("\n\n");
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
      ...libChars.filter((c) => !store.entityExtractions.some((b) => b.characters.some((bc) => bc.characterId === c.id))).map((c) => ({
        id: c.id,
        kind: "character" as const,
        name: c.name,
        aliases: (c as unknown as Record<string, unknown>).aliases as string[] ?? [],
      })),
      // 补充资产库里已有的场景
      ...libScenes.filter((s) => !store.entityExtractions.some((b) => b.scenes.some((bs) => bs.sceneId === s.id))).map((s) => ({
        id: s.id,
        kind: "scene" as const,
        name: s.name,
        aliases: [],
      })),
      // 补充资产库里已有的道具
      ...libProps.filter((p) => !store.entityExtractions.some((b) => b.props.some((bp) => bp.assetId === p.id))).map((p) => ({
        id: p.id,
        kind: "prop" as const,
        name: p.name,
        aliases: [],
      })),
    ];

    const messages = buildEntityExtractionMessages({ episodeId, scriptText, knownEntities });
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

      const parsed = parseEntityExtraction(result.text, episodeId);
      const { entities } = dedupeEntities(parsed.entities, knownEntities);
      if (!entities.length) {
        toast.error("未解析出任何实体，请检查模型输出格式");
        return;
      }

      // 不写入资产库（剧本资产仅供匹配/展示）；用空操作 sinks 仅生成 batch 结构与 ID
      const noopSinks = {
        characterSink: { addCharacter: () => `char-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, updateCharacter: () => {}, getOrCreateProjectFolder: () => "" },
        sceneSink: { addScene: () => `scene-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, updateScene: () => {}, getOrCreateProjectFolder: () => "" },
      };
      const { result: batch } = syncExtractedEntities(
        { episodeId, entities, projectId: activeProject?.id ?? "", projectName },
        noopSinks,
      );
      saveEntityExtraction(batch);

      const detail = `角色 ${batch.characters.length} / 场景 ${batch.scenes.length} / 道具 ${batch.props.length}`;
      if (parsed.errors.length) {
        toast.warning(`资产提取完成（忽略非法行 ${parsed.errors.length}）：${detail}`);
      } else {
        toast.success(`资产提取完成：${detail}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [activeProject?.id, projectName, saveEntityExtraction]);

  const handleDirectorPlan = useCallback(async (episodeId = "episode-1") => {
    if (!window.electronAPI?.textCompletion) {
      toast.error("当前环境不支持模型调用");
      return;
    }

    const store = useStudioStore.getState();
    const scriptText =
      [...store.agentWorkData].reverse().find((item) => item.key === "scriptDraft")?.data
      ?? store.novelChapters.map((chapter) => chapter.sourceText).join("\n\n");
    if (!scriptText.trim()) {
      toast.error("没有可规划的剧本：请先保存剧本草稿或导入小说正文");
      return;
    }

    const manualContext = buildStudioManualContext(store.workflowConfig, manualCatalog);
    const messages = buildDirectorPlanMessages({ episodeId, scriptText, manualContext });
    try {
      const result = await aiManager.text({
        binding: { agent: "productionAgent:directorPlanAgent" },
        messages: [
          { role: "system", content: messages.system },
          { role: "user", content: messages.user },
        ],
        temperature: 0.4,
        maxTokens: 4096,
      });
      if (!result.success || !result.text) {
        throw new Error(result.error || "导演规划失败");
      }

      const { plan, warnings } = parseDirectorPlan(result.text, episodeId);
      saveScriptPlan(plan);

      const detail = `衍生预划 ${plan.derivedAssetPlan.length} 条`;
      if (warnings.length) {
        toast.warning(`导演规划完成（${detail}；光影提示 ${warnings.length} 处已剔除）`);
      } else {
        toast.success(`导演规划完成（${detail}）`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [manualCatalog, saveScriptPlan]);

  const handleDeriveAssets = useCallback((episodeId = "episode-1") => {
    const store = useStudioStore.getState();
    const plan = store.scriptPlans.find((item) => item.episodeId === episodeId);
    if (!plan) {
      toast.error("尚无导演规划：请先运行导演规划，生成⑦衍生预划清单");
      return;
    }
    if (!plan.derivedAssetPlan.length) {
      toast.info("本集导演规划判定无需衍生资产");
      return;
    }

    const projectId = activeProject?.id;
    if (!projectId) {
      toast.error("未选择项目，无法写入衍生资产");
      return;
    }

    const batch = store.entityExtractions.find((item) => item.episodeId === episodeId)
      ?? store.entityExtractions[store.entityExtractions.length - 1];
    if (!batch) {
      toast.error("尚无实体库：请先运行实体提取，衍生资产需绑定父资产");
      return;
    }

    const resolver = buildEntityResolver(
      batch.characters.map((c) => ({ id: c.characterId, name: c.name, aliases: c.aliases })),
      batch.scenes.map((s) => ({ id: s.sceneId, name: s.name })),
    );
    const { summary } = syncDerivedAssets(plan.derivedAssetPlan, {
      projectId,
      resolver,
      ...createMystudioDerivedSinks(),
    });

    if (summary.skipped) {
      toast.warning(`衍生资产落地 ${summary.created} 条，跳过 ${summary.skipped} 条（父资产未匹配）`);
    } else {
      toast.success(`衍生资产落地 ${summary.created} 条`);
    }
  }, [activeProject?.id]);

  const handleStoryboardTable = useCallback(async (episodeId = "episode-1") => {
    if (!window.electronAPI?.textCompletion) {
      toast.error("当前环境不支持模型调用");
      return;
    }

    const store = useStudioStore.getState();
    const scriptText =
      [...store.agentWorkData].reverse().find((item) => item.key === "scriptDraft")?.data
      ?? store.novelChapters.map((chapter) => chapter.sourceText).join("\n\n");
    if (!scriptText.trim()) {
      toast.error("没有可分镜的剧本：请先保存剧本草稿或导入小说正文");
      return;
    }

    const plan = store.scriptPlans.find((item) => item.episodeId === episodeId);
    const scriptPlanContext = plan ? formatScriptPlanContext(plan) : undefined;
    const messages = buildStoryboardTableMessages({ episodeId, scriptText, scriptPlanContext });
    try {
      const result = await aiManager.text({
        binding: { agent: "productionAgent:storyboardTableAgent" },
        messages: [
          { role: "system", content: messages.system },
          { role: "user", content: messages.user },
        ],
        temperature: 0.4,
        maxTokens: 4096,
      });
      if (!result.success || !result.text) {
        throw new Error(result.error || "分镜表生成失败");
      }

      const { rows, errors, warnings } = parseStoryboardTable(result.text, episodeId);
      if (!rows.length) {
        toast.error(`未解析到分镜行${errors.length ? `（非法行 ${errors.length}）` : ""}`);
        return;
      }

      const items = toStoryboardItems(rows, episodeId);
      const existingIds = new Set(useStudioStore.getState().storyboards.map((item) => item.id));
      for (const item of items) {
        if (existingIds.has(item.id)) {
          updateStoryboard(item.id, item);
        } else {
          addStoryboard(item);
        }
      }

      const tail = [
        errors.length ? `非法行 ${errors.length}` : "",
        warnings.length ? `光影提示 ${warnings.length} 处已剔除` : "",
      ].filter(Boolean).join("；");
      toast.success(`分镜表落地 ${items.length} 镜${tail ? `（${tail}）` : ""}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [addStoryboard, updateStoryboard]);

  const handleEpisodeOutline = useCallback(async (episodeId = "episode-1") => {
    if (!window.electronAPI?.textCompletion) {
      toast.error("当前环境不支持模型调用");
      return;
    }

    const store = useStudioStore.getState();
    const latest = (key: AgentWorkKey) =>
      [...store.agentWorkData].reverse().find((item) => item.key === key)?.data;
    const skeletonContext = latest("storySkeleton");
    const strategyContext = latest("adaptationStrategy");
    if (!skeletonContext && !strategyContext) {
      toast.error("尚无骨架/改编策略：请先保存故事骨架或改编策略");
      return;
    }

    const messages = buildEpisodeOutlineMessages({ episodeId, skeletonContext, strategyContext });
    try {
      const result = await aiManager.text({
        binding: { agent: "episodeOutline" },
        messages: [
          { role: "system", content: messages.system },
          { role: "user", content: messages.user },
        ],
        temperature: 0.5,
        maxTokens: 4096,
      });
      if (!result.success || !result.text) {
        throw new Error(result.error || "分集细纲生成失败");
      }

      const { outline, errors, warnings } = parseEpisodeOutline(result.text, episodeId);
      if (!outline.beats.length) {
        toast.error(`未解析到 beat${errors.length ? `（非法行 ${errors.length}）` : ""}`);
        return;
      }

      saveEpisodeOutline(outline);
      const totalSec = outline.beats.reduce((sum, beat) => sum + beat.durationSec, 0);
      const tail = [
        errors.length ? `非法行 ${errors.length}` : "",
        warnings.length ? `光影提示 ${warnings.length} 处已剔除` : "",
      ].filter(Boolean).join("；");
      toast.success(`分集细纲完成（${outline.beats.length} beat / ${totalSec}s${tail ? `；${tail}` : ""}）`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [saveEpisodeOutline]);

  const handleAssignVoices = useCallback(() => {
    const projectId = activeProject?.id;
    if (!projectId) {
      toast.error("未选择项目，无法分配音色");
      return;
    }

    const characters = useCharacterLibraryStore
      .getState()
      .characters.filter((item) => !item.projectId || item.projectId === projectId);
    if (!characters.length) {
      toast.error("角色库为空：请先运行实体提取或手动建角色");
      return;
    }

    const assignments = assignVoicesForCharacters(
      characters.map((item) => ({
        id: item.id,
        name: item.name,
        gender: item.gender,
        age: item.age,
        personality: item.personality,
      })),
    );

    useTtsStore.getState().setActiveProjectId(projectId);
    const { bound } = syncCharacterVoices(assignments, { projectId, sink: createMystudioTtsSink() });
    setVoiceAssignments(assignments);
    toast.success(`音色分配完成（${bound} 个角色已绑定音色）`);
  }, [activeProject?.id]);

  const handleBuildSeriesBible = useCallback(() => {
    const projectId = activeProject?.id;
    if (!projectId) {
      toast.error("未选择项目，无法锁定剧集圣经");
      return;
    }

    const characters = useCharacterLibraryStore
      .getState()
      .characters.filter((item) => !item.projectId || item.projectId === projectId);
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
    const visual = manualCatalog.visual?.find((p) => p.id === workflowConfig.visualManualId)?.name;
    return [
      "## 项目信息",
      `小说名称：${projectName}`,
      workflowConfig.novelGenre ? `小说类型：${workflowConfig.novelGenre}` : "",
      `目标画风：${visual || workflowConfig.stylePositioning || "未设"}`,
      `目标画幅：${workflowConfig.platformSpec || "16:9"}`,
      workflowConfig.episodeCount ? `集数：${workflowConfig.episodeCount}集` : "",
      `单集时长：${workflowConfig.episodeDurationMin ?? 3}分钟`,
      `章节数量：${novelChapters.length}章`,
    ].filter(Boolean).join("\n");
  }, [projectName, workflowConfig.visualManualId, workflowConfig.novelGenre, workflowConfig.stylePositioning, workflowConfig.platformSpec, workflowConfig.episodeCount, workflowConfig.episodeDurationMin, manualCatalog, novelChapters.length]);

  const scriptDirectorContext = useMemo(
    () => buildStudioManualContext(workflowConfig, manualCatalog),
    [workflowConfig, manualCatalog],
  );

  const latestScriptStage = useCallback(
    (key: AgentWorkKey, scopeId: string) =>
      [...agentWorkData].reverse().find((item) => item.key === key && item.episodeId === scopeId)?.data ?? "",
    [agentWorkData],
  );

  const [scriptStreaming, setScriptStreaming] = useState<{ key: AgentWorkKey; scopeId: string; text: string } | null>(null);

  const runScriptStage = useCallback(
    async (opts: {
      agentKey: "storySkeletonAgent" | "adaptationStrategyAgent" | "scriptDraft";
      messages: { system: string; user: string };
      stageKey: AgentWorkKey;
      scopeId: string;
      label: string;
      revised?: boolean;
    }) => {
      setScriptStreaming({ key: opts.stageKey, scopeId: opts.scopeId, text: "" });
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
            s && s.key === opts.stageKey && s.scopeId === opts.scopeId ? { ...s, text: s.text + delta } : s,
          ),
      );
      setScriptStreaming(null);
      if (!result.success || !result.text) {
        toast.error(result.error || `${opts.label}生成失败`);
        return;
      }
      saveAgentWorkData(opts.stageKey, parseStageOutput(result.text), opts.scopeId);
      toast.success(opts.revised ? `已按审核修订「${opts.label}」，请重新审核确认` : `${opts.label}已生成`);
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
    [runScriptStage, latestScriptStage, scriptStyleSummary, scriptDirectorContext],
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
              {activeWorkflowTab === "novel" ? novelHeaderActions : activeWorkflowTab === "script" ? scriptHeaderActions : activeWorkflowTab === "assets" ? assetsHeaderActions : null}
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
                handleEntityExtraction={handleEntityExtraction}
                entityExtractions={entityExtractions}
                handleDirectorPlan={handleDirectorPlan}
                handleDeriveAssets={handleDeriveAssets}
                handleStoryboardTable={handleStoryboardTable}
                handleBuildSeriesBible={handleBuildSeriesBible}
                handleEpisodeOutline={handleEpisodeOutline}
                episodeOutlines={episodeOutlines}
                handleAssignVoices={handleAssignVoices}
                voiceAssignments={voiceAssignments}
                scriptPlans={scriptPlans}
                storyboards={storyboards}
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
              <GenerationTab />
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
    toast.success(importMode === "replace" ? "小说章节已覆盖导入" : "小说章节已追加导入");
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
              <Button variant={importMode === "replace" ? "default" : "secondary"} onClick={() => setImportMode("replace")}>覆盖导入</Button>
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
            <Label className="text-xs text-muted-foreground">集数</Label>
            <Input type="number" min={1} value={props.workflowConfig.episodeCount ?? ""} onChange={(e) => props.setWorkflowConfig({ episodeCount: e.target.value ? Number(e.target.value) : undefined })} className="h-8" placeholder="例如 12" />
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
  handleEntityExtraction: (episodeId?: string) => void;
  entityExtractions: ReturnType<typeof useStudioStore.getState>["entityExtractions"];
  handleDirectorPlan: (episodeId?: string) => void;
  handleDeriveAssets: (episodeId?: string) => void;
  handleStoryboardTable: (episodeId?: string) => void;
  handleBuildSeriesBible: () => void;
  handleEpisodeOutline: (episodeId?: string) => void;
  episodeOutlines: ReturnType<typeof useStudioStore.getState>["episodeOutlines"];
  handleAssignVoices: () => void;
  voiceAssignments: VoiceAssignment[];
  scriptPlans: ReturnType<typeof useStudioStore.getState>["scriptPlans"];
  storyboards: ReturnType<typeof useStudioStore.getState>["storyboards"];
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
            {taskOptions.filter((item) => item.key !== "eventAnalysis").map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
          <Button onClick={props.handleBuildContext} className="w-full">
            <WandSparkles className="h-4 w-4" />
            生成上下文包
          </Button>
          <Button variant="secondary" onClick={props.handleBuildSeriesBible} className="w-full">
            <BookMarked className="h-4 w-4" />
            锁定剧集圣经
          </Button>
          {props.selectedTask === "entityExtraction" && (
            <Button variant="default" onClick={() => props.handleEntityExtraction("episode-1")} className="w-full">
              <Boxes className="h-4 w-4" />
              运行实体提取
            </Button>
          )}
          {props.selectedTask === "directorPlan" && (
            <Button variant="default" onClick={() => props.handleDirectorPlan("episode-1")} className="w-full">
              <ClipboardList className="h-4 w-4" />
              运行导演规划
            </Button>
          )}
          {props.selectedTask === "deriveAssets" && (
            <Button variant="default" onClick={() => props.handleDeriveAssets("episode-1")} className="w-full">
              <Boxes className="h-4 w-4" />
              落地衍生资产
            </Button>
          )}
          {props.selectedTask === "storyboardTable" && (
            <Button variant="default" onClick={() => props.handleStoryboardTable("episode-1")} className="w-full">
              <Split className="h-4 w-4" />
              运行分镜表
            </Button>
          )}
          {props.selectedTask === "episodeOutline" && (
            <Button variant="default" onClick={() => props.handleEpisodeOutline("episode-1")} className="w-full">
              <ClipboardList className="h-4 w-4" />
              运行分集细纲
            </Button>
          )}
          {props.selectedTask === "voiceAssign" && (
            <Button variant="default" onClick={() => props.handleAssignVoices()} className="w-full">
              <WandSparkles className="h-4 w-4" />
              分配角色音色
            </Button>
          )}
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

      {props.selectedTask === "entityExtraction" ? (
        <EntityExtractionPreview entityExtractions={props.entityExtractions} />
      ) : props.selectedTask === "directorPlan" || props.selectedTask === "deriveAssets" ? (
        <ScriptPlanPreview scriptPlans={props.scriptPlans} />
      ) : props.selectedTask === "storyboardTable" ? (
        <StoryboardTablePreview storyboards={props.storyboards} />
      ) : props.selectedTask === "episodeOutline" ? (
        <EpisodeOutlinePreview episodeOutlines={props.episodeOutlines} />
      ) : props.selectedTask === "voiceAssign" ? (
        <VoiceAssignPreview voiceAssignments={props.voiceAssignments} />
      ) : (
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="text-sm">上下文包预览</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea value={props.lastContextPackage?.markdown ?? ""} readOnly className="min-h-[560px] font-mono text-xs" />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function EntityExtractionPreview(props: {
  entityExtractions: ReturnType<typeof useStudioStore.getState>["entityExtractions"];
}) {
  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle className="text-sm">实体提取结果</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {props.entityExtractions.length === 0 ? (
          <p className="text-xs text-muted-foreground">尚未提取实体。选择剧本来源后点击「运行实体提取」。</p>
        ) : (
          props.entityExtractions.map((batch) => (
            <div key={batch.id} className="space-y-2 rounded-md border border-border p-3 text-xs">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{batch.episodeId}</Badge>
                <span className="text-muted-foreground">
                  角色 {batch.characters.length} / 场景 {batch.scenes.length} / 道具 {batch.props.length}
                </span>
              </div>
              {batch.characters.length > 0 && (
                <div>
                  <div className="font-medium">角色</div>
                  <ul className="mt-1 space-y-0.5 text-muted-foreground">
                    {batch.characters.map((item) => (
                      <li key={item.characterId}>
                        {item.name}
                        {item.aliases.length ? `（别名：${item.aliases.join("、")}）` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {batch.scenes.length > 0 && (
                <div>
                  <div className="font-medium">场景</div>
                  <ul className="mt-1 space-y-0.5 text-muted-foreground">
                    {batch.scenes.map((item) => <li key={item.sceneId}>{item.name}</li>)}
                  </ul>
                </div>
              )}
              {batch.props.length > 0 && (
                <div>
                  <div className="font-medium">道具</div>
                  <ul className="mt-1 space-y-0.5 text-muted-foreground">
                    {batch.props.map((item) => <li key={item.assetId}>{item.name}</li>)}
                  </ul>
                </div>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function ScriptPlanPreview(props: {
  scriptPlans: ReturnType<typeof useStudioStore.getState>["scriptPlans"];
}) {
  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle className="text-sm">导演规划结果</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {props.scriptPlans.length === 0 ? (
          <p className="text-xs text-muted-foreground">尚无导演规划。选择剧本来源后点击「运行导演规划」。</p>
        ) : (
          props.scriptPlans.map((plan) => (
            <div key={plan.id} className="space-y-2 rounded-md border border-border p-3 text-xs">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{plan.episodeId}</Badge>
                <span className="text-muted-foreground">衍生预划 {plan.derivedAssetPlan.length} 条</span>
              </div>
              {plan.theme && <PlanField label="① 主题立意" value={plan.theme} />}
              {plan.visualStyle && <PlanField label="② 视觉风格" value={plan.visualStyle} />}
              {plan.narrativeRhythm && <PlanField label="③ 叙事节奏" value={plan.narrativeRhythm} />}
              {plan.soundDirection && <PlanField label="⑤ 声音方向" value={plan.soundDirection} />}
              {plan.transitions && <PlanField label="⑥ 转场连续性" value={plan.transitions} />}
              {plan.derivedAssetPlan.length > 0 && (
                <div>
                  <div className="font-medium">⑦ 衍生资产预划</div>
                  <ul className="mt-1 space-y-0.5 text-muted-foreground">
                    {plan.derivedAssetPlan.map((row, idx) => (
                      <li key={`${plan.id}-${idx}`}>
                        {row.parentAssetId} · {row.state}
                        {row.reason ? ` — ${row.reason}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function PlanField(props: { label: string; value: string }) {
  return (
    <div>
      <div className="font-medium">{props.label}</div>
      <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{props.value}</p>
    </div>
  );
}

function StoryboardTablePreview(props: {
  storyboards: ReturnType<typeof useStudioStore.getState>["storyboards"];
}) {
  const rows = [...props.storyboards].sort((a, b) => a.index - b.index);
  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle className="text-sm">分镜表结果</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">尚无分镜。选择剧本来源后点击「运行分镜表」。</p>
        ) : (
          rows.map((shot) => (
            <div key={shot.id} className="space-y-1 rounded-md border border-border p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">#{shot.index}</Badge>
                <span className="text-muted-foreground">{shot.duration}s</span>
                {shot.emotion && <Badge variant="secondary">{shot.emotion}</Badge>}
                {shot.orientation && <span className="text-muted-foreground">{shot.orientation}</span>}
              </div>
              <p className="whitespace-pre-wrap">{shot.prompt}</p>
              {shot.spatialRelation && (
                <p className="text-muted-foreground">空间：{shot.spatialRelation}</p>
              )}
              {shot.associateAssetsNames?.length ? (
                <p className="text-muted-foreground">资产：{shot.associateAssetsNames.join("、")}</p>
              ) : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function EpisodeOutlinePreview(props: {
  episodeOutlines: ReturnType<typeof useStudioStore.getState>["episodeOutlines"];
}) {
  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle className="text-sm">分集细纲结果</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {props.episodeOutlines.length === 0 ? (
          <p className="text-xs text-muted-foreground">尚无细纲。选择骨架/改编来源后点击「运行分集细纲」。</p>
        ) : (
          props.episodeOutlines.map((outline) => {
            const totalSec = outline.beats.reduce((sum, beat) => sum + beat.durationSec, 0);
            return (
              <div key={outline.id} className="space-y-2 rounded-md border border-border p-3 text-xs">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{outline.episodeId}</Badge>
                  <span className="text-muted-foreground">{outline.beats.length} beat / {totalSec}s</span>
                </div>
                <ol className="space-y-1 text-muted-foreground">
                  {outline.beats.map((beat) => (
                    <li key={`${outline.id}-${beat.sceneIndex}`}>
                      <span className="font-medium text-foreground">#{beat.sceneIndex} {beat.location}</span>
                      <span className="ml-1">（{beat.durationSec}s）</span>
                      <p className="mt-0.5 whitespace-pre-wrap">{beat.beat}</p>
                    </li>
                  ))}
                </ol>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

function VoiceAssignPreview(props: { voiceAssignments: VoiceAssignment[] }) {
  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle className="text-sm">音色分配结果</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {props.voiceAssignments.length === 0 ? (
          <p className="text-xs text-muted-foreground">尚未分配音色。点击「分配角色音色」按角色性别/年龄/性格自动匹配中文预设音色。</p>
        ) : (
          <ul className="space-y-2 text-xs">
            {props.voiceAssignments.map((assignment) => (
              <li key={assignment.characterId} className="rounded-md border border-border p-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{assignment.characterId}</Badge>
                  <Badge variant="secondary">{assignment.presetVoiceId}</Badge>
                  <span className="text-muted-foreground">{assignment.engine}</span>
                </div>
                <p className="mt-1 text-muted-foreground">{assignment.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ScriptTab(props: {
  novelChapters: ReturnType<typeof useStudioStore.getState>["novelChapters"];
  agentWorkData: ReturnType<typeof useStudioStore.getState>["agentWorkData"];
  saveAgentWorkData: ReturnType<typeof useStudioStore.getState>["saveAgentWorkData"];
  runStage: (stage: ScriptStageKey, chapter: NovelChapter, userOverride?: string) => void;
  runReview: (stage: ReviewableStage, chapter: NovelChapter) => void;
  manualContext: string;
  directorContext: string;
  styleSummary: string;
  setHeaderActions: (actions: ReactNode) => void;
  scriptStreaming: { key: AgentWorkKey; scopeId: string; text: string } | null;
}) {
  const SCRIPT_STAGES: ScriptStageKey[] = ["storySkeleton", "adaptationStrategy", "scriptDraft"];
  const PREREQ: Partial<Record<ScriptStageKey, ScriptStageKey>> = {
    adaptationStrategy: "storySkeleton",
    scriptDraft: "adaptationStrategy",
  };

  const [chapterId, setChapterId] = useState(props.novelChapters[0]?.id ?? "");
  const [activeStage, setActiveStage] = useState<ScriptStageKey>("storySkeleton");
  const [editor, setEditor] = useState<{ target: "output" | "context"; value: string } | null>(null);
  const [userDraft, setUserDraft] = useState<string | undefined>(undefined);
  useEffect(() => {
    setEditor(null);
    setUserDraft(undefined);
  }, [chapterId, activeStage]);

  const chapter = props.novelChapters.find((item) => item.id === chapterId) ?? props.novelChapters[0];
  const stageData = (key: AgentWorkKey) =>
    chapter ? [...props.agentWorkData].reverse().find((item) => item.key === key && item.episodeId === chapter.id) : undefined;

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
            <option key={item.id} value={item.id}>{item.index}. {item.title}</option>
          ))}
        </select>
      </div>,
    );
    return () => setHeaderActions(null);
  }, [setHeaderActions, props.novelChapters, chapterId]);

  const streamingText =
    props.scriptStreaming && props.scriptStreaming.key === activeStage && props.scriptStreaming.scopeId === (chapter?.id ?? "")
      ? props.scriptStreaming.text
      : null;
  const isStreaming = streamingText !== null;
  const reviewStreaming =
    props.scriptStreaming && reviewKey && props.scriptStreaming.key === reviewKey && props.scriptStreaming.scopeId === (chapter?.id ?? "")
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
    const id = setInterval(() => setLiveMd(extractPartialContent(streamRef.current)), 300);
    return () => clearInterval(id);
  }, [isStreaming]);
  const livePreview = useMemo(() => <MdPreview modelValue={liveMd} theme="dark" language="zh-CN" />, [liveMd]);

  if (!props.novelChapters.length) {
    return <div className="p-6 text-sm text-muted-foreground">请先在「小说导入」导入章节（建议先做事件分析），再来这里逐章生成剧本。</div>;
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
    activeStage === "adaptationStrategy" || activeStage === "scriptDraft" ? "导演手法" : "",
    chapter ? `章节：${chapter.title}` : "",
    chapter?.eventState ? "事件分析" : "",
    activeStage !== "storySkeleton" && stageData("storySkeleton") ? "故事骨架" : "",
    activeStage === "scriptDraft" && stageData("adaptationStrategy") ? "改编策略" : "",
    reviseMode ? "审核意见(修订模式)" : "",
    "本章正文",
  ].filter(Boolean).join(" · ");

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
            {idx + 1}. {SCRIPT_STAGE_LABEL[stage]}{stageData(stage) ? " ✓" : ""}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <details className="rounded-md border border-border p-2 text-xs" open>
            <summary className="cursor-pointer font-medium">事件（本章）</summary>
            <pre className="mt-2 h-40 min-h-[80px] resize-y overflow-auto whitespace-pre-wrap leading-5">{[`章节：${chapter?.title ?? ""}`, chapter?.eventSummary ? `事件摘要：${chapter.eventSummary}` : "", chapter?.eventState ? `事件状态：\n${chapter.eventState}` : ""].filter(Boolean).join("\n\n")}</pre>
          </details>
          <details className="rounded-md border border-border p-2 text-xs">
            <summary className="cursor-pointer font-medium">Skill 手册</summary>
            <pre className="mt-2 h-40 min-h-[80px] resize-y overflow-auto whitespace-pre-wrap leading-5">{skill || "（未找到该阶段 skill 手册）"}</pre>
          </details>
          <details className="rounded-md border border-border p-2 text-xs">
            <summary className="cursor-pointer font-medium">发送内容（上下文）</summary>
            <div className="mt-2 flex items-start justify-between gap-2">
              <p className="text-muted-foreground">含：{sentSummary}</p>
              <Button size="sm" variant="secondary" className="shrink-0" onClick={() => setEditor({ target: "context", value: userDraft ?? messages.user })}>
                <Edit3 className="h-4 w-4" />
                可编辑
              </Button>
            </div>
            <pre className="mt-2 h-40 min-h-[80px] resize-y overflow-auto whitespace-pre-wrap leading-5">{userDraft ?? messages.user}</pre>
          </details>
          <Button className="w-full" disabled={!chapter || !hasPrereq || props.scriptStreaming !== null} onClick={() => chapter && props.runStage(activeStage, chapter, userDraft)}>
            <WandSparkles className="h-4 w-4" />
            {streamingText !== null ? "生成中…" : reviseMode ? "根据审核报告一键修复" : `一键生成${SCRIPT_STAGE_LABEL[activeStage]}`}
          </Button>
          <Button variant="secondary" className="w-full" disabled={!chapter || !output || props.scriptStreaming !== null} onClick={() => chapter && props.runReview(activeStage as ReviewableStage, chapter)}>
            <ClipboardList className="h-4 w-4" />
            {reviewStreaming !== null ? "审核中…" : `审核${SCRIPT_STAGE_LABEL[activeStage]}`}
          </Button>
          {!hasPrereq && prereq ? (
            <p className="text-xs text-muted-foreground">请先完成「{SCRIPT_STAGE_LABEL[prereq]}」</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm">输出结果</Label>
            <div className="flex items-center gap-2">
              {data ? <Badge variant="outline">已生成</Badge> : <Badge variant="secondary">未生成</Badge>}
              <Button size="sm" variant="secondary" disabled={!output} onClick={() => setEditor({ target: "output", value: output })}>
                <Edit3 className="h-4 w-4" />
                可编辑
              </Button>
            </div>
          </div>
          <div className="min-h-[460px] rounded-md border border-border p-3 text-sm">
            {streamingText !== null ? (
              liveMd ? livePreview : <p className="text-muted-foreground">生成中…</p>
            ) : output ? (
              <MdPreview modelValue={output} theme="dark" language="zh-CN" />
            ) : (
              <p className="text-muted-foreground">{hasPrereq ? "点上方「一键生成」由 AI 产出" : "请先完成前置阶段"}</p>
            )}
          </div>
          {(reviewStreaming !== null || reviewData) && (
            <div className="space-y-1">
              <Label className="text-sm">审核报告（{SCRIPT_STAGE_LABEL[activeStage]}）{reviseMode ? " · 有待修复问题" : ""}</Label>
              <div className="rounded-md border border-border p-3 text-sm">
                {reviewStreaming !== null ? (
                  <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap text-xs leading-5">{extractPartialContent(reviewStreaming) || "审核中…"}</pre>
                ) : (
                  <MdPreview modelValue={reviewData ?? ""} theme="dark" language="zh-CN" />
                )}
              </div>
            </div>
          )}
          <Dialog open={!!editor} onOpenChange={(open) => !open && setEditor(null)}>
            <DialogContent className="flex h-[88vh] max-w-[92vw] flex-col gap-3 sm:max-w-[92vw]">
              <DialogHeader>
                <DialogTitle>编辑 · {editor?.target === "context" ? "发送内容" : SCRIPT_STAGE_LABEL[activeStage]}</DialogTitle>
              </DialogHeader>
              <div className="min-h-0 flex-1">
                <MdEditor modelValue={editor?.value ?? ""} onChange={(value) => setEditor((prev) => (prev ? { ...prev, value } : prev))} theme="dark" language="zh-CN" toolbarsExclude={["github"]} style={{ height: "100%" }} />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditor(null)}>取消</Button>
                <Button
                  onClick={() => {
                    if (!editor) return;
                    if (editor.target === "output") {
                      if (chapter) props.saveAgentWorkData(activeStage, editor.value, chapter.id);
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

function AssetsTab(props: {
  novelChapters: ReturnType<typeof useStudioStore.getState>["novelChapters"];
  agentWorkData: ReturnType<typeof useStudioStore.getState>["agentWorkData"];
  entityExtractions: ReturnType<typeof useStudioStore.getState>["entityExtractions"];
  extractAssets: (episodeId: string) => Promise<void> | void;
  updateExtraction: (batch: ReturnType<typeof useStudioStore.getState>["entityExtractions"][number]) => void;
  setHeaderActions: (actions: ReactNode) => void;
}) {
  type Batch = ReturnType<typeof useStudioStore.getState>["entityExtractions"][number];
  type AssetType = "character" | "scene" | "prop";
  const [extractingId, setExtractingId] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ episodeId: string; type: AssetType } | null>(null);
  const [addValue, setAddValue] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // 对接资产中心（assets.db）+ 本地轻量库：按名字 + 别名 + 模糊匹配 + 描述相似匹配
  const libChars = useCharacterLibraryStore((s) => s.characters);
  const libScenes = useSceneStore((s) => s.scenes);
  const libProps = usePropsLibraryStore((s) => s.items);

  // 资产中心缓存（异步加载，一次全取）
  const [assetCenterNames, setAssetCenterNames] = useState<Record<string, { name: string; desc: string }[]>>({ role: [], scene: [], tool: [] });
  useEffect(() => {
    if (typeof window === "undefined" || !(window as unknown as Record<string, unknown>).studioAssets) return;
    const sa = (window as unknown as Record<string, unknown>).studioAssets as { list: (p: Record<string, unknown>) => Promise<{ items: Record<string, unknown>[] }> };
    for (const t of ["role", "scene", "tool"]) {
      sa.list({ type: t, limit: 99999 }).then((res) => {
        setAssetCenterNames((prev) => ({
          ...prev,
          [t]: (res.items || []).map((it) => ({ name: String(it.name ?? ""), desc: String(it.description ?? "") })),
        }));
      }).catch(() => {});
    }
  }, []);

  /** 规范化名字：去空白、标点，统一比较 */
  const normalize = (s: string) => s.replace(/[\s\u3000·•\-—\-\(\)（）\[\]【】]/g, "").toLowerCase();

  /** 检查提取名是否匹配资产库名（精确 or 规范化 or 包含） */
  const nameMatches = (extractedName: string, libName: string, aliases: string[] = []): boolean => {
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
  const descMatches = (note: string | undefined, libDesc: string, threshold = 2): boolean => {
    if (!note || !libDesc) return false;
    const keywords = note.split(/[,，、\s;；。！？!?·]+/).filter((w) => w.length >= 2);
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
    const genericKws = ["孩童", "丫头", "丫鬟", "苦力", "杂役", "小厮", "路人", "村民", "仆人", "仆从", "侍女", "侍者", "守卫", "卫兵", "弟子", "门人", "长老", "执事", "掌柜"];
    return genericKws.some((kw) => name.includes(kw));
  };

  /** 资产匹配状态：不存在(爆红) / 已有但无图(黄) / 已制作(绿)
   *  匹配策略：先查本地轻量库，再查资产中心（assets.db），按名字+别名+描述+泛称NPC兜底 */
  const getAssetStatus = (type: AssetType, name: string, note?: string): "missing" | "exists" | "made" => {
    // 规范化匹配辅助
    const findMatch = (
      localItems: { name: string; aliases?: string[]; desc?: string }[],
      centerItems: { name: string; desc: string }[],
      fallbackGeneric?: boolean,
    ): boolean => {
      // 先查本地库
      if (localItems.some((it) => nameMatches(name, it.name, it.aliases ?? []))) return true;
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
        if (centerItems.some((it) => genericNames.some((gn) => normalize(it.name).includes(normalize(gn))))) return true;
      }
      return false;
    };

    if (type === "character") {
      const localItems = libChars.map((c) => ({ name: c.name, aliases: (c as unknown as Record<string, unknown>).aliases as string[] ?? [], desc: [c.description, c.role, c.personality, c.traits].filter(Boolean).join(" ") }));
      const found = findMatch(localItems, assetCenterNames.role, true);
      if (!found) return "missing";
      const hasImg = libChars.some((c) => nameMatches(name, c.name) && (!!c.thumbnailUrl || (c.views?.length ?? 0) > 0));
      return hasImg ? "made" : "exists";
    }
    if (type === "scene") {
      const localItems = libScenes.map((s) => ({ name: s.name, desc: [(s as unknown as Record<string, unknown>).atmosphere as string, (s as unknown as Record<string, unknown>).location as string, s.name].filter(Boolean).join(" ") }));
      const found = findMatch(localItems, assetCenterNames.scene);
      if (!found) return "missing";
      const hasImg = libScenes.some((s) => nameMatches(name, s.name) && (!!s.referenceImage || !!s.referenceImageBase64));
      return hasImg ? "made" : "exists";
    }
    // prop
    const localItems = libProps.map((p) => ({ name: p.name, desc: (p as unknown as Record<string, unknown>).description as string ?? "" }));
    const found = findMatch(localItems, assetCenterNames.tool);
    if (!found) return "missing";
    const hasImg = libProps.some((p) => nameMatches(name, p.name) && !!((p as unknown as Record<string, unknown>).imageUrl));
    return hasImg ? "made" : "exists";
  };

  const scriptChapters = useMemo(
    () => props.novelChapters.filter((ch) => props.agentWorkData.some((w) => w.key === "scriptDraft" && w.episodeId === ch.id)),
    [props.novelChapters, props.agentWorkData],
  );

  const run = async (id: string) => {
    setExtractingId(id);
    try { await props.extractAssets(id); } finally { setExtractingId(null); }
  };

  const setHeaderActions = props.setHeaderActions;
  const extractAssets = props.extractAssets;
  useEffect(() => {
    setHeaderActions(
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground">从剧本提取资产（角色 / 场景 / 道具），与资产库匹配；<span className="text-destructive">红色=未制作</span>，需到「塑造角色与场景」生成。</span>
        <Button size="sm" disabled={extractingId !== null || scriptChapters.length === 0} onClick={async () => { for (const ch of scriptChapters) { setExtractingId(ch.id); try { await extractAssets(ch.id); } finally { setExtractingId(null); } } }}>
          <Boxes className="h-4 w-4" />
          {extractingId !== null ? "提取中…" : "批量提取全部"}
        </Button>
      </div>,
    );
    return () => setHeaderActions(null);
  }, [setHeaderActions, extractAssets, scriptChapters, extractingId]);

  const genId = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const removeAsset = (batch: Batch, type: AssetType, id: string) => {
    const next: Batch =
      type === "character" ? { ...batch, characters: batch.characters.filter((c) => c.characterId !== id) }
        : type === "scene" ? { ...batch, scenes: batch.scenes.filter((s) => s.sceneId !== id) }
          : { ...batch, props: batch.props.filter((p) => p.assetId !== id) };
    props.updateExtraction(next);
  };
  const submitAdd = (batch: Batch) => {
    const name = addValue.trim();
    if (!adding || !name) { setAdding(null); setAddValue(""); return; }
    const next: Batch =
      adding.type === "character" ? { ...batch, characters: [...batch.characters, { characterId: genId("char"), name, aliases: [] }] }
        : adding.type === "scene" ? { ...batch, scenes: [...batch.scenes, { sceneId: genId("scene"), name }] }
          : { ...batch, props: [...batch.props, { assetId: genId("asset"), name }] };
    props.updateExtraction(next);
    setAdding(null);
    setAddValue("");
  };

  if (!scriptChapters.length) {
    return <div className="p-6 text-sm text-muted-foreground">还没有剧本：请先在「剧本策划」生成各章剧本，再来提取资产（角色/场景/道具）。</div>;
  }

  const renderCat = (batch: Batch, type: AssetType, label: string, items: { id: string; name: string; note?: string }[]) => (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 font-medium">{label}：</span>
      {items.map(({ id, name, note }) => {
        const status = getAssetStatus(type, name, note);
        const badgeClass = cn(
          "font-normal",
          status === "missing" && "border-destructive text-destructive",
          status === "exists" && "border-yellow-500 text-yellow-600 dark:text-yellow-400",
        );
        const title = status === "made" ? "已制作" : status === "exists" ? "资产库已有，尚未生成图片" : "资产库中不存在，请先创建";
        return (
          <span key={id} className="group relative inline-flex">
            <Badge variant={status === "made" ? "secondary" : "outline"} className={badgeClass} title={title}>{name}</Badge>
            <button
              type="button"
              title="删除"
              onClick={() => removeAsset(batch, type, id)}
              className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold leading-none text-destructive-foreground shadow group-hover:flex"
            >×</button>
          </span>
        );
      })}
      {adding?.episodeId === batch.episodeId && adding.type === type ? (
        <span className="inline-flex items-center gap-1">
          <Input autoFocus value={addValue} onChange={(e) => setAddValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submitAdd(batch); if (e.key === "Escape") { setAdding(null); setAddValue(""); } }} className="h-6 w-28 text-xs" placeholder={`新${label}`} />
          <Button size="sm" variant="secondary" className="h-6 px-2" onClick={() => submitAdd(batch)}>确定</Button>
        </span>
      ) : (
        <button type="button" className="text-xs text-primary hover:underline" onClick={() => { setAdding({ episodeId: batch.episodeId, type }); setAddValue(""); }}>+ 添加</button>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {scriptChapters.map((ch) => {
        const batch = props.entityExtractions.find((b) => b.episodeId === ch.id);
        const script = [...props.agentWorkData].reverse().find((w) => w.key === "scriptDraft" && w.episodeId === ch.id)?.data;
        const open = !collapsed.has(ch.id);
        return (
          <Card key={ch.id} className="rounded-lg">
            <CardHeader className="flex-row items-center justify-between space-y-0 py-3">
              <button type="button" className="flex min-w-0 items-center gap-2 text-left" onClick={() => toggle(ch.id)}>
                <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", !open && "-rotate-90")} />
                <CardTitle className="truncate text-sm">{ch.index}. {ch.title}</CardTitle>
                {batch ? (
                  <span className="shrink-0 text-xs text-muted-foreground">（角色 {batch.characters.length} / 场景 {batch.scenes.length} / 道具 {batch.props.length}）</span>
                ) : !script ? (
                  <span className="shrink-0 text-xs text-muted-foreground">（暂无剧本）</span>
                ) : null}
              </button>
              <Button size="sm" disabled={!script || extractingId !== null} onClick={() => run(ch.id)}>
                <Boxes className="h-4 w-4" />
                {extractingId === ch.id ? "提取中…" : batch ? "重新提取资产" : "提取资产"}
              </Button>
            </CardHeader>
            {open && (
              <CardContent className="space-y-3 text-xs">
                <details className="rounded-md border border-border p-2">
                  <summary className="cursor-pointer font-medium">剧本内容</summary>
                  <pre className="mt-2 max-h-[320px] overflow-auto whitespace-pre-wrap leading-5">{script || "本章暂无剧本：请先在「剧本策划」生成本章剧本。"}</pre>
                </details>
                {!batch ? (
                  <p className="text-muted-foreground">{script ? "尚未提取。点「提取资产」从本章剧本抽取角色/场景/道具。" : "本章暂无剧本，无法提取资产。"}</p>
                ) : (
                  <>
                    {renderCat(batch, "character", "角色", batch.characters.map((c) => ({ id: c.characterId, name: c.name, note: c.note })))}
                    {renderCat(batch, "scene", "场景", batch.scenes.map((s) => ({ id: s.sceneId, name: s.name, note: s.note })))}
                    {renderCat(batch, "prop", "道具", batch.props.map((p) => ({ id: p.assetId, name: p.name, note: p.note })))}
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

// ==================== 剧情产物生成 Tab ====================

function GenerationTab() {
  const visualManualId = useStudioStore((s) => s.workflowConfig?.visualManualId);
  const [activeType, setActiveType] = useState<"character" | "scene" | "prop">("character");
  const [isPolishing, setIsPolishing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [isCancelled, setIsCancelled] = useState(false);

  // 音色分配状态
  const [voiceDialogChar, setVoiceDialogChar] = useState<{
    id: string; name: string; gender?: string; age?: string; personality?: string;
  } | null>(null);
  const [isBatchVoiceAssigning, setIsBatchVoiceAssigning] = useState(false);
  const [batchVoiceProgress, setBatchVoiceProgress] = useState(0);

  // 从各 Store 获取资产统计
  const characters = useCharacterLibraryStore((s) => s.characters);
  const scenes = useSceneStore((s) => s.scenes);
  const props = usePropsLibraryStore((s) => s.items);

  // 统计音色分配情况
  const voiceStats = useMemo(() => {
    const ttsState = useTtsStore.getState();
    const pid = ttsState.activeProjectId;
    const bindings = pid ? (ttsState.projects[pid]?.bindings ?? {}) : {};
    const voiceProfiles = ttsState.voiceProfiles;
    let assigned = 0;
    for (const c of characters) {
      const speakerId = `character:${c.id}` as TtsSpeakerId;
      const binding = bindings[speakerId];
      if (binding && voiceProfiles[binding.profileId]) assigned++;
    }
    return { total: characters.length, assigned, unassigned: characters.length - assigned };
  }, [characters]);

  // 统计各类型的润色状态
  const stats = useMemo(() => {
    const countStatus = (items: Array<{ promptState?: string }>) => ({
      total: items.length,
      none: items.filter((i) => !i.promptState || i.promptState === "none").length,
      polishing: items.filter((i) => i.promptState === "polishing").length,
      ready: items.filter((i) => i.promptState === "ready").length,
      failed: items.filter((i) => i.promptState === "failed").length,
    });
    return {
      character: countStatus(characters),
      scene: countStatus(scenes),
      prop: countStatus(props),
    };
  }, [characters, scenes, props]);

  const currentStats = stats[activeType];

  const handlePolishAll = useCallback(async () => {
    if (!visualManualId) {
      toast.error("请先在「风格与导演选择」中选择视觉手册");
      return;
    }
    setIsPolishing(true);
    setIsCancelled(false);
    setProgress({ done: 0, total: 0 });

    const { polishAssetsAndUpdateStore } = await import("@/lib/studio/asset-generation-orchestrator");
    const result = await polishAssetsAndUpdateStore(activeType, visualManualId, {
      concurrency: 3,
      onProgress: (done, total) => setProgress({ done, total }),
      onCancel: () => isCancelled,
    });

    setIsPolishing(false);
    if (result.failed > 0) {
      toast.warning(`润色完成：${result.success} 成功，${result.failed} 失败`);
    } else {
      toast.success(`润色完成：${result.success} 个资产已就绪`);
    }
  }, [activeType, visualManualId, isCancelled]);

  /** 批量自动分配音色（仅处理未分配的角色） */
  const handleBatchVoiceAssign = useCallback(async () => {
    const ttsState = useTtsStore.getState();
    const pid = ttsState.activeProjectId;
    if (!pid) {
      toast.error("请先打开一个项目");
      return;
    }
    const bindings = ttsState.projects[pid]?.bindings ?? {};
    const voiceProfiles = ttsState.voiceProfiles;

    // 筛选未分配的角色
    const unassigned = characters.filter((c) => {
      const speakerId = `character:${c.id}` as TtsSpeakerId;
      const binding = bindings[speakerId];
      return !binding || !voiceProfiles[binding.profileId];
    });
    if (unassigned.length === 0) {
      toast.info("所有角色已分配音色");
      return;
    }

    setIsBatchVoiceAssigning(true);
    setBatchVoiceProgress(0);
    try {
      const charInputs: VoiceAssignerCharacter[] = unassigned.map((c) => ({
        id: c.id,
        name: c.name,
        gender: c.gender,
        age: c.age,
        personality: c.personality,
      }));
      const assignments = assignVoicesForCharacters(charInputs);
      const sink = createMystudioTtsSink();
      syncCharacterVoices(assignments, { projectId: pid, sink });

      for (let i = 0; i < assignments.length; i++) {
        setBatchVoiceProgress(i + 1);
      }
      toast.success(`已为 ${assignments.length} 个角色自动分配音色`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "批量分配失败");
    } finally {
      setIsBatchVoiceAssigning(false);
      setBatchVoiceProgress(0);
    }
  }, [characters]);

  const typeConfig = [
    { key: "character" as const, label: "角色", icon: Users },
    { key: "scene" as const, label: "场景", icon: MapPin },
    { key: "prop" as const, label: "道具", icon: Gem },
  ];

  return (
    <div className="h-full flex flex-col">
      {/* 类型选择 */}
      <div className="flex items-center gap-1 border-b px-3 py-2 bg-panel">
        {typeConfig.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveType(key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors ${
              activeType === key
                ? "bg-primary/15 text-primary font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            <span className="text-xs opacity-70">({stats[key].ready}/{stats[key].total})</span>
          </button>
        ))}

        <div className="flex-1" />

        {!visualManualId && (
          <span className="text-xs text-amber-500 mr-2">⚠ 未选择视觉手册</span>
        )}

        {/* 批量润色按钮 */}
        <button
          onClick={handlePolishAll}
          disabled={isPolishing || !visualManualId || currentStats.none === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary/20 text-primary text-sm hover:bg-primary/30 disabled:opacity-40 transition-colors"
        >
          <WandSparkles className="h-3.5 w-3.5" />
          {isPolishing ? `润色中 ${progress.done}/${progress.total}` : `全部润色提示词 (${currentStats.none})`}
        </button>

        {/* 图片生成按钮（Phase 2） */}
        <button
          disabled
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary/20 text-primary text-sm opacity-40 cursor-not-allowed"
        >
          全部生成图片
        </button>

        {/* 批量分配音色按钮（仅角色 tab 显示） */}
        {activeType === "character" && voiceStats.total > 0 && (
          <button
            onClick={handleBatchVoiceAssign}
            disabled={isBatchVoiceAssigning || voiceStats.unassigned === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary/20 text-primary text-sm hover:bg-primary/30 disabled:opacity-40 transition-colors"
          >
            <Mic className="h-3.5 w-3.5" />
            {isBatchVoiceAssigning
              ? `分配中 ${batchVoiceProgress}/${voiceStats.unassigned}`
              : `批量分配音色 (${voiceStats.unassigned})`}
          </button>
        )}

        {isPolishing && (
          <button onClick={() => setIsCancelled(true)} className="text-xs text-red-400 hover:text-red-300">
            取消
          </button>
        )}
      </div>

      {/* 进度条 */}
      {isPolishing && progress.total > 0 && (
        <div className="h-1.5 bg-muted">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${(progress.done / progress.total) * 100}%` }}
          />
        </div>
      )}

      {/* 统计概览 */}
      <div className="flex items-center gap-4 px-4 py-2 border-b text-xs text-muted-foreground">
        <span>总计 {currentStats.total} 项</span>
        <span className="text-foreground">已就绪 {currentStats.ready}</span>
        <span>待润色 {currentStats.none}</span>
        {currentStats.failed > 0 && <span className="text-red-400">失败 {currentStats.failed}</span>}
        {activeType === "character" && voiceStats.total > 0 && (
          <>
            <span className="flex-1" />
            <span className="text-primary">已分配音色 {voiceStats.assigned}/{voiceStats.total}</span>
          </>
        )}
      </div>

      {/* 资产列表 */}
      <div className="flex-1 overflow-auto p-4">
        <AssetListByType
          type={activeType}
          onVoiceAssign={activeType === "character" ? (char) => setVoiceDialogChar(char) : undefined}
        />
      </div>

      {/* 音色分配弹窗 */}
      {voiceDialogChar && (
        <VoiceAssignDialog
          character={voiceDialogChar}
          open={!!voiceDialogChar}
          onOpenChange={(open) => { if (!open) setVoiceDialogChar(null); }}
        />
      )}
    </div>
  );
}

/** 按类型展示资产列表（含润色状态标签） */
function AssetListByType({ type, onVoiceAssign }: {
  type: "character" | "scene" | "prop";
  onVoiceAssign?: (char: { id: string; name: string; gender?: string; age?: string; personality?: string }) => void;
}) {
  // Hooks 必须在条件语句之前调用
  const characters = useCharacterLibraryStore((s) => s.characters);
  const scenes = useSceneStore((s) => s.scenes);
  const propsItems = usePropsLibraryStore((s) => s.items);

  if (type === "character") {
    if (characters.length === 0) return <p className="text-sm text-muted-foreground italic">暂无角色资产，请先在「剧本资产管理」中提取。</p>;
    return (
      <div className="grid gap-2">
        {characters.map((c) => (
          <div key={c.id} className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/30">
            {/* 缩略图 */}
            <div className="h-10 w-10 rounded bg-muted flex items-center justify-center overflow-hidden shrink-0">
              {c.thumbnailUrl ? (
                <img src={c.thumbnailUrl} alt={c.name} className="h-full w-full object-cover" />
              ) : (
                <Users className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
            {/* 名称 + 描述 */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">{c.name}</span>
                <StatusBadge state={c.promptState} />
              </div>
              <p className="text-xs text-muted-foreground truncate">{c.description || c.role || "无描述"}</p>
            </div>
            {/* 提示词预览 */}
            {c.visualTraits && (
              <span className="text-[10px] text-muted-foreground max-w-[200px] truncate" title={c.visualTraits}>
                {c.visualTraits.slice(0, 60)}...
              </span>
            )}
            {/* 音色状态 + 分配按钮 */}
            {onVoiceAssign && (
              <button
                onClick={() => onVoiceAssign({
                  id: c.id,
                  name: c.name,
                  gender: c.gender,
                  age: c.age,
                  personality: c.personality,
                })}
                className="flex items-center gap-1.5 px-2 py-1 rounded text-xs hover:bg-primary/10 transition-colors shrink-0"
              >
                <VoiceBadge characterId={c.id} />
                <Mic className="h-3 w-3 text-muted-foreground" />
              </button>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (type === "scene") {
    if (scenes.length === 0) return <p className="text-sm text-muted-foreground italic">暂无场景资产，请先在「剧本资产管理」中提取。</p>;
    return (
      <div className="grid gap-2">
        {scenes.map((s) => (
          <div key={s.id} className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/30">
            <div className="h-10 w-10 rounded bg-muted flex items-center justify-center overflow-hidden shrink-0">
              {s.referenceImage ? (
                <img src={s.referenceImage} alt={s.name} className="h-full w-full object-cover" />
              ) : (
                <MapPin className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">{s.name}</span>
                <StatusBadge state={s.promptState} />
              </div>
              <p className="text-xs text-muted-foreground truncate">{s.location || s.notes || "无描述"}</p>
            </div>
            {s.visualPrompt && (
              <span className="text-[10px] text-muted-foreground max-w-[200px] truncate" title={s.visualPrompt}>
                {s.visualPrompt.slice(0, 60)}...
              </span>
            )}
          </div>
        ))}
      </div>
    );
  }

  // prop
  if (propsItems.length === 0) return <p className="text-sm text-muted-foreground italic">暂无道具资产，请先在「剧本资产管理」中提取。</p>;
  return (
    <div className="grid gap-2">
      {propsItems.map((p) => (
        <div key={p.id} className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/30">
          <div className="h-10 w-10 rounded bg-muted flex items-center justify-center overflow-hidden shrink-0">
            {p.imageUrl ? (
              <img src={p.imageUrl} alt={p.name} className="h-full w-full object-cover" />
            ) : (
              <Gem className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate">{p.name}</span>
              <StatusBadge state={p.promptState} />
            </div>
            <p className="text-xs text-muted-foreground truncate">{p.description || "无描述"}</p>
          </div>
          {p.visualPrompt && (
            <span className="text-[10px] text-muted-foreground max-w-[200px] truncate" title={p.visualPrompt}>
              {p.visualPrompt.slice(0, 60)}...
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** 润色状态标签 */
function StatusBadge({ state }: { state?: string }) {
  if (!state || state === "none") return null;
  const config: Record<string, { label: string; color: string }> = {
    polishing: { label: "润色中", color: "text-blue-400" },
    ready: { label: "已就绪", color: "text-green-400" },
    failed: { label: "失败", color: "text-red-400" },
  };
  const c = config[state];
  if (!c) return null;
  return (
    <span className={`text-[10px] ${c.color}`}>
      {state === "polishing" && "● "}
      {c.label}
    </span>
  );
}

// ==================== 音色分配 Dialog ====================

/** 获取角色当前的音色绑定状态 */
function getCharacterVoiceStatus(
  characterId: string,
  bindings: Record<string, ProjectVoiceBinding>,
  voiceProfiles: Record<string, VoiceProfile>,
): { assigned: boolean; type?: "preset" | "reference"; label?: string } {
  const speakerId = `character:${characterId}` as TtsSpeakerId;
  const binding = bindings[speakerId];
  if (!binding) return { assigned: false };
  const profile = voiceProfiles[binding.profileId];
  if (!profile) return { assigned: false };
  return {
    assigned: true,
    type: profile.type,
    label: profile.type === "preset"
      ? profile.presetVoiceId ?? "预设"
      : "克隆音色",
  };
}

/** 音色状态标签 */
function VoiceBadge({ characterId }: { characterId: string }) {
  const bindings = useTtsStore((s) => {
    const pid = s.activeProjectId;
    return pid ? (s.projects[pid]?.bindings ?? {}) : {};
  });
  const voiceProfiles = useTtsStore((s) => s.voiceProfiles);
  const status = getCharacterVoiceStatus(characterId, bindings, voiceProfiles);

  if (!status.assigned) {
    return (
      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
        <Volume2 className="h-3 w-3" />
        未分配
      </span>
    );
  }

  return (
    <span className="text-[10px] text-primary flex items-center gap-1">
      <Volume2 className="h-3 w-3" />
      {status.label}
    </span>
  );
}

/** 音色分配弹窗 */
function VoiceAssignDialog({
  character,
  open,
  onOpenChange,
}: {
  character: { id: string; name: string; gender?: string; age?: string; personality?: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [mode, setMode] = useState<"preset" | "reference">("preset");
  const [selectedPreset, setSelectedPreset] = useState("");
  const [audioPath, setAudioPath] = useState("");
  const [referenceText, setReferenceText] = useState("");
  const [selectedEngine, setSelectedEngine] = useState<string>("qwen");
  const [assigning, setAssigning] = useState(false);

  const handleAssignPreset = useCallback(async () => {
    if (!selectedPreset) {
      toast.error("请选择预设音色");
      return;
    }
    setAssigning(true);
    try {
      const speakerId = `character:${character.id}` as TtsSpeakerId;
      const sink = createMystudioTtsSink();
      const profileId = sink.createVoiceProfile({
        name: `音色·${character.name}`,
        type: "preset",
        language: "zh",
        defaultEngine: "qwen_custom_voice",
        defaultModelSize: "0.6B",
        presetVoiceId: selectedPreset,
      });
      sink.bindSpeaker({
        speakerId,
        profileId,
        defaultEngine: "qwen_custom_voice",
        defaultModelSize: "0.6B",
      });
      toast.success(`${character.name} 已分配预设音色 ${selectedPreset}`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "分配失败");
    } finally {
      setAssigning(false);
    }
  }, [character, selectedPreset, onOpenChange]);

  const handleAutoAssign = useCallback(async () => {
    setAssigning(true);
    try {
      const charInput: VoiceAssignerCharacter = {
        id: character.id,
        name: character.name,
        gender: character.gender,
        age: character.age,
        personality: character.personality,
      };
      const assignment = assignVoicesForCharacters([charInput])[0];
      const sink = createMystudioTtsSink();
      syncCharacterVoices([assignment], {
        projectId: useTtsStore.getState().activeProjectId ?? "",
        sink,
      });
      toast.success(`${character.name} → ${assignment.presetVoiceId}（${assignment.reason}）`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "自动分配失败");
    } finally {
      setAssigning(false);
    }
  }, [character, onOpenChange]);

  const handleAssignReference = useCallback(async () => {
    if (!audioPath.trim()) {
      toast.error("请输入或选择音频文件路径");
      return;
    }
    setAssigning(true);
    try {
      const runtimeStatus = await getTtsRuntimeStatus();
      if (!runtimeStatus.running) {
        toast.error("TTS 后端未运行，请先在「配音」面板启动");
        setAssigning(false);
        return;
      }

      const backendProfile = await createBackendVoiceProfile({
        name: `音色·${character.name}`,
        type: "reference",
        language: "zh",
        defaultEngine: selectedEngine as TtsEngine,
        referenceAudioPath: audioPath.trim(),
        referenceText: referenceText.trim() || undefined,
      });

      const speakerId = `character:${character.id}` as TtsSpeakerId;
      const sink = createMystudioTtsSink();
      const localProfileId = sink.createVoiceProfile({
        name: `音色·${character.name}`,
        type: "reference",
        language: "zh",
        defaultEngine: selectedEngine as TtsEngine,
        defaultModelSize: "0.6B",
        referenceAudioPath: audioPath.trim(),
        referenceText: referenceText.trim() || undefined,
      });
      sink.bindSpeaker({
        speakerId,
        profileId: localProfileId,
        defaultEngine: selectedEngine as TtsEngine,
        defaultModelSize: "0.6B",
      });

      toast.success(`${character.name} 已分配克隆音色`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "分配失败");
    } finally {
      setAssigning(false);
    }
  }, [character, audioPath, referenceText, selectedEngine, onOpenChange]);

  const presetVoices = QWEN_CUSTOM_VOICES.filter((v) => v.language === "zh");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-background border border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Volume2 className="h-4 w-4" />
            分配音色 · {character.name}
          </DialogTitle>
          <DialogDescription>
            为角色选择预设音色或上传原始音频进行声音克隆
          </DialogDescription>
        </DialogHeader>

        {/* 模式切换 */}
        <div className="flex gap-1 rounded-lg bg-muted/50 p-1">
          <button
            onClick={() => setMode("preset")}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === "preset"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            预设音色
          </button>
          <button
            onClick={() => setMode("reference")}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === "reference"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            原始音频克隆
          </button>
        </div>

        {mode === "preset" && (
          <div className="space-y-3">
            {/* 自动分配 */}
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground mb-2">
                根据角色性别/年龄/性格自动匹配最佳音色
              </p>
              <button
                onClick={handleAutoAssign}
                disabled={assigning}
                className="w-full rounded-md bg-primary/15 text-primary px-3 py-1.5 text-xs font-medium hover:bg-primary/25 disabled:opacity-40 transition-colors"
              >
                {assigning ? "分配中..." : "智能匹配"}
              </button>
            </div>

            {/* 手动选择 */}
            <div className="space-y-2">
              <Label className="text-xs">或手动选择预设音色</Label>
              <div className="grid gap-1.5 max-h-48 overflow-auto">
                {presetVoices.map((voice) => (
                  <button
                    key={voice.id}
                    onClick={() => setSelectedPreset(voice.id)}
                    className={`flex items-center gap-2 rounded-md px-3 py-2 text-left text-xs transition-colors ${
                      selectedPreset === voice.id
                        ? "bg-primary/15 text-primary border border-primary/30"
                        : "border border-transparent hover:bg-muted/50"
                    }`}
                  >
                    <Volume2 className="h-3 w-3 shrink-0" />
                    <div>
                      <span className="font-medium">{voice.name}</span>
                      <span className="text-muted-foreground ml-1.5">
                        {voice.description} · {voice.gender === "female" ? "女" : "男"}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <DialogFooter>
              <Button
                onClick={handleAssignPreset}
                disabled={assigning || !selectedPreset}
                size="sm"
                className="w-full"
              >
                {assigning ? "分配中..." : "确认分配"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {mode === "reference" && (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label className="text-xs">音频文件路径</Label>
              <Input
                value={audioPath}
                onChange={(e) => setAudioPath(e.target.value)}
                placeholder="例如: /path/to/voice_sample.wav"
                className="text-xs"
              />
              <p className="text-[10px] text-muted-foreground">
                支持 WAV/MP3，建议 10-30 秒清晰语音
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">参考文本（可选）</Label>
              <Textarea
                value={referenceText}
                onChange={(e) => setReferenceText(e.target.value)}
                placeholder="音频对应的文字内容，有助于提升克隆质量"
                className="text-xs min-h-[60px]"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">克隆引擎</Label>
              <select
                value={selectedEngine}
                onChange={(e) => setSelectedEngine(e.target.value)}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
              >
                <option value="qwen">Qwen3-TTS（推荐中文）</option>
                <option value="chatterbox">Chatterbox（多语言）</option>
                <option value="tada">TADA（长音频）</option>
              </select>
            </div>

            <DialogFooter>
              <Button
                onClick={handleAssignReference}
                disabled={assigning || !audioPath.trim()}
                size="sm"
                className="w-full"
              >
                {assigning ? "分配中..." : "确认克隆分配"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
