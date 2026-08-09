// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { useMemo, useState, useEffect, useRef } from "react";
import {
  FileText,
  FolderOpen,
  Copy,
  Clock,
  Hash,
  Tag,
  Link as LinkIcon,
  Archive,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ArtifactRecord, PhysicalRef } from "@/types/artifacts";
import { STAGE_LABELS_BY_KEY as STAGE_LABELS } from "@/lib/artifacts/stage-labels";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RefPreview } from "../RefPreview";
import { buildProjectFileUrl } from "@/lib/artifacts/ref-preview-loader";
import { EditableField, STATE_INFO, formatBytes, formatTimestamp } from "./helpers";
import { JsonViewer } from "./json-viewer";
import { getArtifactDeleteImpact } from "@/lib/artifacts/delete-impact";

/**
 * Artifact Detail Panel
 *
 * Full metadata display with inline editing for name/notes (tags are read-only
 * JSON). Shows physical refs (with full structure as JSON) and dependency
 * chains. Pure props — side effects live in the parent via onMetadataUpdate.
 */

export interface ArtifactDetailPanelProps {
  /** Artifact record to display */
  artifact?: ArtifactRecord | null;
  /** Is panel open? */
  isOpen: boolean;
  /** Callback when panel is closed */
  onClose: () => void;
  /** Callback when metadata is updated (name / notes only — tags is read-only in the UI; backend still accepts tags) */
  onMetadataUpdate?: (
    artifactId: string,
    updates: { name?: string; notes?: string }
  ) => Promise<void>;
  /** Custom className for root element */
  className?: string;
}

