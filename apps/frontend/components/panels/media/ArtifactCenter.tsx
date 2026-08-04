// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { useMemo, useState, useCallback, useEffect } from "react";
import { FolderKanban, LucideImage as MediaLibrary, Trash2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useArtifactStore } from "@/stores/artifacts/artifact-store";
import { createArtifactDeletionPlan, loadArtifactInventory, updateArtifactMetadata } from "@/stores/artifacts/artifact-store";
import { useProjectStore } from "@/stores/project/project-store";
import { toast } from "sonner";
import type { ArtifactRecord, ArtifactStage, ArtifactState } from "@/types/artifacts";
import { ArtifactTree } from "./ArtifactTree";
import { ArtifactDetailPanel } from "./ArtifactDetailPanel";
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
    chapters: Array<{
      id: string;
      title: string;
      stageCounts: Record<string, number>;
    }>;
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
  const STAGE_LABELS: Record<ArtifactStage, string> = {
    "novel": "小说导入",
    "analysis": "内容分析",
    "script": "剧本生成",
    "assets": "素材准备",
    "storyboard": "分镜设计",
    "image": "图像生成",
    "voice": "语音合成",
    "production": "视频生产",
    "editing": "剪辑编辑",
    "remotion": "Remotion 编排",
    "export": "导出输出",
    "backup": "备份归档",
    "media-library": "媒体库",
  };

  return (
    <div className="flex items-center justify-between p-3 border-b bg-panel">
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
          {Object.entries(STAGE_LABELS).map(([stage, label]) => (
            <option key={stage} value={stage}>{label}</option>
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
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(['proj-root']));
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
  const startScan = useArtifactStore((state) => state.startScan);
  const finishScan = useArtifactStore((state) => state.finishScan);
  const setScanError = useArtifactStore((state) => state.setError);
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

    // Chapter filter
    if (selectedChapterId) {
      result = result.filter(a => a.chapterId === selectedChapterId);
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

  // Get mock projects or generate from artifacts
  const projects = useMemo(() => {
    if (mockProjects) return mockProjects;

    // Generate simple project structure from artifacts
    const projectMap = new Map<string, {
      id: string;
      name: string;
      chapters: Map<string, {
        id: string;
        title: string;
        stageCounts: Record<string, number>;
      }>;
    }>();

    for (const artifact of artifacts) {
      if (!artifact.projectId) continue;

      if (!projectMap.has(artifact.projectId)) {
        projectMap.set(artifact.projectId, {
          id: artifact.projectId,
          name: `项目 ${artifact.projectId.substring(0, 8)}`,
          chapters: new Map(),
        });
      }

      const project = projectMap.get(artifact.projectId)!;
      const chapterId = artifact.chapterId || 'root';

      if (!project.chapters.has(chapterId)) {
        project.chapters.set(chapterId, {
          id: chapterId,
          title: chapterId === 'root' ? '根目录' : `第${chapterId.substring(0, 4)}章`,
          stageCounts: {},
        });
      }

      const chapter = project.chapters.get(chapterId)!;
      if (!chapter.stageCounts[artifact.stage]) {
        chapter.stageCounts[artifact.stage] = 0;
      }
      chapter.stageCounts[artifact.stage]++;
    }

    return Array.from(projectMap.values()).map(project => ({
      ...project,
      chapters: Array.from(project.chapters.values()),
    }));
  }, [artifacts, mockProjects]);

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
        projects,
      };
    }
  }, [artifacts, filteredArtifacts, currentTab, stageFilter, stateFilter, selectedChapterId, projects]);

  const handleChapterClick = useCallback((chapterId: string) => {
    setSelectedChapterId(chapterId === selectedChapterId ? null : chapterId);
  }, [selectedChapterId]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [selectedChapterId, activeProjectId]);

  const handleExpandToggle = useCallback((nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

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
    updates: { name?: string; tags?: string[]; notes?: string }
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
    const result = await createArtifactDeletionPlan({
      projectId: activeProjectId,
      chapterId: selectedChapterId,
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

  const executePlan = useCallback(async () => {
    if (!deletePlan || !window.artifactDeletion) throw new Error("删除服务不可用");
    const result = await window.artifactDeletion.execute({
      planId: deletePlan.planId,
      fingerprint: deletePlan.fingerprint,
      confirmation: deletePlan.scope === "chapter"
        ? { type: "chapter", chapterId: deletePlan.chapterId }
        : { type: "artifacts", artifactCount: deletePlan.deleteItems.length + deletePlan.migrateItems.length },
    });
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

  const toggleNodeExpansion = (projectId: string) => {
    const nodeId = `proj-${projectId}`;
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  return (
    <div className={cn("h-full flex flex-col bg-background", className)}>
      {/* Header Tabs */}
      <Tabs value={currentTab} onValueChange={handleTabChange} className="flex-1 flex flex-col">
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

        <TabsContent value="workflow" className="flex-1 m-0 overflow-hidden">
          <div className="flex h-full min-h-0">
            {/* Left Navigation Tree */}
            <aside className="w-64 border-r bg-panel flex flex-col min-h-0">
              <div className="p-3 font-medium text-sm border-b shrink-0">项目导航</div>
              <ArtifactTree
                projects={projects}
                selectedChapterId={selectedChapterId}
                onChapterClick={handleChapterClick}
                expandedNodes={expandedNodes}
                onExpandToggle={handleExpandToggle}
              />
            </aside>

            {/* Center Table */}
            <main className="flex-1 flex flex-col min-w-0 min-h-0">
              <div className="flex items-center justify-between border-b px-3 py-2 shrink-0">
                <FilterBar
                  stageFilter={stageFilter}
                  stateFilter={stateFilter}
                  onStageFilterChange={setStageFilter}
                  onStateFilterChange={setStateFilter}
                  totalArtifacts={filteredArtifacts.length}
                />
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={!selectedChapterId || selectedIds.size === 0} onClick={() => void openSelectedDelete()}>
                    <Trash2 className="mr-1 h-4 w-4" />删除选中 ({selectedIds.size})
                  </Button>
                  <Button variant="destructive" size="sm" disabled={!selectedChapterId} onClick={() => void openChapterDelete()}>
                    <Trash2 className="mr-1 h-4 w-4" />删除当前章节
                  </Button>
                </div>
              </div>
              <div className="flex-1 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 sticky top-0">
                    <tr>
                      <th className="text-left p-2 w-10">
                        <input
                          type="checkbox"
                          aria-label="选择当前章节可见产物"
                          checked={Boolean(selectedChapterId) && filteredArtifacts.length > 0 && filteredArtifacts.every((artifact) => selectedIds.has(artifact.id))}
                          disabled={!selectedChapterId || filteredArtifacts.length === 0}
                          onChange={(event) => {
                            for (const artifact of filteredArtifacts) toggleArtifactSelection(artifact.id, event.target.checked);
                          }}
                          onClick={(event) => event.stopPropagation()}
                        />
                      </th>
                      <th className="text-left p-2 font-medium">名称</th>
                      <th className="text-left p-2 font-medium w-[120px]">阶段</th>
                      <th className="text-left p-2 font-medium w-[100px]">状态</th>
                      <th className="text-left p-2 font-medium w-[100px]">大小</th>
                      <th className="text-left p-2 font-medium w-[150px]">更新时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredArtifacts.map((artifact) => (
                      <tr
                        key={artifact.id}
                        onClick={() => handleArtifactClick(artifact)}
                        className={cn(
                          "cursor-pointer border-t hover:bg-muted/50 transition-colors",
                          selectedIds.has(artifact.id) && "bg-muted/50"
                        )}
                      >
                        <td className="p-2" onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={`选择产物 ${artifact.name}`}
                            checked={selectedIds.has(artifact.id)}
                            disabled={!selectedChapterId || artifact.chapterId !== selectedChapterId}
                            onChange={(event) => toggleArtifactSelection(artifact.id, event.target.checked)}
                          />
                        </td>
                        <td className="p-2 font-medium">{artifact.name}</td>
                        <td className="p-2">
                          <Badge variant="secondary" className="text-xs">
                            {currentTab === 'workflow'
                              ? STAGE_LABELS[artifact.stage] || artifact.stage
                              : '媒体库'}
                          </Badge>
                        </td>
                        <td className="p-2">
                          <span className={cn(
                            "text-xs px-2 py-1 rounded capitalize",
                            artifact.state === 'active' && "bg-green-600/20 text-green-600",
                            artifact.state === 'blocked' && "bg-red-600/20 text-red-600",
                            artifact.state === 'orphaned' && "bg-orange-600/20 text-orange-600"
                          )}>
                            {artifact.state}
                          </span>
                        </td>
                        <td className="p-2 font-mono text-xs">
                          {formatBytes(artifact.bytes)}
                        </td>
                        <td className="p-2 text-muted-foreground text-xs">
                          {new Date(artifact.updatedAt).toLocaleString('zh-CN')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {filteredArtifacts.length === 0 && (
                  <div className="h-full flex items-center justify-center text-center text-muted-foreground py-12">
                    没有符合条件的产物
                  </div>
                )}
              </div>
            </main>

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

// Helper functions that need to be at top level
const STAGE_LABELS: Record<string, string> = {
  "novel": "小说导入",
  "analysis": "内容分析",
  "script": "剧本生成",
  "assets": "素材准备",
  "storyboard": "分镜设计",
  "image": "图像生成",
  "voice": "语音合成",
  "production": "视频生产",
  "editing": "剪辑编辑",
  "remotion": "Remotion 编排",
  "export": "导出输出",
  "backup": "备份归档",
  "media-library": "媒体库",
};

const formatBytes = (bytes?: number): string => {
  if (!bytes) return "-";
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

export default ArtifactCenter;
