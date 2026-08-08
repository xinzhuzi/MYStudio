// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { useMemo, useState, useCallback, useEffect } from "react";
import { ArrowUp, ChevronRight, FolderOpen, FolderKanban, Loader2, LucideImage as MediaLibrary, Trash2 } from "lucide-react";
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
import { toast } from "sonner";
import type { ArtifactRecord, ArtifactStage, ArtifactState, DeletionConfirmation } from "@/types/artifacts";
import { FIXED_NAV_STAGES, STAGE_LABELS } from "@/lib/artifacts/stage-labels";
import { ChapterTree, type ChapterNode } from "./ChapterTree";
import { ArtifactDetailPanel } from "./artifact-detail";
import { ArtifactDeleteDialog } from "./ArtifactDeleteDialog";
import { MediaView } from "./index";

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
    fileTree?: FileTreeNode[];
  }>;

  /** Callback for artifact selection */
  onArtifactSelect?: (artifact: ArtifactRecord) => void;

  /** Callback when tab changes */
  onTabChange?: (tab: 'workflow' | 'media-library') => void;

  /** Custom className for root element */
  className?: string;
}

/**
 * File-tree node shape for a project's on-disk artifact file tree. Migrated
 * from the (removed) ArtifactTree component — ArtifactCenter now owns this
 * type since it is the sole consumer. See task #19.
 */
export interface FileTreeNode {
  path: string;
  name: string;
  type: "directory" | "file";
  children?: FileTreeNode[];
  artifactIds?: string[];
  bytes?: number;
}

type ArtifactProjectNode = {
  id: string;
  name: string;
  stages: Array<{ id: string; label: string; count: number }>;
  fileTree: FileTreeNode[];
};

function normalizePhysicalPath(value: string): string | null {
  if (!value || value.includes("://")) return null;
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
  return normalized && normalized !== "." ? normalized : null;
}

// Match the real chapter-directory naming on disk: exports/chapter-001,
// workflow-images/storyboards/chapter-001, continuity-bibles/chapter-001, and
// the fixture variants chapter-1 / chapter-mixed. Case-insensitive so a
// WindowsCapitalized "Chapter-001" still resolves. This is an INVERSE
// extraction (build a chapter list FROM artifacts); it is NOT the forward
// match at artifact-inventory-service.ts:825 (known chapterId → artifacts).
const CHAPTER_PATH_PATTERN = /chapter-[0-9a-z]+/i;

/**
 * Resolve a chapter id for an artifact. Prefer the explicit top-level
 * `chapterId` field persisted by the inventory service; when absent, infer
 * from the first physicalRef path segment that matches the chapter pattern.
 * Returns null when neither yields a chapter (the "杂项" bucket).
 */
function inferChapterId(artifact: ArtifactRecord): string | null {
  if (artifact.chapterId) return artifact.chapterId;
  for (const ref of artifact.physicalRefs) {
    const physicalPath = normalizePhysicalPath(ref.path);
    if (!physicalPath) continue;
    const match = physicalPath.match(CHAPTER_PATH_PATTERN);
    if (match) return match[0];
  }
  return null;
}

/**
 * Synthetic bucket ids (kept distinct from any real chapter id shape so they
 * can never collide with `chapter-NNN` / `episode-N` values from the data).
 */
const BACKUP_BUCKET_ID = "__backup__";
const NONE_BUCKET_ID = "__none__";

/**
 * An artifact whose ONLY physical presence is inside backup files
 * (`.bak-*` / `.codex-*`). The inventory service marks backup-sourced refs
 * with `type: "backup"` (artifact-inventory-service.ts:115). When every ref
 * is a backup ref, the artifact is a historical archive copy — it has no live
 * project-file footprint and should not pollute the chapter tree. An artifact
 * that also has a `project-file`/`remotion`/`exports` ref is a live artifact
 * that merely also appears in backups, so it stays in its chapter.
 */