export function ArtifactDetailPanel({
  artifact,
  isOpen,
  onClose,
  onMetadataUpdate,
  className,
}: ArtifactDetailPanelProps) {
  const [editingField, setEditingField] = useState<null | "name" | "notes">(null);
  const [activeTab, setActiveTab] = useState<string>("metadata");
  const [selectedRef, setSelectedRef] = useState<PhysicalRef | null>(null);

  // Reset tab + selection whenever the displayed artifact changes. Default to
  // the first live physical ref so the content-preview tab has something to
  // render without requiring the user to pick from the physical-files tab
  // first. Skip backup refs (historical snapshots are not previewable) and refs
  // without a usable path so we never hand an invalid object to RefPreview
  // (which would degrade gracefully, but better to not select it).
  useEffect(() => {
    setActiveTab("metadata");
    const firstValid =
      artifact?.physicalRefs?.find(
        (r) => r && r.type !== "backup" && typeof r.path === "string",
      ) ?? null;
    setSelectedRef(firstValid);
  }, [artifact?.id, artifact?.physicalRefs]);

  const handleMetadataUpdate = async (updates: {
    name?: string;
    notes?: string;
  }) => {
    if (!artifact || !onMetadataUpdate) return;
    await onMetadataUpdate(artifact.id, updates);
    setEditingField(null);
  };

  // Keep the latest artifact in a ref so async handlers (which may be invoked
  // from a stale render's onClick closure) always read the current projectId.
  // Without this, the reveal handler captured an artifact that was null/empty
  // at the time the button's render happened, hit the early-return guard, and
  // silently did nothing — even though the current artifact was valid.
  const artifactRef = useRef(artifact);
  artifactRef.current = artifact;

  // Resolve a PhysicalRef to an absolute filesystem path and reveal it in the
  // OS file manager. `ref.path` is a project-relative path (e.g.
  // "backups/.../scenes.json") or a local-media id; the main process's path
  // resolver only understands file://, project-file://, local-image://
  // prefixes, so we must route through the correct preload surface to obtain
  // an absolute path before calling showItemInFolder. Previously we passed the
  // bare relative path, which silently failed with "文件不存在".
  const handleRevealRef = async (ref: PhysicalRef) => {
    // Read from the ref (always current), not the closure-captured `artifact`
    // (which may be stale in an old onClick closure).
    const currentArtifact = artifactRef.current;
    if (!currentArtifact?.projectId || typeof ref.path !== "string") return;
    try {
      let absolutePath: string | null | undefined;
      if (ref.type === "local-media") {
        absolutePath = await window.imageStorage?.getAbsolutePath?.(ref.path);
      } else {
        const url = buildProjectFileUrl(currentArtifact.projectId, ref.path);
        absolutePath = await window.projectFiles?.getAbsolutePath?.(url);
      }
      if (!absolutePath) {
        console.warn("[artifact-detail] 无法解析物理文件绝对路径", ref.path);
        return;
      }
      const result = await window.electronAPI?.showItemInFolder?.(absolutePath);
      if (result && !result.success) {
        console.warn("[artifact-detail] 定位失败:", result.error, absolutePath);
      }
    } catch (error) {
      console.error("[artifact-detail] 定位异常:", error);
    }
  };

  // Physical files are shown flat (no type grouping) on the 「物理文件」tab —
  // each ref is a row with its full path, a copy button, and a "reveal in
  // folder" action. The type-grouped view was removed per the artifact
  // management simplification (only show what is actually on disk locally).
  //
  // Backup refs (ref.type === "backup") are historical snapshots decoded from
  // store/backup files by the inventory merge — they are real files on disk and
  // we keep them for provenance tracing, but a single live artifact can carry
  // dozens of them (e.g. ~60 backup copies of the same mp4 across snapshots),
  // which floods the list. We split them out and collapse them behind a toggle
  // so the main list only shows the files the user actually cares about, while
  // the backup history remains accessible (display-only, not deleted).
  const flatRefs = useMemo(() => artifact?.physicalRefs ?? [], [artifact?.physicalRefs]);
  const liveRefs = useMemo(
    () => flatRefs.filter((ref) => ref.type !== "backup"),
    [flatRefs],
  );
  const backupRefs = useMemo(
    () => flatRefs.filter((ref) => ref.type === "backup"),
    [flatRefs],
  );

  // Whether the collapsed historical-backup section is expanded on the
  // 「物理文件」tab. Default collapsed so the list stays uncluttered.
  const [showBackups, setShowBackups] = useState(false);

  if (!isOpen || !artifact) {
    return null;
  }

  const tags = artifact.metadata?.tags ?? [];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            {artifact.name}
          </DialogTitle>
          {/* Provide an accessible description so Radix DialogContent doesn't
              warn about missing Description/aria-describedby. Visually hidden:
              screen readers announce it, sighted users see the tabs below. */}
          <DialogDescription className="sr-only">
            产物详情:查看元数据、物理文件、依赖关系与内容预览。
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(90vh-120px)]">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-4 mb-4">
              <TabsTrigger value="metadata">元数据</TabsTrigger>
              <TabsTrigger value="physical">物理文件</TabsTrigger>
              <TabsTrigger value="dependencies">依赖关系</TabsTrigger>
              <TabsTrigger value="preview">内容预览</TabsTrigger>
            </TabsList>

            {/* Metadata Tab */}
            <TabsContent value="metadata" className="space-y-4">
              {/* Basic Info Section */}
              <div className="space-y-3">
                <h3 className="font-semibold flex items-center gap-2">
                  <Hash className="h-4 w-4" />
                  基本信息
                </h3>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">名称</label>
                  <EditableField
                    label="名称"
                    value={artifact.name}
                    onSave={(v) => handleMetadataUpdate({ name: v })}
                    isEditing={editingField === "name"}
                    setIsEditing={(e) => setEditingField(e ? "name" : null)}
                    placeholder="输入名称..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">ID</label>
                    <code className="block text-xs bg-muted p-2 rounded break-all">
                      {artifact.id}
                    </code>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">项目 ID</label>
                    <code className="block text-xs bg-muted p-2 rounded break-all">
                      {artifact.projectId}
                    </code>
                  </div>
                </div>

                {artifact.chapterId && (
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">章节 ID</label>
                    <code className="block text-xs bg-muted p-2 rounded break-all">
                      {artifact.chapterId}
                    </code>
                  </div>
                )}
              </div>

              {/* Classification Section */}
              <div className="space-y-3">
                <h3 className="font-semibold flex items-center gap-2">
                  <Tag className="h-4 w-4" />
                  分类信息
                </h3>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">阶段</label>
                    <Badge variant="secondary">
                      {STAGE_LABELS[artifact.stage] || artifact.stage}
                    </Badge>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">类型</label>
                    <code className="block text-xs bg-muted p-2 rounded">
                      {artifact.kind}
                    </code>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">状态</label>
                  <div className="flex items-center gap-2">
                    <Badge className={cn("text-white", STATE_INFO[artifact.state].color)}>
                      {STATE_INFO[artifact.state].label}
                    </Badge>
                    {artifact.blockerReason && (
                      <span className="text-xs text-muted-foreground">
                        {artifact.blockerReason}
                      </span>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">删除策略</label>
                  {(() => {
                    const impact = getArtifactDeleteImpact(artifact);
                    const Icon = impact.icon;
                    return (
                      <div className="space-y-1.5 rounded-md bg-muted p-2">
                        <div className="flex items-center gap-1.5">
                          <Icon className={cn("h-4 w-4", impact.className)} />
                          <span className={cn("text-sm font-medium", impact.className)}>
                            {impact.label}
                          </span>
                          <code className="text-[10px] text-muted-foreground ml-auto">
                            {artifact.deletePolicy}
                          </code>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {impact.hint}
                        </p>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Timestamps Section */}
              <div className="space-y-3">
                <h3 className="font-semibold flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  时间戳
                </h3>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">创建时间</label>
                    <p className="text-sm">{formatTimestamp(artifact.createdAt)}</p>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">更新时间</label>
                    <p className="text-sm">{formatTimestamp(artifact.updatedAt)}</p>
                  </div>
                </div>
              </div>

              {/* Tags & Notes Section */}
              <div className="space-y-3">
                <h3 className="font-semibold flex items-center gap-2">
                  <Tag className="h-4 w-4" />
                  标签与备注
                </h3>

                {/* Tags — read-only JSON viewer (no longer editable) */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">标签</label>
                  {tags.length > 0 ? (
                    <JsonViewer value={tags} maxHeight="12rem" />
                  ) : (
                    <p className="text-sm italic text-muted-foreground">未设置</p>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">备注</label>
                  <EditableField
                    label="备注"
                    value={artifact.metadata?.notes || ""}
                    onSave={(v) => handleMetadataUpdate({ notes: v })}
                    isEditing={editingField === "notes"}
                    setIsEditing={(e) => setEditingField(e ? "notes" : null)}
                    placeholder="输入备注..."
                  />
                </div>
              </div>

              {/* Size Information */}
              {artifact.bytes && (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">文件大小</label>
                  <p className="text-sm font-mono">{formatBytes(artifact.bytes)}</p>
                </div>
              )}
            </TabsContent>

            {/* Physical Files Tab */}
            <TabsContent value="physical">
              <div className="space-y-2">
                {liveRefs.map((ref) => (
                  <div
                    key={`${ref.type}:${ref.path}`}
                    className="flex items-center gap-2 text-xs bg-muted/40 p-2 rounded hover:bg-muted/80 transition-colors group"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <code className="flex-1 break-all" title={ref.path}>{ref.path}</code>
                    {ref.bytes != null && ref.bytes > 0 && (
                      <span className="shrink-0 text-muted-foreground">
                        ({formatBytes(ref.bytes)})
                      </span>
                    )}
                    <button
                      type="button"
                      className="shrink-0 inline-flex items-center gap-1 px-2 py-1 bg-background border rounded hover:bg-muted"
                      title="复制完整路径"
                      onClick={() => {
                        void navigator.clipboard?.writeText(ref.path);
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" />复制
                    </button>
                    <button
                      type="button"
                      className="shrink-0 inline-flex items-center gap-1 px-2 py-1 bg-background border rounded hover:bg-muted"
                      title="在文件夹中显示"
                      onClick={() => {
                        void handleRevealRef(ref);
                      }}
                    >
                      <FolderOpen className="h-3.5 w-3.5" />定位
                    </button>
                  </div>
                ))}

                {/*
                  Live list empty state. Only show "暂无物理文件引用" when there
                  are neither live nor backup refs; if live is empty but backups
                  exist, the collapsed backup row below still renders so the user
                  sees there is history to expand.
                */}
                {liveRefs.length === 0 && backupRefs.length === 0 && (
                  <div className="text-center text-muted-foreground py-8">
                    暂无物理文件引用
                  </div>
                )}

                {/*
                  Collapsed historical-backup section. Backup refs are inventory-
                  merged historical snapshots (store/backup files); they are real
                  files kept for provenance, but collapsed by default to avoid
                  flooding the list (a live artifact can carry ~60 backup copies
                  of the same file). Display-only: copy path + reveal-in-folder.
                */}
                {backupRefs.length > 0 && (
                  <div className="rounded border border-dashed border-muted-foreground/30">
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted/60 rounded"
                      onClick={() => setShowBackups((prev) => !prev)}
                      aria-expanded={showBackups}
                    >
                      {showBackups ? (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                      )}
                      <Archive className="h-3.5 w-3.5 shrink-0" />
                      <span>历史备份 ×{backupRefs.length}</span>
                      <span className="ml-auto text-[10px]">
                        {showBackups ? "收起" : "展开"}
                      </span>
                    </button>
                    {showBackups &&
                      backupRefs.map((ref) => (
                        <div
                          key={`${ref.type}:${ref.path}`}
                          className="flex items-center gap-2 text-xs bg-muted/20 px-2 py-1.5 border-t border-dashed border-muted-foreground/20 group"
                        >
                          <Archive className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                          <code
                            className="flex-1 break-all text-muted-foreground"
                            title={ref.path}
                          >
                            {ref.path}
                          </code>
                          {ref.bytes != null && ref.bytes > 0 && (
                            <span className="shrink-0 text-muted-foreground/70">
                              ({formatBytes(ref.bytes)})
                            </span>
                          )}
                          <button
                            type="button"
                            className="shrink-0 inline-flex items-center gap-1 px-2 py-1 bg-background border rounded hover:bg-muted"
                            title="复制完整路径"
                            onClick={() => {
                              void navigator.clipboard?.writeText(ref.path);
                            }}
                          >
                            <Copy className="h-3 w-3" />复制
                          </button>
                          <button
                            type="button"
                            className="shrink-0 inline-flex items-center gap-1 px-2 py-1 bg-background border rounded hover:bg-muted"
                            title="在文件夹中显示（备份为快照文件）"
                            onClick={() => {
                              void handleRevealRef(ref);
                            }}
                          >
                            <FolderOpen className="h-3 w-3" />定位
                          </button>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Dependencies Tab */}
            <TabsContent value="dependencies">
              <div className="space-y-4">
                {/* Upstream Dependencies */}
                <div className="space-y-2">
                  <h4 className="font-medium flex items-center gap-2 text-sm">
                    <LinkIcon className="h-4 w-4" />
                    上游依赖 ({artifact.upstreamIds.length})
                  </h4>

                  {artifact.upstreamIds.length === 0 ? (
                    <p className="text-xs text-muted-foreground">无上游依赖（根节点）</p>
                  ) : (
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {artifact.upstreamIds.map((id) => (
                        <Badge key={id} variant="outline" className="cursor-pointer hover:bg-blue-50">
                          {id.substring(0, 16)}...
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                {/* Downstream References */}
                <div className="space-y-2">
                  <h4 className="font-medium flex items-center gap-2 text-sm">
                    <LinkIcon className="h-4 w-4" />
                    下游引用 ({artifact.downstreamIds.length})
                  </h4>

                  {artifact.downstreamIds.length === 0 ? (
                    <p className="text-xs text-muted-foreground">无下游引用（叶子节点）</p>
                  ) : (
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {artifact.downstreamIds.map((id) => (
                        <Badge key={id} variant="secondary" className="cursor-pointer hover:bg-green-50">
                          {id.substring(0, 16)}...
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                {/* Dependency Chain Visualization (future enhancement) */}
                <div className="pt-4 border-t">
                  <p className="text-xs text-muted-foreground italic">
                    注：点击 ID 可查看关联 artifact 详情（待实现）
                  </p>
                </div>
              </div>
            </TabsContent>

            {/* Content Preview Tab */}
            <TabsContent value="preview">
              {/* Backup refs are historical snapshots and cannot be previewed —
                  only live refs are eligible for the preview dropdown. */}
              {liveRefs.length === 0 || !artifact.projectId ? (
                <div className="flex h-40 items-center justify-center text-center text-muted-foreground">
                  <p className="text-sm">暂无物理文件可预览。</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <select
                    aria-label="选择要预览的物理文件"
                    className="w-full text-xs bg-background border rounded px-2 py-1.5"
                    value={selectedRef?.path ? `${selectedRef.type}:${selectedRef.path}` : ""}
                    onChange={(e) => {
                      const next = liveRefs.find(
                        (r) => `${r.type}:${r.path}` === e.target.value,
                      );
                      setSelectedRef(next ?? null);
                    }}
                  >
                    {liveRefs.map((ref) => (
                      <option key={`${ref.type}:${ref.path}`} value={`${ref.type}:${ref.path}`}>
                        {ref.path}
                      </option>
                    ))}
                  </select>
                  {selectedRef?.path ? (
                    <div className="h-[56vh] min-h-0 rounded-md border border-border bg-card">
                      <RefPreview
                        physicalRef={selectedRef}
                        projectId={artifact.projectId}
                        className="h-full"
                      />
                    </div>
                  ) : (
                    <div className="flex h-40 items-center justify-center text-center text-muted-foreground">
                      <p className="text-sm">请选择一个文件进行预览。</p>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

export default ArtifactDetailPanel;
