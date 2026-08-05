// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { useMemo, useState, useEffect } from "react";
import {
  FileText,
  Folder,
  Clock,
  Hash,
  Tag,
  Link as LinkIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ArtifactRecord, PhysicalRef } from "@/types/artifacts";
import { STAGE_LABELS_BY_KEY as STAGE_LABELS } from "@/lib/artifacts/stage-labels";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RefPreview } from "../RefPreview";
import { EditableField, STATE_INFO, formatBytes, formatTimestamp } from "./helpers";
import { JsonViewer } from "./json-viewer";

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
  /** Callback when metadata is updated (name / notes — tags is read-only) */
  onMetadataUpdate?: (
    artifactId: string,
    updates: { name?: string; tags?: string[]; notes?: string }
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

  // Reset tab + selection whenever the displayed artifact changes.
  useEffect(() => {
    setActiveTab("metadata");
    setSelectedRef(null);
  }, [artifact?.id]);

  const handleMetadataUpdate = async (updates: {
    name?: string;
    tags?: string[];
    notes?: string;
  }) => {
    if (!artifact || !onMetadataUpdate) return;
    await onMetadataUpdate(artifact.id, updates);
    setEditingField(null);
  };

  // Group physical refs by type
  const groupedRefs = useMemo(() => {
    const groups: Record<string, PhysicalRef[]> = {};
    for (const ref of artifact?.physicalRefs ?? []) {
      if (!groups[ref.type]) {
        groups[ref.type] = [];
      }
      groups[ref.type].push(ref);
    }
    return groups;
  }, [artifact?.physicalRefs]);

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
                  <code className="block text-xs bg-muted p-2 rounded">
                    {artifact.deletePolicy}
                  </code>
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
              <div className="space-y-4">
                {Object.entries(groupedRefs).map(([type, refs]) => (
                  <div key={type} className="space-y-2">
                    <h4 className="font-medium flex items-center gap-2 text-sm">
                      {type === "local-media" && <Folder className="h-4 w-4" />}
                      {type === "project-file" && <FileText className="h-4 w-4" />}
                      {type === "exports" && <Folder className="h-4 w-4" />}
                      {type === "remotion" && <Folder className="h-4 w-4" />}
                      {type === "backup" && <Folder className="h-4 w-4" />}
                      {type.replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())} ({refs.length})
                    </h4>

                    <div className="space-y-2">
                      {refs.map((ref, idx) => (
                        <div
                          key={idx}
                          className="text-xs bg-muted/40 p-2 rounded hover:bg-muted/80 transition-colors cursor-pointer group relative"
                          title={ref.path}
                          onClick={() => {
                            setSelectedRef(ref);
                            setActiveTab("preview");
                          }}
                        >
                          <div className="flex items-center gap-2 pr-16">
                            <code className="break-all">{ref.path}</code>
                            {ref.bytes && (
                              <span className="shrink-0 text-xs text-muted-foreground">
                                ({formatBytes(ref.bytes)})
                              </span>
                            )}
                          </div>

                          {/* Full PhysicalRef structure as JSON */}
                          <JsonViewer value={ref} maxHeight="8rem" className="mt-2" />

                          {/* Preview button: explicit trigger to content-preview tab */}
                          <button
                            className="opacity-0 group-hover:opacity-100 absolute right-2 top-2 px-2 py-1 bg-background border rounded text-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedRef(ref);
                              setActiveTab("preview");
                            }}
                          >
                            预览
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                {artifact.physicalRefs.length === 0 && (
                  <div className="text-center text-muted-foreground py-8">
                    暂无物理文件引用
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
              {selectedRef && artifact.projectId ? (
                <div className="h-[60vh] min-h-0 rounded-md border border-border bg-card">
                  <RefPreview
                    ref={selectedRef}
                    projectId={artifact.projectId}
                    className="h-full"
                  />
                </div>
              ) : (
                <div className="flex h-40 items-center justify-center text-center text-muted-foreground">
                  <p className="text-sm">在「物理文件」标签页中点击任意文件以预览内容。</p>
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