function isBackupOnlyArtifact(artifact: ArtifactRecord): boolean {
  if (artifact.physicalRefs.length === 0) return false;
  return artifact.physicalRefs.every((ref) => ref.type === "backup");
}

/**
 * Human-readable chapter label from a raw chapter id. Extracts the first
 * digit group and drops the `chapter-` prefix / leading zeros, so
 * `chapter-001` / `chapter-1` both render as "第 1 章". Falls back to the raw
 * id when no digits are present (rare, e.g. a slug-only id).
 */
function formatChapterLabel(id: string): string {
  const digitMatch = id.match(/(\d+)/);
  if (digitMatch) {
    const num = parseInt(digitMatch[1], 10);
    return `第 ${num} 章`;
  }
  return `第 ${id} 章`;
}

function buildArtifactFileTree(artifacts: ArtifactRecord[]): FileTreeNode[] {
  type MutableNode = FileTreeNode & { childMap: Map<string, MutableNode> };
  const roots = new Map<string, MutableNode>();

  for (const artifact of artifacts) {
    for (const ref of artifact.physicalRefs) {
      const physicalPath = normalizePhysicalPath(ref.path);
      if (!physicalPath) continue;
      const parts = physicalPath.split("/").filter(Boolean);
      let map = roots;
      let currentPath = "";
      parts.forEach((part, index) => {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        const isFile = index === parts.length - 1;
        let node = map.get(part);
        if (!node) {
          node = {
            path: currentPath,
            name: part,
            type: isFile ? "file" : "directory",
            children: [],
            artifactIds: [],
            bytes: 0,
            childMap: new Map(),
          };
          map.set(part, node);
        }
        if (isFile) {
          if (!node.artifactIds?.includes(artifact.id)) node.artifactIds?.push(artifact.id);
          node.bytes = (node.bytes ?? 0) + (ref.bytes ?? artifact.bytes ?? 0);
        }
        map = node.childMap;
      });
    }
  }

  const finalize = (nodes: Map<string, MutableNode>): FileTreeNode[] => [...nodes.values()]
    .sort((left, right) => left.type === right.type ? left.name.localeCompare(right.name) : left.type === "directory" ? -1 : 1)
    .map((node) => {
      const children = node.type === "directory" ? finalize(node.childMap) : undefined;
      return {
        path: node.path,
        name: node.name,
        type: node.type,
        artifactIds: node.artifactIds,
        bytes: node.type === "directory"
          ? children?.reduce((total, child) => total + (child.bytes ?? 0), node.bytes ?? 0)
          : node.bytes,
        children,
      };
    });

  return finalize(roots);
}

function findFileTreeNode(nodes: FileTreeNode[], directoryPath: string): FileTreeNode | null {
  if (!directoryPath) return null;
  for (const node of nodes) {
    if (node.path === directoryPath) return node;
    const nested = node.children ? findFileTreeNode(node.children, directoryPath) : null;
    if (nested) return nested;
  }
  return null;
}

function fileTreeContainsArtifact(node: FileTreeNode, artifactIds: Set<string>): boolean {
  if (node.artifactIds?.some((id) => artifactIds.has(id))) return true;
  return node.children?.some((child) => fileTreeContainsArtifact(child, artifactIds)) ?? false;
}

function collectFileTreeArtifactIds(node: FileTreeNode): string[] {
  return [
    ...(node.artifactIds ?? []),
    ...(node.children ?? []).flatMap((child) => collectFileTreeArtifactIds(child)),
  ];
}

function countFileTreeArtifacts(node: FileTreeNode): number {
  return new Set(collectFileTreeArtifactIds(node)).size;
}

