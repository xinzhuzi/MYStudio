// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { useMemo, useState, useEffect } from "react";
import {
  X,
  Save,
  Link as LinkIcon,
  FileText,
  Folder,
  Clock,
  Hash,
  Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ArtifactRecord, PhysicalRef, DeletePolicy } from "@/types/artifacts";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";

/**
 * Artifact Detail Panel Component
 *
 * Full metadata display with inline editing
 * Shows physical refs and dependency chains
 * Pure props - uses hooks for side effects
 */

export interface ArtifactDetailPanelProps {
  /** Artifact record to display */
  artifact?: ArtifactRecord | null;

  /** Is panel open? */
  isOpen: boolean;

  /** Callback when panel is closed */
  onClose: () => void;

  /** Callback when metadata is updated */
  onMetadataUpdate?: (
    artifactId: string,
    updates: { name?: string; tags?: string[]; notes?: string }
  ) => Promise<void>;

  /** Custom className for root element */
  className?: string;
}

interface EditableFieldProps<T extends string | string[] | undefined> {
  label: string;
  value: T;
  onSave: (newValue: T) => Promise<void>;
  isEditing: boolean;
  setIsEditing: (editing: boolean) => void;
  placeholder?: string;
}

function EditableField({
  label,
  value,
  onSave,
  isEditing,
  setIsEditing,
  placeholder,
}: EditableFieldProps<any>) {
  const [tempValue, setTempValue] = useState<string>(
    typeof value === 'string' ? value : JSON.stringify(value)
  );

  useEffect(() => {
    if (!isEditing) {
      setTempValue(typeof value === 'string' ? value : JSON.stringify(value));
    }
  }, [isEditing, value]);

  const handleSave = async () => {
    try {
      let newValue: any = tempValue;
      if (typeof value === 'object' && value !== null) {
        try {
          newValue = JSON.parse(tempValue);
        } catch {
          // Keep original if parse fails
          return;
        }
      }
      await onSave(newValue);
    } finally {
      setIsEditing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      setTempValue(typeof value === 'string' ? value : JSON.stringify(value));
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-2">
        <Input
          value={tempValue}
          onChange={(e) => setTempValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoFocus
          className="flex-1"
        />
        <Button size="icon" variant="ghost" onClick={handleSave}>
          <Save className="h-3 w-3" />
        </Button>
        <Button size="icon" variant="ghost" onClick={() => setIsEditing(false)}>
          <X className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between group">
      <div className="text-sm text-muted-foreground flex-1 truncate">
        {value || <span className="italic text-muted-foreground">未设置</span>}
      </div>
      <button
        onClick={() => setIsEditing(true)}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-muted rounded"
      >
        <FileText className="h-3 w-3 text-muted-foreground" />
      </button>
    </div>
  );
}

export function ArtifactDetailPanel({
  artifact,
  isOpen,
  onClose,
  onMetadataUpdate,
  className,
}: ArtifactDetailPanelProps) {
  const [editingField, setEditingField] = useState<null | 'name' | 'tags' | 'notes'>(null);

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

  // Format stage for display
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

  // State icons
  const STATE_INFO: Record<string, { color: string; label: string }> = {
    "active": { color: "bg-green-600", label: "活跃" },
    "archived": { color: "bg-gray-600", label: "已归档" },
    "orphaned": { color: "bg-orange-600", label: "孤儿" },
    "blocked": { color: "bg-red-600", label: "已阻塞" },
    "unknown": { color: "bg-yellow-600", label: "未知" },
  };

  const formatTimestamp = (ts: number) => {
    return new Date(ts).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatBytes = (bytes?: number): string => {
    if (!bytes) return "-";
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  if (!isOpen || !artifact) {
    return null;
  }

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
          <Tabs defaultValue="metadata" className="w-full">
            <TabsList className="grid w-full grid-cols-3 mb-4">
              <TabsTrigger value="metadata">元数据</TabsTrigger>
              <TabsTrigger value="physical">物理文件</TabsTrigger>
              <TabsTrigger value="dependencies">依赖关系</TabsTrigger>
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
                    isEditing={editingField === 'name'}
                    setIsEditing={(e) => setEditingField(e ? 'name' : null)}
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
                    <code className="block text-xs bg-muted p-2 rounded">
                      {artifact.projectId}
                    </code>
                  </div>
                </div>

                {artifact.chapterId && (
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">章节 ID</label>
                    <code className="block text-xs bg-muted p-2 rounded">
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

                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">标签</label>
                  <EditableField
                    label="标签"
                    value={artifact.metadata?.tags || []}
                    onSave={(v) => handleMetadataUpdate({ tags: v })}
                    isEditing={editingField === 'tags'}
                    setIsEditing={(e) => setEditingField(e ? 'tags' : null)}
                    placeholder='["tag1", "tag2"]'
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">备注</label>
                  <EditableField
                    label="备注"
                    value={artifact.metadata?.notes || ''}
                    onSave={(v) => handleMetadataUpdate({ notes: v })}
                    isEditing={editingField === 'notes'}
                    setIsEditing={(e) => setEditingField(e ? 'notes' : null)}
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
                      {type === 'local-media' && <Folder className="h-4 w-4" />}
                      {type === 'project-file' && <FileText className="h-4 w-4" />}
                      {type === 'exports' && <Folder className="h-4 w-4" />}
                      {type === 'remotion' && <Folder className="h-4 w-4" />}
                      {type === 'backup' && <Folder className="h-4 w-4" />}
                      {type.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())} ({refs.length})
                    </h4>

                    <div className="space-y-1">
                      {refs.map((ref, idx) => (
                        <div
                          key={idx}
                          className="text-xs bg-muted p-2 rounded break-all hover:bg-muted/80 transition-colors cursor-pointer group relative"
                          title={ref.path}
                        >
                          <code>{ref.path}</code>
                          {ref.bytes && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              ({formatBytes(ref.bytes)})
                            </span>
                          )}

                          {/* Preview button (future feature) */}
                          <button
                            className="opacity-0 group-hover:opacity-100 absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-background border rounded text-xs"
                            onClick={() => {
                              // Future: trigger preview
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
                      {artifact.upstreamIds.map(id => (
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
                    LinkIcon className="h-4 w-4"/
                    下游引用 ({artifact.downstreamIds.length})
                  </h4>

                  {artifact.downstreamIds.length === 0 ? (
                    <p className="text-xs text-muted-foreground">无下游引用（叶子节点）</p>
                  ) : (
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {artifact.downstreamIds.map(id => (
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
          </Tabs>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

export default ArtifactDetailPanel;
