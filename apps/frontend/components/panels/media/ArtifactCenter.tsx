// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { useMemo, useState, useCallback, useEffect } from "react";
import { ArrowUp, ChevronRight, FolderInput, FolderKanban, FolderOpen, Loader2, LucideImage as MediaLibrary, Trash2 } from "lucide-react";
import { getArtifactDeleteImpact } from "@/lib/artifacts/delete-impact";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import { useArtifactStore } from "@/stores/artifacts/artifact-store";
import {
  createArtifactDeletionPlan,
  executeArtifactDeletionPlan,
  loadArtifactInventory,
  updateArtifactMetadata,
} from "@/stores/artifacts/artifact-store";
import { useProjectStore } from "@/stores/project/project-store";
import { useMediaPanelStore } from "@/stores/navigation/media-panel-store";
import { toast } from "sonner";
import type { ArtifactRecord, ArtifactStage, ArtifactState, DeletionConfirmation } from "@/types/artifacts";
import { FIXED_NAV_STAGES, STAGE_LABELS } from "@/lib/artifacts/stage-labels";
import { sharedBucketLabel, SHARED_BUCKET_PREFIX } from "@/lib/artifacts/project-layout";
import { normalizeArtifactPhysicalPath } from "@/lib/artifacts/physical-path";
import { logEvent } from "@/lib/diagnostics/logger";
import { ArtifactTree, type ArtifactChapterTreeNode, type ArtifactFileTreeNode, type ArtifactTreeProject } from "./ArtifactTree";
import { ArtifactDetailPanel } from "./artifact-detail";
import { ArtifactDeleteDialog } from "./ArtifactDeleteDialog";
import { ChapterMigrationDialog } from "./ChapterMigrationDialog";
import { MediaView } from "./index";
import {
  buildArtifactFileTree, findFileTreeNode, fileTreeContainsArtifact, countFileTreeArtifacts,
  parentDirectory, inferChapterId, chapterIdForDeletionPlan,
  formatChapterLabel, formatBytes, formatArtifactTooltip, BACKUP_BUCKET_ID, NONE_BUCKET_ID,
  artifactBucketId, STATE_LABELS,
} from "./artifact-center-utils";

/**
 * Artifact Center Component - Main Entry Point
 *
 * Full artifact management UI with:
 * - Tab switching: Work Flow Products vs Media Library
 * - Left navigation tree + Center table + Right detail panel
 * - State subscription to artifact-store via Zustand context
 * - Mock data support for testing without IPC
 *
 * Props are pure functions - no direct IPC calls inside components
 */

export interface ArtifactCenterProps {
  /** Optional mock artifacts for testing */
  mockArtifacts?: ArtifactRecord[];

  /** Optional mock projects for tree navigation */
  mockProjects?: Array<{
    id: string;
    name: string;
    stages: Array<{
      id: string;
      label: string;
      count: number;
    }>;
    fileTree?: ArtifactFileTreeNode[];
  }>;

  /** Callback for artifact selection */
  onArtifactSelect?: (artifact: ArtifactRecord) => void;

  /** Callback when tab changes */
  onTabChange?: (tab: 'workflow' | 'media-library') => void;

  /** Custom className for root element */
  className?: string;
}

interface FilterBarProps {
  stageFilter: ArtifactStage | 'all';
  stateFilter: ArtifactState | 'all';
  onStageFilterChange: (stage: ArtifactStage | 'all') => void;
  onStateFilterChange: (state: ArtifactState | 'all') => void;
  totalArtifacts: number;
}

function FilterBar({
  stageFilter,
  stateFilter,
  onStageFilterChange,
  onStateFilterChange,
  totalArtifacts,
}: FilterBarProps) {
  return (
    <>
      <div className="text-xs text-muted-foreground whitespace-nowrap">
        共 {totalArtifacts} 个产物
      </div>

      {/* Stage filter */}
      <select
          value={stageFilter}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
          onChange={(e) => onStageFilterChange(e.target.value as any)}
          className="px-2 py-1 text-xs border rounded bg-background h-8"
        >
          <option value="all">所有阶段</option>
          {FIXED_NAV_STAGES.map((stage) => (
            <option key={stage} value={stage}>{STAGE_LABELS[stage]}</option>
          ))}
        </select>

        {/* State filter */}
        <select
          value={stateFilter}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
          onChange={(e) => onStateFilterChange(e.target.value as any)}
          className="px-2 py-1 text-xs border rounded bg-background h-8"
        >
          <option value="all">所有状态</option>
          <option value="active">活跃</option>
          <option value="archived">已归档</option>
          <option value="orphaned">孤儿</option>
          <option value="blocked">已阻塞</option>
        </select>
    </>
  );
}