function parentDirectory(directoryPath: string): string {
  const slash = directoryPath.lastIndexOf("/");
  return slash === -1 ? "" : directoryPath.slice(0, slash);
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
    <div className="flex items-center justify-between p-3 bg-panel">
      <div className="text-sm text-muted-foreground">
        共 {totalArtifacts} 个产物
      </div>

      <div className="flex items-center gap-2">
        {/* Stage filter */}
        <select
          value={stageFilter}
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
          onChange={(e) => onStateFilterChange(e.target.value as any)}
          className="px-2 py-1 text-xs border rounded bg-background h-8"
        >
          <option value="all">所有状态</option>
          <option value="active">活跃</option>
          <option value="archived">已归档</option>
          <option value="orphaned">孤儿</option>
          <option value="blocked">已阻塞</option>
        </select>
      </div>
    </div>
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
  const [currentDirectoryPath, setCurrentDirectoryPath] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailArtifactId, setDetailArtifactId] = useState<string | null>(null);

  // Stage and state filters
  const [stageFilter, setStageFilter] = useState<ArtifactStage | 'all'>('all');
  const [stateFilter, setStateFilter] = useState<ArtifactState | 'all'>('all');

  // Sort state
  const [sortBy, setSortBy] = useState<keyof ArtifactRecord>('updatedAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [deletePlan, setDeletePlan] = useState<import("@/types/artifacts").DeletionPlan | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const projectList = useProjectStore((state) => state.projects);
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
    console.log("[ArtifactCenter] Starting inventory refresh...");
    void refreshInventory();
  }, [refreshInventory]);

  // Use provided mock data or fall back to store
  const storeArtifacts = useArtifactStore((state) => state.getFilteredArtifacts());
  const artifacts = mockArtifacts ?? storeArtifacts;

  // Filter and sort artifacts
  const filteredArtifacts = useMemo(() => {
    console.log("[ArtifactCenter] Computing filtered artifacts...");
    console.log("  - Source artifacts count:", artifacts.length);
    console.log("  - Selected chapter:", selectedChapterId);
    console.log("  - Stage filter:", stageFilter);
    console.log("  - State filter:", stateFilter);

    let result = [...artifacts];

    // Chapter filter. Must mirror how the left chapter column is grouped
    // (inferChapterId, with "__none__" for ungrouped), otherwise inferred-
    // chapter artifacts are counted in the column but filtered out of the
    // table. See chapters useMemo and inferChapterId.
    if (selectedChapterId) {
      if (selectedChapterId === NONE_BUCKET_ID) {
        // 杂项: non-backup artifacts with no inferred chapter.
        result = result.filter(a => !isBackupOnlyArtifact(a) && inferChapterId(a) === null);
      } else if (selectedChapterId === BACKUP_BUCKET_ID) {
        // 备份: backup-only artifacts.
        result = result.filter(a => isBackupOnlyArtifact(a));
      } else {
        // Real chapter: non-backup artifacts whose inferred chapter matches.
        // Must mirror the chapters useMemo bucketing so backup-only artifacts
        // (which may carry the same chapterId from a backup file) are excluded.
        result = result.filter(a => !isBackupOnlyArtifact(a) && inferChapterId(a) === selectedChapterId);
      }
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
      let valueA: any = a[sortBy];
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

    console.log("  - Filtered result:", result.length, "artifacts");
    return result;
  }, [artifacts, selectedChapterId, stageFilter, stateFilter, sortBy, sortOrder]);

  // Build project → stage folder tree.
  // Project names come from project-store (real names); stage counts aggregate
  // current inventory artifacts by stage. Stage order follows STAGE_LABELS.
  const projects = useMemo<ArtifactProjectNode[]>(() => {
    if (mockProjects) {
      return mockProjects.map((project) => ({ ...project, fileTree: project.fileTree ?? [] }));
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

    // Per-project stage breakdown over the FIXED stage set (FIXED_NAV_STAGES).
    // The middle "工作流阶段" column was removed; stage filtering now lives in
    // the FilterBar toolbar dropdown (also FIXED_NAV_STAGES). This `stages`
    // field remains part of the ArtifactProjectNode / mockProjects prop
    // contract. Every fixed stage always renders regardless of count
    // (zero-count stages show with no badge).
    const fixedStageEntries = FIXED_NAV_STAGES.map(stageId => [stageId, STAGE_LABELS[stageId]] as const);

    return sourceProjects
      .filter(p => p.id === activeProjectId || stageCountByProject.has(p.id))
      .map(project => {
        const stageMap = stageCountByProject.get(project.id) ?? new Map<string, number>();
        const stages = fixedStageEntries
          .map(([stageId, label]) => ({
            id: stageId,
            label,
            count: stageMap.get(stageId) ?? 0,
          }));
        return {
          id: project.id,
          name: project.name,
          stages,
          fileTree: buildArtifactFileTree(artifacts.filter((artifact) => artifact.projectId === project.id)),
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
  const chapters = useMemo<ChapterNode[]>(() => {
    if (!activeProjectId) return [];
    const projectArtifacts = artifacts.filter((artifact) => artifact.projectId === activeProjectId);
    const counts = new Map<string, number>();
    for (const artifact of projectArtifacts) {
      const bucket = isBackupOnlyArtifact(artifact)
        ? BACKUP_BUCKET_ID
        : inferChapterId(artifact) ?? NONE_BUCKET_ID;
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    }
    const bucketRank = (id: string): number =>
      id === NONE_BUCKET_ID ? 0 : id === BACKUP_BUCKET_ID ? 1 : 2;
    return [...counts.entries()]
      .sort(([a], [b]) => {
        const ra = bucketRank(a);
        const rb = bucketRank(b);
        if (ra !== rb) return ra - rb;
        return a.localeCompare(b, undefined, { numeric: true });
      })
      .map(([id, count]) => ({
        id,
        label:
          id === NONE_BUCKET_ID
            ? "杂项"
            : id === BACKUP_BUCKET_ID
              ? "备份"
              : formatChapterLabel(id),
        count,
      }));
  }, [artifacts, activeProjectId]);

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
    return candidates.filter((entry) => entry.type === "directory");
  }, [activeProjectNode, currentDirectoryNode, currentDirectoryPath, directoryArtifactIds]);
  const visibleDirectoryArtifacts = useMemo(() => filteredArtifacts.filter((artifact) => {
    const paths = artifact.physicalRefs
      .map((ref) => normalizePhysicalPath(ref.path))
      .filter((value): value is string => Boolean(value));
    if (paths.length === 0) return currentDirectoryPath === "";
    return paths.some((physicalPath) => parentDirectory(physicalPath) === currentDirectoryPath);
  }), [filteredArtifacts, currentDirectoryPath]);

  // Flat grouping by stage — replaces the folder-navigation view. All artifacts
  // are flattened out of their physical directory tree and grouped under their
  // 13 ArtifactStage in STAGE_LABELS order; empty stages still render (count 0)
  // so every workflow stage is visible as a classification group.
  const artifactsByStage = useMemo(() => {
    const buckets = new Map<ArtifactStage, ArtifactRecord[]>();
    for (const stage of FIXED_NAV_STAGES) buckets.set(stage, []);
    for (const artifact of filteredArtifacts) {
      const bucket = buckets.get(artifact.stage);
      if (bucket) bucket.push(artifact);
    }
    return FIXED_NAV_STAGES.map((stage) => ({
      stage,
      label: STAGE_LABELS[stage],
      artifacts: buckets.get(stage) ?? [],
    }));
  }, [filteredArtifacts]);

  // When a specific stage is selected in the toolbar dropdown, only that stage
  // group is relevant — rendering the other 12 (empty) stage headers is noise.
  // "所有阶段" keeps the full 13-group breakdown.
  const visibleStageGroups = useMemo(() => {
    if (stageFilter === "all") return artifactsByStage;
    return artifactsByStage.filter((group) => group.stage === stageFilter);
  }, [artifactsByStage, stageFilter]);
  // Flat artifact list for the file-only view — no per-stage section headers.
  // "展示文件列表，就只管展示文件列表"：不再按阶段分组，所有文件平铺为单一列表。
  const flatArtifactList = useMemo(
    () => visibleStageGroups.flatMap((group) => group.artifacts),
    [visibleStageGroups],
  );
  const directoryBreadcrumbs = useMemo(() => {
    if (!currentDirectoryPath) return [] as Array<{ label: string; path: string }>;
    const parts = currentDirectoryPath.split("/");
    return parts.map((part, index) => ({ label: part, path: parts.slice(0, index + 1).join("/") }));
  }, [currentDirectoryPath]);

  // Debug state exposure for devtools inspection
  useEffect(() => {
    if (typeof window !== 'undefined') {
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
    setSelectedChapterId(chapterId);
  }, []);

  const handleDirectoryClick = useCallback((directoryPath: string) => {
    setCurrentDirectoryPath(directoryPath);
    setDetailArtifactId(null);
  }, []);

  // Clear multiselect whenever a navigation filter changes.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [selectedChapterId, activeProjectId, currentDirectoryPath, stageFilter]);

  // Reset all navigated filters when the active project changes — covers
  // store-driven switches (setActiveProject, project deletion fallback,
  // persisted-store rehydration). Without this, a stale selectedChapterId can
  // survive a project switch and drive the "删除当前章节" IPC against the wrong
  // project (cross-project risk).
  useEffect(() => {
    setSelectedChapterId(null);
    setStageFilter("all");
    setCurrentDirectoryPath("");
    setDetailArtifactId(null);
  }, [activeProjectId]);

  // Default-select the first chapter so a chapter is always active (PRD: a
  // chapter must always be selected — the user cannot return to "no chapter").
  // Runs after the project-switch reset effect above; when selectedChapterId
  // is null and chapters exist, it picks the first non-backup node (杂项 first,
  // else the first real chapter). Backup is a passive archive bucket and is
  // only selected if it is the sole node.
  useEffect(() => {
    if (selectedChapterId === null && chapters.length > 0) {
      const preferred = chapters.find((c) => c.id !== BACKUP_BUCKET_ID) ?? chapters[0];
      setSelectedChapterId(preferred.id);
    }
  }, [selectedChapterId, chapters]);

  const handleArtifactClick = useCallback((artifact: ArtifactRecord) => {
    if (onArtifactSelect) {
      onArtifactSelect(artifact);
    }
    setDetailArtifactId(artifact.id);
  }, [onArtifactSelect]);

  const getDetailArtifact = useCallback(() => {
    return artifacts.find(a => a.id === detailArtifactId) || null;
  }, [artifacts, detailArtifactId]);

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

  // Delete a folder and ALL artifacts inside it (cascade through the subtree).
  // The file tree is aggregated from artifact physicalRefs, so a folder maps to
  // the full set of artifactIds under it via collectFileTreeArtifactIds. Files
  // are physically moved to the system Trash (shell.trashItem) by the backend,
  // not permanently deleted — recoverable from Finder/Recycle Bin.
  const openDirectoryDelete = useCallback(async (folder: FileTreeNode) => {
    if (!activeProjectId) return;
    const cascadeIds = [...new Set(collectFileTreeArtifactIds(folder))];
    if (cascadeIds.length === 0) {
      toast.error("该文件夹没有可删除的产物");
      return;
    }
    const result = await createArtifactDeletionPlan({
      projectId: activeProjectId,
      chapterId: "",
      scope: "artifacts",
      artifactIds: cascadeIds,
    });
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setDeletePlan(result.data);
    setDeleteOpen(true);
  }, [activeProjectId]);

  // Delete a single file's artifact (move physical file to Trash via backend).
  const openFileDelete = useCallback(async (artifact: ArtifactRecord) => {
    if (!activeProjectId) return;
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
    setDeleteOpen(true);
  }, [activeProjectId]);

  const openChapterDelete = useCallback(async () => {
    if (!activeProjectId || !selectedChapterId) return;
    const result = await createArtifactDeletionPlan({ projectId: activeProjectId, chapterId: selectedChapterId, scope: "chapter" });
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setDeletePlan(result.data);
    setDeleteOpen(true);
  }, [activeProjectId, selectedChapterId]);

  const openSelectedDelete = useCallback(async () => {
    if (!activeProjectId || !selectedChapterId || selectedIds.size === 0) return;
    // "__none__" is the UI-only synthetic bucket for ungrouped/project-level
    // artifacts (ChapterTree.tsx). It is NOT a real chapter id — passing it as
    // chapterId makes buildDeletionPlan reject the plan ("outside chapter
    // __none__"). For artifacts-scope deletion the store/IPC both accept an
    // empty chapterId (cross-chapter selection; see artifact-management-ipc.ts
    // L331-336), so strip the synthetic sentinel here.
    const chapterIdForPlan = selectedChapterId === "__none__" ? "" : selectedChapterId;
    const result = await createArtifactDeletionPlan({
      projectId: activeProjectId,
      chapterId: chapterIdForPlan,
      scope: "artifacts",
      artifactIds: Array.from(selectedIds),
    });
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setDeletePlan(result.data);
    setDeleteOpen(true);
  }, [activeProjectId, selectedChapterId, selectedIds]);

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
    console.log("[ArtifactCenter] Tab changed:", tab);
    setCurrentTab(tab as 'workflow' | 'media-library');
    if (tab !== "workflow") setSelectedIds(new Set());
    onTabChange?.(tab as 'workflow' | 'media-library');
  };

  return (
    <div className={cn("h-full flex flex-col bg-background", className)}>
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
              可交付物
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="workflow" className="flex-1 m-0 overflow-hidden min-h-0">
          <div className="flex h-full min-h-0">
          <ResizablePanelGroup direction="horizontal" className="flex-1 min-w-0 h-full" autoSaveId="artifact-center-left">
            {/* Left Column - Chapter Tree (PRD R1: 项目→章节→工作流阶段→产物) */}
            <ResizablePanel defaultSize={22} minSize={18} maxSize={50} className="bg-panel">
              <aside className="h-full flex flex-col min-h-0">
                <div className="flex-1 min-h-0 overflow-hidden">
                  <ChapterTree
                    chapters={chapters}
                    selectedChapterId={selectedChapterId}
                    onChapterClick={handleChapterClick}
                  />
                </div>
              </aside>
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Center Table */}
            <ResizablePanel defaultSize={78} minSize={50} className="min-w-0">
              <main className="h-full flex flex-col min-w-0 min-h-0">
              <div className="flex items-center justify-between border-b px-3 py-2 shrink-0">
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
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    aria-label="选择全部产物"
                    className="ml-auto"
                    checked={flatArtifactList.length > 0 && flatArtifactList.every((artifact) => selectedIds.has(artifact.id))}
                    onChange={(event) => {
                      for (const artifact of flatArtifactList) toggleArtifactSelection(artifact.id, event.target.checked);
                    }}
                    onClick={(event) => event.stopPropagation()}
                  />
                  <Button variant="outline" size="sm" disabled={!selectedChapterId || selectedIds.size === 0} onClick={() => void openSelectedDelete()}>
                    <Trash2 className="mr-1 h-4 w-4" />删除选中 ({selectedIds.size})
                  </Button>
                  <Button variant="destructive" size="sm" disabled={!selectedChapterId || selectedChapterId === "__none__"} onClick={() => void openChapterDelete()}>
                    <Trash2 className="mr-1 h-4 w-4" />删除当前章节
                  </Button>
                </div>
              </div>
              <div className="flex-1 overflow-auto min-h-0" aria-busy={loading}>
                {loading ? (
                  <ArtifactTableSkeleton />
                ) : filteredArtifacts.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-center text-muted-foreground py-12">
                    当前章节没有符合条件的产物
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <tbody>
                      {flatArtifactList.map((artifact) => (
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
                                  disabled={!selectedChapterId || (selectedChapterId !== "__none__" && artifact.chapterId !== selectedChapterId)}
                                  onChange={(event) => toggleArtifactSelection(artifact.id, event.target.checked)}
                                />
                              </td>
                              <td className="p-2 font-medium">{artifact.name}</td>
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
                                  artifact.state === 'active' && "bg-green-600/20 text-green-600",
                                  artifact.state === 'blocked' && "bg-red-600/20 text-red-600",
                                  artifact.state === 'orphaned' && "bg-orange-600/20 text-orange-600"
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
                                    title="移动到废纸篓"
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
                )}
              </div>
            </main>
            </ResizablePanel>
          </ResizablePanelGroup>

            {/* Right Detail Panel */}
            {getDetailArtifact() && (
              <aside className="w-80 border-l bg-panel overflow-y-auto">
                <ArtifactDetailPanel
                  artifact={getDetailArtifact()}
                  isOpen={!!getDetailArtifact()}
                  onClose={handleCloseDetail}
                  onMetadataUpdate={handleMetadataUpdate}
                />
              </aside>
            )}
          </div>
        </TabsContent>

        <TabsContent value="media-library" className="flex-1 m-0 overflow-hidden">
          <MediaView />
        </TabsContent>
      </Tabs>
      <ArtifactDeleteDialog isOpen={deleteOpen} plan={deletePlan} onClose={() => { setDeleteOpen(false); setDeletePlan(null); }} onExecute={executePlan} />
    </div>
  );
}


const formatBytes = (bytes?: number): string => {
  if (!bytes) return "-";
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

const STATE_LABELS: Record<ArtifactState, string> = {
  "active": "活跃",
  "archived": "已归档",
  "orphaned": "孤儿",
  "blocked": "已阻塞",
  "unknown": "未知",
};

/**
 * 构造产物行的详细 tooltip 文本,鼠标悬停时显示完整信息。
 * 表格列空间有限(名称/阶段/状态/大小/更新时间),tooltip 补齐:
 * 创建时间、章节、类型、上下游依赖数量、标签与备注等。
 */
const formatArtifactTooltip = (artifact: ArtifactRecord): string => {
  const stageLabel = STAGE_LABELS[artifact.stage] || artifact.stage;
  const stateLabel = STATE_LABELS[artifact.state] || artifact.state;
  const updated = new Date(artifact.updatedAt).toLocaleString('zh-CN');
  const created = new Date(artifact.createdAt).toLocaleString('zh-CN');
  const chapter = artifact.chapterId
    ? formatChapterLabel(artifact.chapterId)
    : '根目录';
  const tags = artifact.metadata?.tags?.length
    ? artifact.metadata.tags.join('、')
    : '无';
  const notes = artifact.metadata?.notes?.trim() || '无';
  const lines = [
    `名称:${artifact.name}`,
    `类型:${artifact.kind}`,
    `阶段:${stageLabel}`,
    `状态:${stateLabel}`,
    `章节:${chapter}`,
    `大小:${formatBytes(artifact.bytes)}`,
    `更新:${updated}`,
    `创建:${created}`,
    `上游依赖:${artifact.upstreamIds.length}  下游引用:${artifact.downstreamIds.length}`,
  ];
  if (artifact.retainedReason) lines.push(`保留原因:${artifact.retainedReason}`);
  if (artifact.blockerReason) lines.push(`阻塞原因:${artifact.blockerReason}`);
  lines.push(`标签:${tags}`);
  lines.push(`备注:${notes}`);
  return lines.join('\n');
};

export default ArtifactCenter;
