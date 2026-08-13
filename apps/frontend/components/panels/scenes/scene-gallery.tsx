// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * Scene Gallery - Middle column
 * Folder navigation, breadcrumb, and scene card grid
 */

import { useState, useMemo, useEffect } from "react";
import {
  useSceneStore,
  type Scene,
  type SceneFolder,
} from "@/stores/library/scene-store";
import { useAppSettingsStore } from "@/stores/app/app-settings-store";
import { useProjectStore } from "@/stores/project/project-store";
import { useMediaPanelStore } from "@/stores/navigation/media-panel-store";
import { useActiveScriptProject } from "@/stores/script/script-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { 
  FolderPlus,
  Folder,
  ChevronRight,
 
  Home,
  Pencil,
  Trash2,
  FolderInput,
  MapPin,
  Grid2X2,
  List,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ImagePreviewModal } from "@/components/features/media/media-preview-modal";
import { SceneCard } from "./scene-card";

type ViewMode = "grid" | "list";

interface SceneGalleryProps {
  onSceneSelect: (scene: Scene | null) => void;
  selectedSceneId: string | null;
}

export function SceneGallery({ onSceneSelect, selectedSceneId }: SceneGalleryProps) {
  const {
    scenes,
    folders,
    currentFolderId,
    addFolder,
    renameFolder,
    deleteFolder,
    setCurrentFolder,
    deleteScene,
    moveToFolder,
    getFolderById,
    selectScene,
    contactSheetTasks,
  } = useSceneStore();
  const { resourceSharing } = useAppSettingsStore();
  const { activeProjectId } = useProjectStore();
  const { activeEpisodeIndex } = useMediaPanelStore();
  const scriptProject = useActiveScriptProject();

  // 集作用域过滤
  const hasEpisodeScope = activeEpisodeIndex != null;
  const activeEpisodeId = hasEpisodeScope
    ? scriptProject?.scriptData?.episodes.find(ep => ep.index === activeEpisodeIndex)?.id
    : undefined;
  const [episodeViewScope, setEpisodeViewScope] = useState<'all' | 'episode'>('episode');

  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [showNewFolderDialog, setShowNewFolderDialog] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingFolder, setRenamingFolder] = useState<SceneFolder | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  const visibleFolders = useMemo(() => {
    if (resourceSharing.shareScenes) return folders;
    if (!activeProjectId) return [];
    return folders.filter((f) => f.projectId === activeProjectId);
  }, [folders, resourceSharing.shareScenes, activeProjectId]);

  const visibleScenes = useMemo(() => {
    let items: Scene[];
    if (resourceSharing.shareScenes) {
      items = scenes;
    } else if (!activeProjectId) {
      items = [];
    } else {
      items = scenes.filter((s) => s.projectId === activeProjectId);
    }
    // 本集过滤：只显示本集关联的场景 + 无集绑定的全局场景
    if (hasEpisodeScope && episodeViewScope === 'episode' && activeEpisodeId) {
      items = items.filter(s => !s.linkedEpisodeId || s.linkedEpisodeId === activeEpisodeId);
    }
    return items;
  }, [scenes, resourceSharing.shareScenes, activeProjectId, hasEpisodeScope, episodeViewScope, activeEpisodeId]);

  // Current folder's subfolders
  const subFolders = useMemo(() => 
    visibleFolders.filter(f => f.parentId === currentFolderId),
    [visibleFolders, currentFolderId]
  );

  // 当前文件夹的场景（分离根场景和子场景）
  const { rootScenes, childScenesMap } = useMemo(() => {
    let items = visibleScenes.filter(s => s.folderId === currentFolderId);
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      items = items.filter(s => 
        s.name.toLowerCase().includes(query) ||
        s.location?.toLowerCase().includes(query)
      );
    }
    
    // 根场景：没有 parentSceneId 的场景
    const roots = items.filter(s => !s.parentSceneId);
    
    // 构建父子关系映射（支持多层嵌套）
    const childMap = new Map<string, Scene[]>();
    items.forEach(s => {
      if (s.parentSceneId) {
        const children = childMap.get(s.parentSceneId) || [];
        children.push(s);
        childMap.set(s.parentSceneId, children);
      }
    });
    
    return { rootScenes: roots, childScenesMap: childMap };
  }, [visibleScenes, currentFolderId, searchQuery]);
  
  // 计算每个场景的子场景数量（递归计算所有后代）
  const getDescendantCount = (sceneId: string): number => {
    const children = childScenesMap.get(sceneId) || [];
    let count = children.length;
    for (const child of children) {
      count += getDescendantCount(child.id);
    }
    return count;
  };
  
  // 展开/收起状态
  const [expandedScenes, setExpandedScenes] = useState<Set<string>>(new Set());
  
  // 联合图任务完成后自动展开父场景（让用户看到切割后的子场景）
  useEffect(() => {
    if (!contactSheetTasks) return;
    for (const [sceneId, task] of Object.entries(contactSheetTasks)) {
      if (task && task.status === 'done' && !expandedScenes.has(sceneId)) {
        const hasChildren = childScenesMap.has(sceneId);
        if (hasChildren) {
          setExpandedScenes(prev => {
            const next = new Set(prev);
            next.add(sceneId);
            return next;
          });
        }
      }
    }
// eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactSheetTasks, childScenesMap]);
  
  const toggleExpand = (sceneId: string) => {
    const newExpanded = new Set(expandedScenes);
    if (newExpanded.has(sceneId)) {
      newExpanded.delete(sceneId);
    } else {
      newExpanded.add(sceneId);
    }
    setExpandedScenes(newExpanded);
  };
  
  // 递归构建场景树列表（平铺但带缩进层级）
  const buildSceneTree = (parentScenes: Scene[], depth: number = 0): Array<{ scene: Scene; depth: number }> => {
    const result: Array<{ scene: Scene; depth: number }> = [];
    for (const scene of parentScenes) {
      result.push({ scene, depth });
      // 如果展开，添加子场景
      if (expandedScenes.has(scene.id)) {
        const children = childScenesMap.get(scene.id) || [];
        if (children.length > 0) {
          result.push(...buildSceneTree(children, depth + 1));
        }
      }
    }
    return result;
  };
  
  // 最终显示的场景列表（带层级）
  const currentScenes = useMemo(() => {
    return buildSceneTree(rootScenes);
// eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootScenes, childScenesMap, expandedScenes]);

  // Breadcrumb path
  const breadcrumbPath = useMemo(() => {
    const path: SceneFolder[] = [];
    let folderId = currentFolderId;
    while (folderId) {
      const folder = getFolderById(folderId);
      if (folder) {
        path.unshift(folder);
        folderId = folder.parentId;
      } else {
        break;
      }
    }
    return path;
  }, [currentFolderId, getFolderById]);

  useEffect(() => {
    if (resourceSharing.shareScenes) return;
    const allowedIds = new Set(visibleFolders.map((f) => f.id));
    if (currentFolderId && !allowedIds.has(currentFolderId)) {
      setCurrentFolder(null);
    }
  }, [resourceSharing.shareScenes, visibleFolders, currentFolderId, setCurrentFolder]);

  const handleCreateFolder = () => {
    if (!newFolderName.trim()) {
      toast.error("请输入文件夹名称");
      return;
    }
    const projectId = resourceSharing.shareScenes ? undefined : activeProjectId || undefined;
    addFolder(newFolderName.trim(), currentFolderId, projectId);
    setNewFolderName("");
    setShowNewFolderDialog(false);
    toast.success("文件夹已创建");
  };

  const handleRenameFolder = () => {
    if (!renamingFolder || !renameValue.trim()) return;
    renameFolder(renamingFolder.id, renameValue.trim());
    setRenamingFolder(null);
    setRenameValue("");
    toast.success("文件夹已重命名");
  };

  const handleDeleteFolder = (id: string) => {
    if (confirm("确定要删除此文件夹吗？文件夹内的场景将移动到上级目录。")) {
      deleteFolder(id);
      toast.success("文件夹已删除");
    }
  };

  const handleDeleteScene = (scene: Scene) => {
    if (confirm(`确定要删除场景 "${scene.name}" 吗？`)) {
      deleteScene(scene.id);
      if (selectedSceneId === scene.id) {
        onSceneSelect(null);
      }
      toast.success("场景已删除");
    }
  };

  const handleSceneClick = (scene: Scene) => {
    if (selectedSceneId === scene.id) {
      selectScene(null);
      onSceneSelect(null);
    } else {
      selectScene(scene.id);
      onSceneSelect(scene);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header with breadcrumb and toolbar */}
      <div className="p-3 pb-2 border-b space-y-2">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1 text-sm overflow-x-auto">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 gap-1"
            onClick={() => setCurrentFolder(null)}
          >
            <Home className="h-3.5 w-3.5" />
            场景库
          </Button>
          {breadcrumbPath.map((folder) => (
            <div key={folder.id} className="flex items-center">
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2"
                onClick={() => setCurrentFolder(folder.id)}
              >
                {folder.name}
              </Button>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索场景..."
              className="h-8 pl-7 text-sm"
            />
          </div>
          {/* 全剧/本集切换（仅在进入某集时显示）*/}
          {hasEpisodeScope && (
            <div className="flex border rounded-md">
              <Button
                variant={episodeViewScope === 'episode' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-8 px-2 rounded-r-none text-xs"
                onClick={() => setEpisodeViewScope('episode')}
              >
                本集
              </Button>
              <Button
                variant={episodeViewScope === 'all' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-8 px-2 rounded-l-none text-xs"
                onClick={() => setEpisodeViewScope('all')}
              >
                全剧
              </Button>
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setShowNewFolderDialog(true)}
          >
            <FolderPlus className="h-3.5 w-3.5 mr-1" />
            新建
          </Button>
          <div className="flex border rounded-md">
            <Button
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              size="sm"
              className="h-8 px-2 rounded-r-none"
              onClick={() => setViewMode("grid")}
            >
              <Grid2X2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="sm"
              className="h-8 px-2 rounded-l-none"
              onClick={() => setViewMode("list")}
            >
              <List className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1 p-3 pb-32">
        {/* Folders */}
        {subFolders.length > 0 && (
          <div className="mb-4">
            <div className="text-xs text-muted-foreground mb-2">文件夹</div>
            <div className={cn(
              viewMode === "grid" 
                ? "grid grid-cols-3 gap-2" 
                : "space-y-1"
            )}>
              {subFolders.map((folder) => (
                <FolderContextMenu
                  key={folder.id}
                  folder={folder}
                  onRename={() => {
                    setRenamingFolder(folder);
                    setRenameValue(folder.name);
                  }}
                  onDelete={() => handleDeleteFolder(folder.id)}
                >
                  <div
                    className={cn(
                      "flex items-center gap-2 p-2 rounded-md border cursor-pointer transition-colors",
                      "hover:bg-accent",
                      viewMode === "grid" && "flex-col text-center"
                    )}
                    onDoubleClick={() => setCurrentFolder(folder.id)}
                  >
                    <Folder className={cn(
                      "text-yellow-500",
                      viewMode === "grid" ? "h-8 w-8" : "h-4 w-4"
                    )} />
                    <span className={cn(
                      "truncate",
                      viewMode === "grid" ? "text-xs w-full" : "text-sm flex-1"
                    )}>
                      {folder.name}
                    </span>
                  </div>
                </FolderContextMenu>
              ))}
            </div>
          </div>
        )}

        {/* Scenes */}
        {currentScenes.length > 0 ? (
          <div>
            <div className="text-xs text-muted-foreground mb-2">
              场景 ({rootScenes.length})
            </div>
            <div className={cn(
              viewMode === "grid" 
                ? "grid grid-cols-2 gap-2" 
                : "space-y-1"
            )}>
              {currentScenes.map(({ scene, depth }) => {
                const childCount = getDescendantCount(scene.id);
                const isExpanded = expandedScenes.has(scene.id);
                const hasChildren = childCount > 0;
                
                return (
                  <SceneContextMenu
                    key={scene.id}
                    scene={scene}
                    folders={visibleFolders}
                    onDelete={() => handleDeleteScene(scene)}
                    onMove={(folderId) => {
                      moveToFolder(scene.id, folderId);
                      toast.success("场景已移动");
                    }}
                  >
                    <SceneCard
                      scene={scene}
                      isSelected={selectedSceneId === scene.id}
                      viewMode={viewMode}
                      onClick={() => handleSceneClick(scene)}
                      depth={depth}
                      childCount={childCount}
                      isExpanded={isExpanded}
                      hasChildren={hasChildren}
                      onToggleExpand={() => toggleExpand(scene.id)}
                      onImagePreview={(url) => setPreviewImageUrl(url)}
                      generatingTask={contactSheetTasks[scene.id]}
                    />
                  </SceneContextMenu>
                );
              })}
            </div>
          </div>
        ) : (
          subFolders.length === 0 && (
            <div className="flex flex-col items-center justify-center h-[200px] text-center">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                <MapPin className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                {searchQuery ? "没有找到匹配的场景" : "还没有场景"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                使用左侧控制台创建场景
              </p>
            </div>
          )
        )}
      </ScrollArea>

      {/* Image preview lightbox */}
      {previewImageUrl && (
        <ImagePreviewModal
          imageUrl={previewImageUrl}
          isOpen={true}
          onClose={() => setPreviewImageUrl(null)}
        />
      )}

      {/* New folder dialog */}
      <Dialog open={showNewFolderDialog} onOpenChange={setShowNewFolderDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建文件夹</DialogTitle>
          </DialogHeader>
          <Input
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="文件夹名称"
            onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewFolderDialog(false)}>
              取消
            </Button>
            <Button onClick={handleCreateFolder}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename folder dialog */}
      <Dialog open={!!renamingFolder} onOpenChange={(open) => !open && setRenamingFolder(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名文件夹</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder="文件夹名称"
            onKeyDown={(e) => e.key === "Enter" && handleRenameFolder()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenamingFolder(null)}>
              取消
            </Button>
            <Button onClick={handleRenameFolder}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Folder context menu
function FolderContextMenu({
 
  children,
  onRename,
  onDelete,
}: {
  folder: SceneFolder;
  children: React.ReactNode;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onRename}>
          <Pencil className="h-4 w-4 mr-2" />
          重命名
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem className="text-destructive" onClick={onDelete}>
          <Trash2 className="h-4 w-4 mr-2" />
          删除文件夹
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// Scene context menu
function SceneContextMenu({
 
  children,
  folders,
  onDelete,
  onMove,
}: {
  scene: Scene;
  children: React.ReactNode;
  folders: SceneFolder[];
  onDelete: () => void;
  onMove: (folderId: string | null) => void;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <FolderInput className="h-4 w-4 mr-2" />
            移动到
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem onClick={() => onMove(null)}>
              <Home className="h-4 w-4 mr-2" />
              根目录
            </ContextMenuItem>
            {folders.map((f) => (
              <ContextMenuItem key={f.id} onClick={() => onMove(f.id)}>
                <Folder className="h-4 w-4 mr-2" />
                {f.name}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem className="text-destructive" onClick={onDelete}>
          <Trash2 className="h-4 w-4 mr-2" />
          删除场景
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