// 产物表格加载骨架(镜像真实表 6 列列宽,加载→真实无 layout shift)
// 遵循 emil-design-eng:用 Skeleton 自带 animate-pulse(opacity),主线程忙时比 JS 动画流畅
function ArtifactTableSkeleton() {
  return (
    <table className="w-full text-sm" aria-hidden="true">
      <tbody>
        {Array.from({ length: 6 }).map((_, i) => (
          <tr key={i} className="border-t">
            <td className="p-2 w-10"><Skeleton className="h-4 w-4" /></td>
            <td className="p-2"><Skeleton className="h-4 w-[60%]" /></td>
            <td className="p-2 w-[110px]"><Skeleton className="h-3.5 w-16" /></td>
            <td className="p-2 w-[100px]"><Skeleton className="h-5 w-16 rounded-full" /></td>
            <td className="p-2 w-[100px]"><Skeleton className="h-3.5 w-12" /></td>
            <td className="p-2 w-[180px]"><Skeleton className="h-3.5 w-28" /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ArtifactCenter({
  mockArtifacts,
  mockProjects,
  onArtifactSelect,
  onTabChange,
  className,
}: ArtifactCenterProps) {
  // Local state for UI controls (independent of store for mocking)
  const [currentTab, setCurrentTab] = useState<'workflow' | 'media-library'>('workflow');
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  // File browsing is a project-wide view. Keep it separate from the chapter
  // filter so opening 项目 → 本地文件 cannot accidentally show only the
  // previously selected chapter's refs.
  const [fileNavigationActive, setFileNavigationActive] = useState(false);
  const [currentDirectoryPath, setCurrentDirectoryPath] = useState("");
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailArtifactId, setDetailArtifactId] = useState<string | null>(null);
  const [chapterMigrationOpen, setChapterMigrationOpen] = useState(false);

  // Stage and state filters
  const [stageFilter, setStageFilter] = useState<ArtifactStage | 'all'>('all');
  const [stateFilter, setStateFilter] = useState<ArtifactState | 'all'>('all');

  // Sort state
 
  const [sortBy] = useState<keyof ArtifactRecord>('updatedAt');
 
  const [sortOrder] = useState<'asc' | 'desc'>('desc');
  const [deletePlan, setDeletePlan] = useState<import("@/types/artifacts").DeletionPlan | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const projectList = useProjectStore((state) => state.projects);
  const setActiveTab = useMediaPanelStore((state) => state.setActiveTab);
  const requestSettingsTab = useMediaPanelStore((state) => state.requestSettingsTab);
  const enterEpisode = useMediaPanelStore((state) => state.enterEpisode);
  const startScan = useArtifactStore((state) => state.startScan);
  const finishScan = useArtifactStore((state) => state.finishScan);
  const setScanError = useArtifactStore((state) => state.setError);
  const loading = useArtifactStore((state) => state.loading);
  const refreshInventory = useCallback(async () => {
    if (!activeProjectId || mockArtifacts) return;
    startScan();
    const result = await loadArtifactInventory(activeProjectId);
    if (result.success) finishScan(result.data.artifacts);
    else setScanError(result.error);
  }, [activeProjectId, mockArtifacts, startScan, finishScan, setScanError]);

  useEffect(() => {
    void refreshInventory();
  }, [refreshInventory]);

  // Use provided mock data or fall back to store
  const storeArtifacts = useArtifactStore((state) => state.getFilteredArtifacts());
  const artifacts = mockArtifacts ?? storeArtifacts;

  // Filter and sort artifacts
  const filteredArtifacts = useMemo(() => {
    let result = [...artifacts];

    // Chapter filter. Must mirror how the left chapter column is grouped
    // (inferChapterId, with "__none__" for ungrouped), otherwise inferred-
    // chapter artifacts are counted in the column but filtered out of the
    // table. See chapters useMemo and inferChapterId.
    if (selectedChapterId && !fileNavigationActive) {
      // 与 chapters useMemo 同源(artifactBucketId),防分桶/过滤漂移
      result = result.filter(a => artifactBucketId(a) === selectedChapterId);
    }

    // Stage filter
    if (stageFilter !== 'all') {
      result = result.filter(a => a.stage === stageFilter);
    }

    // State filter
    if (stateFilter !== 'all') {
      result = result.filter(a => a.state === stateFilter);
    }

    // Sort
    result.sort((a, b) => {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      let valueA: any = a[sortBy];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      let valueB: any = b[sortBy];

      if (sortBy === 'createdAt' || sortBy === 'updatedAt') {
        valueA = new Date(valueA).getTime();
        valueB = new Date(valueB).getTime();
      } else if (typeof valueA === 'string') {
        valueA = valueA.toLowerCase();
        valueB = valueB.toLowerCase();
      }

      if (valueA < valueB) return sortOrder === 'asc' ? -1 : 1;
      if (valueA > valueB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [artifacts, fileNavigationActive, selectedChapterId, stageFilter, stateFilter, sortBy, sortOrder]);

  // Build project metadata and the physical on-disk file tree. The tree is
  // derived from the current inventory refs, never from a stale cached list.
  const projects = useMemo<ArtifactTreeProject[]>(() => {
    if (mockProjects) {
      return mockProjects.map((project) => ({
        id: project.id,
        name: project.name,
        fileTree: project.fileTree ?? buildArtifactFileTree(artifacts.filter((artifact) => artifact.projectId === project.id)),
        chapters: [],
      }));
    }

    // Aggregate artifact counts by stage, keyed by projectId.
    const stageCountByProject = new Map<string, Map<string, number>>();
    for (const artifact of artifacts) {
      if (!artifact.projectId) continue;
      if (!stageCountByProject.has(artifact.projectId)) {
        stageCountByProject.set(artifact.projectId, new Map());
      }
      const stageMap = stageCountByProject.get(artifact.projectId)!;
      stageMap.set(artifact.stage, (stageMap.get(artifact.stage) ?? 0) + 1);
    }

    // Source projects: real project list from store. Active project is always
    // shown (even with zero artifacts) so the user can tell which is open.
    const sourceProjects = projectList.length > 0
      ? projectList
      : Array.from(stageCountByProject.keys()).map(id => ({ id, name: `项目 ${id.substring(0, 8)}` }));

    return sourceProjects
      .filter(p => p.id === activeProjectId || stageCountByProject.has(p.id))
      .map(project => {
        return {
          id: project.id,
          name: project.name,
          fileTree: buildArtifactFileTree(artifacts.filter((artifact) => artifact.projectId === project.id)),
          chapters: [],
        };
      });
  }, [artifacts, mockProjects, projectList, activeProjectId]);

  // Distinct chapter list for the active project. Drives the left chapter
  // column. Each artifact is bucketed into one of three synthetic groups or a
  // real chapter:
  //   - "__backup__" (备份): artifacts whose only physical refs are backups
  //     (`.bak-*` / `.codex-*`). Historical archive copies — kept out of the
  //     chapter tree so stale ids like `episode-1` / `smoke-chapter-1` from
  //     old backups don't spawn phantom "第X章" categories.
  //   - "__none__" (杂项): no chapter inferred (special/unclassified files).
  //   - real chapter id: formatted via formatChapterLabel ("第 N 章").
  // Sort order: "杂项" first, then "备份", then real chapters ascending.
  const chapters = useMemo<ArtifactChapterTreeNode[]>(() => {
    if (!activeProjectId) return [];
    const projectArtifacts = artifacts.filter((artifact) => artifact.projectId === activeProjectId);
    const groups = new Map<string, { count: number; stageCounts: Map<ArtifactStage, number> }>();
    for (const artifact of projectArtifacts) {
      const bucket = artifactBucketId(artifact);
      const group = groups.get(bucket) ?? { count: 0, stageCounts: new Map<ArtifactStage, number>() };
      group.count += 1;
      group.stageCounts.set(artifact.stage, (group.stageCounts.get(artifact.stage) ?? 0) + 1);
      groups.set(bucket, group);
    }
    // 两段式排序:章节(升序) → 公共资源 → 杂项 → 备份(垫底)
    const bucketRank = (id: string): number =>
      id.startsWith(SHARED_BUCKET_PREFIX) ? 1
        : id === NONE_BUCKET_ID ? 2
          : id === BACKUP_BUCKET_ID ? 3
            : 0;
    return [...groups.entries()]
      .sort(([a], [b]) => {
        const ra = bucketRank(a);
        const rb = bucketRank(b);
        if (ra !== rb) return ra - rb;
        return a.localeCompare(b, undefined, { numeric: true });
      })
      .map(([id, group]) => ({
        id,
        label:
          id === NONE_BUCKET_ID
            ? "杂项"
            : id === BACKUP_BUCKET_ID
              ? "备份"
              : sharedBucketLabel(id) ?? formatChapterLabel(id),
        count: group.count,
        stages: (id.startsWith(SHARED_BUCKET_PREFIX)
          // 公共资源组展示全部出现过的 stage(project-store 不在 FIXED_NAV_STAGES)
          ? [...group.stageCounts.entries()].filter(([, count]) => count > 0).map(([stage, count]) => ({ stage, count }))
          : FIXED_NAV_STAGES.map((stage) => ({ stage, count: group.stageCounts.get(stage) ?? 0 })).filter(({ count }) => count > 0)
        ).map(({ stage, count }) => ({
          id: stage,
          label: STAGE_LABELS[stage],
          count,
        })),
      }));
  }, [artifacts, activeProjectId]);

  const treeProjects = useMemo<ArtifactTreeProject[]>(() => projects.map((project) => ({
    ...project,
    chapters: project.id === activeProjectId ? chapters : [],
  })), [projects, activeProjectId, chapters]);

  const activeProjectNode = projects.find((project) => project.id === activeProjectId) ?? null;

  const currentDirectoryNode = useMemo(
    () => findFileTreeNode(activeProjectNode?.fileTree ?? [], currentDirectoryPath),
    [activeProjectNode, currentDirectoryPath],
  );
  const directoryArtifactIds = useMemo(
    () => new Set(filteredArtifacts.map((artifact) => artifact.id)),
    [filteredArtifacts],
  );
  const visibleDirectoryFolders = useMemo(() => {
    const candidates = currentDirectoryNode?.children ?? (currentDirectoryPath ? [] : activeProjectNode?.fileTree ?? []);
    return candidates.filter((entry) => entry.type === "directory" && fileTreeContainsArtifact(entry, directoryArtifactIds));
  }, [activeProjectNode, currentDirectoryNode, currentDirectoryPath, directoryArtifactIds]);
  const visibleDirectoryArtifacts = useMemo(() => filteredArtifacts.filter((artifact) => {
    const paths = artifact.physicalRefs
      .map((ref) => normalizeArtifactPhysicalPath(ref.path, artifact.projectId))
      .filter((value): value is string => Boolean(value));
    if (paths.length === 0) return currentDirectoryPath === "";
    return paths.some((physicalPath) => parentDirectory(physicalPath) === currentDirectoryPath);
  }), [filteredArtifacts, currentDirectoryPath]);
  const directoryBreadcrumbs = useMemo(() => {
    if (!currentDirectoryPath) return [] as Array<{ label: string; path: string }>;
    const parts = currentDirectoryPath.split("/");
    return parts.map((part, index) => ({ label: part, path: parts.slice(0, index + 1).join("/") }));
  }, [currentDirectoryPath]);

  // Debug state exposure for devtools inspection
  useEffect(() => {
    if (typeof window !== 'undefined') {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).debugArtifactCenter = {
        artifacts,
        filteredArtifacts,
        currentTab,
        stageFilter,
        stateFilter,
        selectedChapterId,
        currentDirectoryPath,
        projects,
      };
    }
  }, [artifacts, filteredArtifacts, currentTab, stageFilter, stateFilter, selectedChapterId, currentDirectoryPath, projects]);

  // Pure assignment (not toggle): a chapter must always stay selected, so
  // clicking the currently-selected chapter is a no-op rather than deselect.
  const handleChapterClick = useCallback((chapterId: string) => {
    setFileNavigationActive(false);
    setSelectedChapterId(chapterId);
    setStageFilter("all");
    setCurrentDirectoryPath("");
    setDetailArtifactId(null);
  }, []);

  const handleProjectClick = useCallback((projectId: string) => {
    if (projectId !== activeProjectId) return;
    setFileNavigationActive(false);
    setSelectedChapterId(null);
    setStageFilter("all");
    setCurrentDirectoryPath("");
    setDetailArtifactId(null);
  }, [activeProjectId]);

  const handleDirectoryClick = useCallback((directoryPath: string) => {
    setFileNavigationActive(true);
    setStageFilter("all");
    setCurrentDirectoryPath(directoryPath);
    setDetailArtifactId(null);
  }, []);

  const handleFileClick = useCallback((filePath: string) => {
    setFileNavigationActive(true);
    setStageFilter("all");
    setCurrentDirectoryPath(parentDirectory(filePath));
    const artifact = artifacts.find((item) => item.physicalRefs.some((ref) => normalizeArtifactPhysicalPath(ref.path, item.projectId) === filePath));
    if (artifact) setDetailArtifactId(artifact.id);
  }, [artifacts]);

  const handleStageClick = useCallback((stageId: ArtifactStage, chapterId: string) => {
    setFileNavigationActive(false);
    setSelectedChapterId(chapterId);
    setStageFilter(stageId);
    setCurrentDirectoryPath("");
    setDetailArtifactId(null);
  }, []);

  const handleExpandToggle = useCallback((nodeId: string) => {
    setExpandedNodes((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  // Clear multiselect whenever a navigation filter changes.
  useEffect(() => {
    setSelectedIds(new Set());
    setDetailArtifactId(null);
  }, [fileNavigationActive, selectedChapterId, activeProjectId, stageFilter, stateFilter, currentDirectoryPath]);

  // Reset all navigated filters when the active project changes — covers
  // store-driven switches (setActiveProject, project deletion fallback,
  // persisted-store rehydration). Without this, a stale selectedChapterId can
  // survive a project switch and drive the "删除当前章节" IPC against the wrong
  // project (cross-project risk).
  useEffect(() => {
    setSelectedChapterId(null);
    setFileNavigationActive(false);
    setStageFilter("all");
    setCurrentDirectoryPath("");
    setExpandedNodes(new Set());
    setDetailArtifactId(null);
  }, [activeProjectId]);

  // Make the active project's local file tree and chapter nodes visible on
  // first entry. Users can still collapse any branch explicitly.
  useEffect(() => {
    if (!activeProjectId) return;
    const activeTreeProject = treeProjects.find((project) => project.id === activeProjectId);
    if (!activeTreeProject) return;
    setExpandedNodes((current) => {
      const next = new Set(current);
      next.add(`project:${activeProjectId}`);
      if (activeTreeProject.fileTree.length > 0) next.add(`files:${activeProjectId}`);
      for (const chapter of activeTreeProject.chapters) next.add(`chapter:${activeProjectId}:${chapter.id}`);
      if (next.size === current.size) return current;
      return next;
    });
  }, [activeProjectId, treeProjects]);

  // Default-select the first chapter so a chapter is always active (PRD: a
  // chapter must always be selected — the user cannot return to "no chapter").
  // Runs after the project-switch reset effect above; when selectedChapterId
  // is null and chapters exist, it picks the first non-backup node (杂项 first,
  // else the first real chapter). Backup is a passive archive bucket and is
  // only selected if it is the sole node.
  useEffect(() => {
    if (!fileNavigationActive && selectedChapterId === null && chapters.length > 0) {
      const preferred = chapters.find((c) => c.id !== BACKUP_BUCKET_ID) ?? chapters[0];
      setSelectedChapterId(preferred.id);
    }
  }, [fileNavigationActive, selectedChapterId, chapters]);

  const handleArtifactClick = useCallback((artifact: ArtifactRecord) => {
    if (onArtifactSelect) {
      onArtifactSelect(artifact);
    }
    setDetailArtifactId(artifact.id);
  }, [onArtifactSelect]);

  const getDetailArtifact = useCallback(() => {
    return artifacts.find(a => a.id === detailArtifactId) || null;
  }, [artifacts, detailArtifactId]);

  const handleOpenFolder = useCallback((directoryPath: string) => {
    // Opening a physical folder intentionally switches to the project-wide
    // file view; the folder itself is the ownership boundary, not a chapter
    // filter. The detail panel remains available for the file row.
    setFileNavigationActive(true);
    setStageFilter("all");
    setCurrentDirectoryPath(directoryPath);
    setDetailArtifactId(null);
  }, []);

  const handleOpenWorkflow = useCallback((artifact: ArtifactRecord) => {
    const route = artifact.editRoute ?? "";
    const chapterIndex = artifact.chapterId?.match(/(?:chapter|episode)[-_](\d+)/i)?.[1];
    if (route.startsWith("/script") && chapterIndex && activeProjectId) {
      enterEpisode(Number.parseInt(chapterIndex, 10), activeProjectId);
      return;
    }
    if (route.startsWith("/script")) {
      setActiveTab("script");
    } else if (route.includes("/library/characters")) {
      setActiveTab("characters");
    } else if (route.includes("/library/scenes")) {
      setActiveTab("scenes");
    } else if (route.includes("/library/props")) {
      setActiveTab("assets");
    } else if (route.startsWith("/director") || route.includes("/storyboard") || route.includes("/track") || route.includes("/video")) {
      setActiveTab("director");
    } else if (route.startsWith("/tts")) {
      // TTS 管理已并入「设置 → 本地配置」(同一个 LocalTtsPanel)
      requestSettingsTab("plugins");
      setActiveTab("settings");
    } else if (route.startsWith("/export")) {
      setActiveTab("export");
    } else if (route.startsWith("/media")) {
      setActiveTab("media");
    } else {
      setActiveTab("studio");
    }
    setDetailArtifactId(null);
  }, [activeProjectId, enterEpisode, requestSettingsTab, setActiveTab]);

  const handleCloseDetail = useCallback(() => {
    setDetailArtifactId(null);
  }, []);

  const handleMetadataUpdate = useCallback(async (
    artifactId: string,
    updates: { name?: string; notes?: string }
  ) => {
    if (!activeProjectId) {
      toast.error("没有活动项目，元数据未保存");
      return;
    }
    const result = await updateArtifactMetadata({ projectId: activeProjectId, artifactId, updates });
    if (!result.success) {
      toast.error(`元数据保存失败：${result.error}`);
      return;
    }
    await refreshInventory();
    toast.success("产物元数据已保存");
  }, [activeProjectId, refreshInventory]);

  // Delete a single file's artifact through the reviewed deletion plan.
  const openFileDelete = useCallback(async (artifact: ArtifactRecord) => {
    if (!activeProjectId) {
      toast.error("无法删除：没有活动项目");
      return;
    }
    try {
      const result = await createArtifactDeletionPlan({
        projectId: activeProjectId,
        chapterId: "",
        scope: "artifacts",
        artifactIds: [artifact.id],
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setDeletePlan(result.data);
      setDeleteLoading(false);
      setDeleteOpen(true);
    } catch (error) {
      console.error("[artifact-delete] openFileDelete threw", error);
      setDeleteLoading(false);
      toast.error(`删除操作失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [activeProjectId]);

  const openChapterDelete = useCallback(async () => {
    if (!activeProjectId || !selectedChapterId) {
      toast.error("无法删除：没有活动项目或未选择章节");
      return;
    }
    try {
      const result = await createArtifactDeletionPlan({ projectId: activeProjectId, chapterId: selectedChapterId, scope: "chapter" });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setDeletePlan(result.data);
      setDeleteLoading(false);
      setDeleteOpen(true);
    } catch (error) {
      console.error("[artifact-delete] openChapterDelete threw", error);
      setDeleteLoading(false);
      toast.error(`删除操作失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [activeProjectId, selectedChapterId]);

  const openSelectedDelete = useCallback(async () => {
    try {
      if (!activeProjectId || !selectedChapterId || selectedIds.size === 0) {
        const reason = !activeProjectId
          ? "没有活动项目"
          : !selectedChapterId
            ? "未选择章节"
            : "未选中任何产物";
        console.error("[artifact-delete] openSelectedDelete aborted: missing preconditions", {
          hasProjectId: Boolean(activeProjectId),
          selectedChapterId,
          selectedCount: selectedIds.size,
        });
        toast.error(`无法删除：${reason}`);
        return;
      }
      const selectedChapterIds = new Set(
        [...selectedIds]
          .map((id) => artifacts.find((artifact) => artifact.id === id))
          .map((artifact) => artifact ? inferChapterId(artifact) ?? NONE_BUCKET_ID : NONE_BUCKET_ID),
      );
      if (selectedChapterIds.size > 1) {
        console.error("[artifact-delete] openSelectedDelete aborted: cross-chapter selection", {
          selectedChapterIds: [...selectedChapterIds],
        });
        toast.error("批量删除必须限定在同一章节，请先取消跨章节选择");
        return;
      }
      const chapterIdForPlan = chapterIdForDeletionPlan(selectedChapterId);
      const artifactIds = Array.from(selectedIds);
      setDeleteLoading(true);
      const result = await createArtifactDeletionPlan({
        projectId: activeProjectId,
        chapterId: chapterIdForPlan,
        scope: "artifacts",
        artifactIds,
      });
      if (!result.success) {
        console.error("[artifact-delete] createArtifactDeletionPlan failed", {
          projectId: activeProjectId,
          rawChapterId: selectedChapterId,
          chapterIdForPlan,
          scope: "artifacts",
          artifactIds,
          error: result.error,
        });
        setDeleteLoading(false);
        toast.error(result.error);
        return;
      }
      void logEvent({
        category: "asset",
        level: "info",
        message: "[artifact-delete] deletion plan created, opening dialog",
        context: {
          projectId: activeProjectId,
          chapterIdForPlan,
          deleteItems: result.data.deleteItems.length,
          blockerItems: result.data.blockerItems.length,
        },
      });
      setDeletePlan(result.data);
      setDeleteLoading(false);
      setDeleteOpen(true);
    } catch (error) {
      console.error("[artifact-delete] openSelectedDelete threw", error);
      setDeleteLoading(false);
      toast.error(`删除操作失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [activeProjectId, artifacts, selectedChapterId, selectedIds]);

  const toggleArtifactSelection = useCallback((artifactId: string, checked: boolean) => {
    if (!selectedChapterId) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(artifactId);
      else next.delete(artifactId);
      return next;
    });
  }, [selectedChapterId]);

  const executePlan = useCallback(async (confirmation: DeletionConfirmation) => {
    if (!deletePlan) throw new Error("删除服务不可用");
    const result = await executeArtifactDeletionPlan(deletePlan, confirmation);
    if (!result.success) throw new Error(result.error);
    await refreshInventory();
    setDeletePlan(null);
  }, [deletePlan, refreshInventory]);

  const handleTabChange = (tab: string) => {
    setCurrentTab(tab as 'workflow' | 'media-library');
    if (tab !== "workflow") setSelectedIds(new Set());
    onTabChange?.(tab as 'workflow' | 'media-library');
  };

  return (
    <div className={cn("h-full flex flex-col bg-background", className)}>
      {chapterMigrationOpen && (
        <ChapterMigrationDialog
          projectId={activeProjectId}
          onClose={() => setChapterMigrationOpen(false)}
          onFinished={() => void refreshInventory()}
        />
      )}

      {/* Header Tabs */}
      <Tabs value={currentTab} onValueChange={handleTabChange} className="flex-1 flex flex-col min-h-0">
        <div className="p-2 border-b">
          <TabsList>
            <TabsTrigger value="workflow" className="flex items-center gap-2">
              <FolderKanban className="h-4 w-4" />
              工作流产物
            </TabsTrigger>
            <TabsTrigger value="media-library" className="flex items-center gap-2">
              <MediaLibrary className="h-4 w-4" />
              媒体库
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="workflow" className="flex-1 m-0 overflow-hidden min-h-0">
          <div className="flex h-full min-h-0">
          <ResizablePanelGroup direction="horizontal" className="flex-1 min-w-0 h-full" autoSaveId="artifact-center-left">
            {/* Left Column - project/local-file/chapter/stage tree */}
            <ResizablePanel defaultSize={22} minSize={18} maxSize={50} className="bg-panel">
              <aside className="h-full flex flex-col min-h-0">
                <div className="shrink-0 border-b px-3 h-[60px] flex items-center">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <FolderKanban className="h-4 w-4 text-primary" />
                    <span className="truncate" title={activeProjectNode?.name ?? "项目导航"}>
                      {activeProjectNode?.name ?? "项目导航"}
                    </span>
                  </div>
                </div>
                <div className="flex-1 min-h-0 overflow-hidden">
                  <ArtifactTree
                    projects={treeProjects}
                    activeProjectId={activeProjectId}
                    selectedChapterId={selectedChapterId}
                    selectedStageId={stageFilter === "all" ? null : stageFilter}
                    selectedDirectoryPath={currentDirectoryPath}
                    fileNavigationActive={fileNavigationActive}
                    onChapterClick={handleChapterClick}
                    onProjectClick={handleProjectClick}
                    onStageClick={handleStageClick}
                    onDirectoryClick={handleDirectoryClick}
                    onFileClick={handleFileClick}
                    expandedNodes={expandedNodes}
                    onExpandToggle={handleExpandToggle}
                  />
                </div>
              </aside>
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Center Table */}
            <ResizablePanel defaultSize={78} minSize={50} className="min-w-0">
              <main className="h-full flex flex-col min-w-0 min-h-0">
              <div className="flex items-center gap-2 border-b px-3 shrink-0 h-[60px]">
                <FilterBar
                  stageFilter={stageFilter}
                  stateFilter={stateFilter}
                  onStageFilterChange={setStageFilter}
                  onStateFilterChange={setStateFilter}
                  totalArtifacts={filteredArtifacts.length}
                />
                {loading && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                    扫描产物中…
                  </span>
                )}
                <div className="ml-auto flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={!activeProjectId} onClick={() => setChapterMigrationOpen(true)} title="把旧平铺分镜目录移入章节子目录,并更新全部引用">
                    <FolderInput className="mr-1 h-4 w-4" />章节整理
                  </Button>
                  <input
                    type="checkbox"
                    aria-label="选择全部产物"
                    className="h-4 w-4 shrink-0"
                    checked={visibleDirectoryArtifacts.length > 0 && visibleDirectoryArtifacts.every((artifact) => selectedIds.has(artifact.id))}
                    onChange={(event) => {
                      for (const artifact of visibleDirectoryArtifacts) toggleArtifactSelection(artifact.id, event.target.checked);
                    }}
                    onClick={(event) => event.stopPropagation()}
                  />
                  <Button variant="outline" size="sm" disabled={!selectedChapterId || selectedIds.size === 0} onClick={() => void openSelectedDelete()}>
                    <Trash2 className="mr-1 h-4 w-4" />删除选中 ({selectedIds.size})
                  </Button>
                  <Button variant="destructive" size="sm" disabled={fileNavigationActive || !selectedChapterId || selectedChapterId === NONE_BUCKET_ID || selectedChapterId === BACKUP_BUCKET_ID || selectedChapterId.startsWith(SHARED_BUCKET_PREFIX)} onClick={() => void openChapterDelete()}>
                    <Trash2 className="mr-1 h-4 w-4" />删除当前章节
                  </Button>
                </div>
              </div>
              <div className="flex-1 overflow-auto min-h-0" aria-busy={loading}>
                {loading ? (
                  <ArtifactTableSkeleton />
                ) : visibleDirectoryFolders.length === 0 && visibleDirectoryArtifacts.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-center text-muted-foreground py-12">
                    当前目录没有符合条件的产物
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-1 border-b bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                      <button
                        type="button"
                        className={cn("hover:text-foreground rounded-md", !currentDirectoryPath && "font-medium text-foreground")}
                        onClick={() => handleDirectoryClick("")}
                      >
                        {activeProjectNode?.name ?? "项目文件"}
                      </button>
                      {directoryBreadcrumbs.map((crumb) => (
                        <span key={crumb.path} className="inline-flex items-center gap-1">
                          <ChevronRight className="h-3 w-3" />
                          <button type="button" className="hover:text-foreground rounded-md" onClick={() => handleDirectoryClick(crumb.path)}>
                            {crumb.label}
                          </button>
                        </span>
                      ))}
                      {currentDirectoryPath && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="ml-auto h-6 w-6"
                          aria-label="返回上级目录"
                          onClick={() => handleDirectoryClick(parentDirectory(currentDirectoryPath))}
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  <table className="w-full table-fixed text-sm">
                    <colgroup>
                      <col className="w-10" />
                      <col />
                      <col className="w-[110px]" />
                      <col className="w-[100px]" />
                      <col className="w-[100px]" />
                      <col className="w-[180px]" />
                      <col className="w-[200px]" />
                    </colgroup>
                    <tbody>
                      {visibleDirectoryFolders.map((folder) => (
                        <tr
                          key={`folder:${folder.path}`}
                          className="cursor-pointer border-t hover:bg-muted/50 transition-colors"
                          onClick={() => handleDirectoryClick(folder.path)}
                        >
                          <td className="p-2 w-10" />
                          <td className="p-2 font-medium">
                            <span className="inline-flex items-center gap-2" title={folder.path}>
                              <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
                              <span className="truncate">{folder.name}</span>
                            </span>
                          </td>
                          <td className="p-2 w-[110px] text-xs text-muted-foreground">文件夹</td>
                          <td className="p-2 w-[100px] text-xs text-muted-foreground">可进入</td>
                          <td className="p-2 w-[100px] font-mono text-xs">{formatBytes(folder.bytes)}</td>
                          <td className="p-2 text-muted-foreground text-xs w-[180px]">{countFileTreeArtifacts(folder)} 项</td>
                        </tr>
                      ))}
                      {visibleDirectoryArtifacts.map((artifact) => (
                            <tr
                              key={artifact.id}
                              title={formatArtifactTooltip(artifact)}
                              onClick={() => handleArtifactClick(artifact)}
                              className={cn(
                                "cursor-pointer border-t hover:bg-muted/50 transition-colors",
                                selectedIds.has(artifact.id) && "bg-muted/50"
                              )}
                            >
                              <td className="p-2 w-10" onClick={(event) => event.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  aria-label={`选择产物 ${artifact.name}`}
                                  checked={selectedIds.has(artifact.id)}
                                  disabled={!selectedChapterId || (selectedChapterId !== "__none__" && selectedChapterId !== "__backup__" && inferChapterId(artifact) !== selectedChapterId)}
                                  onChange={(event) => toggleArtifactSelection(artifact.id, event.target.checked)}
                                />
                              </td>
                              <td className="p-2 font-medium">
                                <span className="block truncate" title={artifact.name}>{artifact.name}</span>
                              </td>
                              <td className="p-2 w-[110px]">
                                {(() => {
                                  const impact = getArtifactDeleteImpact(artifact);
                                  const Icon = impact.icon;
                                  return (
                                    <span
                                      className={cn("inline-flex items-center gap-1 text-xs", impact.className)}
                                      title={impact.hint}
                                    >
                                      <Icon className="h-3.5 w-3.5" />
                                      {impact.label}
                                    </span>
                                  );
                                })()}
                              </td>
                              <td className="p-2 w-[100px]">
                                <span className={cn(
                                  "text-xs px-2 py-1 rounded capitalize",
                                  artifact.state === 'active' && "bg-success/20 text-success",
                                  artifact.state === 'blocked' && "bg-destructive/20 text-destructive",
                                  artifact.state === 'orphaned' && "bg-warning/20 text-warning"
                                )}>
                                  {STATE_LABELS[artifact.state] || artifact.state}
                                </span>
                              </td>
                              <td className="p-2 font-mono text-xs w-[100px]">
                                {formatBytes(artifact.bytes)}
                              </td>
                              <td className="p-2 text-muted-foreground text-xs w-[180px]">
                                <span className="flex items-center justify-between gap-2">
                                  <span>{new Date(artifact.updatedAt).toLocaleString('zh-CN')}</span>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                    aria-label={`删除产物 ${artifact.name}`}
                                    title="生成永久删除计划"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void openFileDelete(artifact);
                                    }}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </span>
                              </td>
                            </tr>
                      ))}
                    </tbody>
                  </table>
                  </>
                )}
              </div>
            </main>
            </ResizablePanel>
          </ResizablePanelGroup>

            {/* Detail panel: ArtifactDetailPanel is a Radix Dialog (centered
                modal) rendered through a portal, so it does not reserve layout
                width. Keeping it outside the resizable panels avoids squeezing
                the artifact table when a row is selected. */}
            {getDetailArtifact() && (
              <ArtifactDetailPanel
                artifact={getDetailArtifact()}
                isOpen={!!getDetailArtifact()}
                onClose={handleCloseDetail}
                onMetadataUpdate={handleMetadataUpdate}
                onOpenFolder={handleOpenFolder}
                onOpenWorkflow={handleOpenWorkflow}
              />
            )}
          </div>
        </TabsContent>

        <TabsContent value="media-library" className="flex-1 m-0 overflow-hidden">
          <MediaView />
        </TabsContent>
      </Tabs>
      <ArtifactDeleteDialog isOpen={deleteOpen} plan={deletePlan} loading={deleteLoading} onClose={() => { setDeleteOpen(false); setDeletePlan(null); }} onExecute={executePlan} />
    </div>
  );
}


export default ArtifactCenter;
