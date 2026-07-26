// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { useMediaStore, SYSTEM_CATEGORIES } from "@/stores/media/media-store";
import { MediaFile, MediaFolder } from "@/types/media";
import {
  ArrowDown01,
  Grid2X2,
  List,
  Loader2,
  FolderPlus,
  CloudUpload,
  Home,
  ChevronRight,
} from "lucide-react";
import { useRef, useState, useMemo, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useProjectStore } from "@/stores/project/project-store";
import { useAppSettingsStore } from "@/stores/app/app-settings-store";
import { usePreviewStore } from "@/stores/playback/preview-store";
import { useDirectorStore } from "@/stores/director/director-store";
import { useMediaPanelStore } from "@/stores/navigation/media-panel-store";
import { processMediaFiles } from "@/lib/media/media-processing";
import {
  generateVideoThumbnail,
  getMediaDuration,
} from "@/stores/media/media-store";
import { MediaLibraryGrid } from "./MediaLibraryGrid";
import { MediaLibraryList } from "./MediaLibraryList";
import {
  getCurrentMediaFolders,
  getFilteredMediaItems,
  getMediaBreadcrumbPath,
  getMediaFolderFileCounts,
  getVisibleMediaFiles,
  getVisibleMediaFolders,
  splitCurrentMediaFolders,
  type MediaSortBy,
  type MediaSortOrder,
} from "./media-view-helpers";

export function MediaView() {
  const { 
    mediaFiles, 
    folders,
    currentFolderId,
    addMediaFile, 
    removeMediaFile,
    addFolder,
    renameFolder,
    deleteFolder,
    setCurrentFolder,
    renameMediaFile,
    moveToFolder,
  } = useMediaStore();
  const { activeProject } = useProjectStore();
  const { resourceSharing } = useAppSettingsStore();
  const { setPreviewItem } = usePreviewStore();
  const { setStoryboardImage, setStoryboardStatus, setProjectFolderId } = useDirectorStore();
  const { setActiveTab } = useMediaPanelStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [sortBy, setSortBy] = useState<MediaSortBy>("name");
  const [sortOrder, setSortOrder] = useState<MediaSortOrder>("asc");
  
  // Dialog states
  const [newFolderDialogOpen, setNewFolderDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ type: 'folder' | 'file'; id: string; name: string } | null>(null);

  const visibleFolders = useMemo(() => {
    return getVisibleMediaFolders(
      folders,
      resourceSharing.shareMedia,
      activeProject?.id,
    );
  }, [folders, resourceSharing.shareMedia, activeProject]);

  const visibleMediaFiles = useMemo(() => {
    return getVisibleMediaFiles(
      mediaFiles,
      resourceSharing.shareMedia,
      activeProject?.id,
    );
  }, [mediaFiles, resourceSharing.shareMedia, activeProject]);

  const { getOrCreateCategoryFolder } = useMediaStore();

  const processFiles = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;
    if (!activeProject) {
      toast.error("没有活动项目");
      return;
    }

    setIsProcessing(true);
    setProgress(0);
    try {
      // Auto-assign to "上传文件" system folder if user is at root
      const uploadFolderId = currentFolderId || getOrCreateCategoryFolder('upload');
      const processedItems = await processMediaFiles(files, (p) => setProgress(p));
      for (const item of processedItems) {
        await addMediaFile(activeProject.id, { ...item, folderId: uploadFolderId });
      }
      toast.success(`已添加 ${processedItems.length} 个文件`);
    } catch (error) {
      console.error("Error processing files:", error);
      toast.error("处理文件失败");
    } finally {
      setIsProcessing(false);
      setProgress(0);
    }
  };

  const handleFileSelect = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) processFiles(e.target.files);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files) {
      processFiles(e.dataTransfer.files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleRemove = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!activeProject) {
      toast.error("没有活动项目");
      return;
    }
    await removeMediaFile(activeProject.id, id);
    toast.success("已删除");
  };

  const handlePreview = (item: MediaFile) => {
    if (!item.url) return;
    setPreviewItem({
      type: item.type === "video" ? "video" : "image",
      url: item.url,
      name: item.name,
    });
  };

  const handleExport = async (item: MediaFile) => {
    if (!item.url) {
      toast.error('文件URL不可用');
      return;
    }
    try {
      // For local protocol URLs, use Electron's save dialog
      if (item.url.startsWith('local-image://') || item.url.startsWith('local-video://')) {
        if (typeof window !== 'undefined' && window.electronAPI?.saveFileDialog) {
          // Use Electron's save dialog
          const result = await window.electronAPI.saveFileDialog({
            localPath: item.url,
            defaultPath: item.name,
            filters: item.type === 'video' 
              ? [{ name: 'Video', extensions: ['mp4', 'webm', 'mov'] }]
              : [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'gif'] }],
          });
          if (result.success) {
            toast.success(`已导出: ${item.name}`);
          } else if (result.canceled) {
            // User canceled, do nothing
          } else if (result.error) {
            toast.error(`导出失败: ${result.error}`);
          }
          return;
        }
        
        toast.error('请重启应用以启用导出功能');
        return;
      }
      
      // For http/https/data URLs, use standard download
      const a = document.createElement("a");
      a.href = item.url;
      a.download = item.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success(`已导出: ${item.name}`);
    } catch (error) {
      const err = error as Error;
      toast.error(`导出失败: ${err.message}`);
    }
  };

  // AI 导演功能 - 智能切割（直接进入切割状态）
  const handleSmartSplit = (item: MediaFile) => {
    if (item.type !== 'image' || !item.url) return;
    
    // 设置项目文件夹（如果图片在文件夹中）
    if (item.folderId) {
      setProjectFolderId(item.folderId);
    }
    
    // 设置故事板图片并进入预览状态（等待用户点击切割）
    setStoryboardImage(item.url, item.id);
    setStoryboardStatus('preview');
    
    // 切换到导演面板
    setActiveTab('director');
    toast.success('已载入图片，请点击“切割场景”开始智能切割');
  };

  // AI 导演功能 - 分镜生成（直接进入编辑状态，作为单张分镜）
  const handleGenerateScenes = (item: MediaFile) => {
    if (item.type !== 'image' || !item.url) return;
    
    // 设置项目文件夹
    if (item.folderId) {
      setProjectFolderId(item.folderId);
    }
    
    // 设置故事板图片为当前图片
    setStoryboardImage(item.url, item.id);
    
    // 直接设置为编辑状态，并创建单个分镜
    const { setSplitScenes, setStoryboardConfig } = useDirectorStore.getState();
    
    // 设置配置为单场景
    setStoryboardConfig({
      sceneCount: 1,
      storyPrompt: item.name,
    });
    
    // 创建单个分镜（包含所有必需属性）
    setSplitScenes([{
      id: 0,
      // 场景信息
      sceneName: item.name,
      sceneLocation: '',
      // 首帧
      imageDataUrl: item.url,
      imageHttpUrl: null,
      width: item.width || 1920,
      height: item.height || 1080,
      imagePrompt: '',
      imagePromptZh: '',
      imageStatus: 'completed',
      imageProgress: 100,
      imageError: null,
      // 尾帧
      needsEndFrame: false,
      endFrameImageUrl: null,
      endFrameHttpUrl: null,
      endFrameSource: null,
      endFramePrompt: '',
      endFramePromptZh: '',
      endFrameStatus: 'idle',
      endFrameProgress: 0,
      endFrameError: null,
      // 视频
      videoPrompt: '',
      videoPromptZh: `场景 1`,
      videoStatus: 'idle',
      videoProgress: 0,
      videoUrl: null,
      videoError: null,
      videoMediaId: null,
      // 角色与情绪
      characterIds: [],
      emotionTags: [],
      // 剧本信息
      dialogue: '',
      actionSummary: '',
      cameraMovement: '',
      soundEffectText: '',
      // 视频参数
      shotSize: null,
      duration: 5,
      ambientSound: '',
      soundEffects: [],
      // 位置
      row: 0,
      col: 0,
      sourceRect: { x: 0, y: 0, width: item.width || 1920, height: item.height || 1080 },
    }]);
    
    setStoryboardStatus('editing');
    
    // 切换到导演面板
    setActiveTab('director');
    toast.success('已创建分镜，可以开始生成视频');
  };

  // Get folders in current directory
  const currentFolders = useMemo(() => {
    return getCurrentMediaFolders(visibleFolders, currentFolderId);
  }, [visibleFolders, currentFolderId]);

  // Split root folders into system vs custom groups
  const { systemFolders, customFolders } = useMemo(() => {
    return splitCurrentMediaFolders(currentFolders, currentFolderId);
  }, [currentFolders, currentFolderId]);

  // Count files in each folder (including nested)
  const folderFileCounts = useMemo(() => {
    return getMediaFolderFileCounts(
      currentFolders,
      visibleFolders,
      visibleMediaFiles,
    );
  }, [currentFolders, visibleFolders, visibleMediaFiles]);

  // Get breadcrumb path
  const breadcrumbPath = useMemo(() => {
    return getMediaBreadcrumbPath(visibleFolders, currentFolderId);
  }, [visibleFolders, currentFolderId]);

  useEffect(() => {
    if (resourceSharing.shareMedia) return;
    const allowedIds = new Set(visibleFolders.map((f) => f.id));
    if (currentFolderId && !allowedIds.has(currentFolderId)) {
      setCurrentFolder(null);
    }
  }, [resourceSharing.shareMedia, visibleFolders, currentFolderId, setCurrentFolder]);

  const filteredMediaItems = useMemo(() => {
    return getFilteredMediaItems(
      visibleMediaFiles,
      currentFolderId,
      sortBy,
      sortOrder,
    );
  }, [visibleMediaFiles, sortBy, sortOrder, currentFolderId]);

  // Handle new folder creation
  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return;
    const projectId = resourceSharing.shareMedia ? undefined : activeProject?.id;
    addFolder(newFolderName.trim(), currentFolderId, projectId);
    setNewFolderName("");
    setNewFolderDialogOpen(false);
    toast.success(`文件夹「${newFolderName}」已创建`);
  };

  // Handle rename
  const handleRename = () => {
    if (!renameTarget || !renameTarget.name.trim()) return;
    if (renameTarget.type === 'folder') {
      renameFolder(renameTarget.id, renameTarget.name.trim());
    } else {
      renameMediaFile(renameTarget.id, renameTarget.name.trim());
    }
    setRenameTarget(null);
    setRenameDialogOpen(false);
    toast.success("已重命名");
  };

  // Handle folder delete
  const handleDeleteFolder = (id: string) => {
    deleteFolder(id);
    toast.success("文件夹已删除");
  };

  // Handle move to folder
  const handleMoveToFolder = async (mediaId: string, folderId: string | null) => {
    try {
      await moveToFolder(mediaId, folderId);
      toast.success("已移动");
    } catch (error) {
      console.error("Move media file failed:", error);
      toast.error(error instanceof Error ? error.message : "移动失败");
    }
  };

  // Open rename dialog for folder
  const openRenameFolderDialog = (folder: MediaFolder) => {
    setRenameTarget({ type: 'folder', id: folder.id, name: folder.name });
    setRenameDialogOpen(true);
  };

  // Open rename dialog for file
  const openRenameFileDialog = (item: MediaFile) => {
    setRenameTarget({ type: 'file', id: item.id, name: item.name });
    setRenameDialogOpen(true);
  };

  return (
    <div className="studio-workspace studio-workspace-media h-full flex flex-col">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*,audio/*"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Header */}
      <div className="p-3 pb-2 bg-panel">
        <div className="flex items-center justify-end mb-2">
          <span className="text-xs text-muted-foreground">
            {currentFolders.length} 文件夹, {filteredMediaItems.length} 文件
          </span>
        </div>

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 text-xs mb-2 overflow-x-auto">
          <button
            onClick={() => setCurrentFolder(null)}
            className="hover:text-primary flex items-center gap-1 shrink-0"
          >
            <Home className="h-3 w-3" />
            根目录
          </button>
          {breadcrumbPath.map((folder) => (
            <span key={folder.id} className="flex items-center gap-1 shrink-0">
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
              <button
                onClick={() => setCurrentFolder(folder.id)}
                className="hover:text-primary"
              >
                {folder.name}
              </button>
            </span>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleFileSelect}
            disabled={isProcessing}
            className="flex-1"
          >
            {isProcessing ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <CloudUpload className="h-4 w-4 mr-2" />
            )}
            上传
          </Button>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setNewFolderDialogOpen(true)}
                  className="h-8 w-8"
                >
                  <FolderPlus className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>新建文件夹</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setViewMode(viewMode === "grid" ? "list" : "grid")}
                  className="h-8 w-8"
                >
                  {viewMode === "grid" ? (
                    <List className="h-4 w-4" />
                  ) : (
                    <Grid2X2 className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {viewMode === "grid" ? "列表视图" : "网格视图"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-8 w-8">
                <ArrowDown01 className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => { setSortBy("name"); setSortOrder("asc"); }}>
                名称 {sortBy === "name" && (sortOrder === "asc" ? "↑" : "↓")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setSortBy("type"); setSortOrder("asc"); }}>
                类型 {sortBy === "type" && (sortOrder === "asc" ? "↑" : "↓")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setSortBy("duration"); setSortOrder("asc"); }}>
                时长 {sortBy === "duration" && (sortOrder === "asc" ? "↑" : "↓")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Content */}
      <div
        className="flex-1 overflow-y-auto p-3 pt-1 scrollbar-thin"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        {currentFolders.length === 0 && filteredMediaItems.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground border-2 border-dashed border-border rounded-lg">
            <CloudUpload className="h-12 w-12 mb-2 opacity-50" />
            <p className="text-sm">拖放文件到这里</p>
            <p className="text-xs">或点击上传按钮</p>
          </div>
        ) : viewMode === "grid" ? (
          <MediaLibraryGrid
            systemFolders={systemFolders}
            customFolders={customFolders}
            mediaItems={filteredMediaItems}
            visibleFolders={visibleFolders}
            folderFileCounts={folderFileCounts}
            currentFolderId={currentFolderId}
            onSetCurrentFolder={setCurrentFolder}
            onRenameFolder={openRenameFolderDialog}
            onDeleteFolder={handleDeleteFolder}
            onRemoveMedia={handleRemove}
            onExportMedia={handleExport}
            onRenameMedia={openRenameFileDialog}
            onMoveMedia={handleMoveToFolder}
            onSmartSplit={handleSmartSplit}
            onGenerateScenes={handleGenerateScenes}
            onPreviewMedia={handlePreview}
          />
        ) : (
          <MediaLibraryList
            systemFolders={systemFolders}
            customFolders={customFolders}
            mediaItems={filteredMediaItems}
            visibleFolders={visibleFolders}
            folderFileCounts={folderFileCounts}
            onSetCurrentFolder={setCurrentFolder}
            onRenameFolder={openRenameFolderDialog}
            onDeleteFolder={handleDeleteFolder}
            onRemoveMedia={handleRemove}
            onExportMedia={handleExport}
            onRenameMedia={openRenameFileDialog}
            onMoveMedia={handleMoveToFolder}
            onSmartSplit={handleSmartSplit}
            onGenerateScenes={handleGenerateScenes}
            onPreviewMedia={handlePreview}
          />
        )}
      </div>

      {/* New Folder Dialog */}
      <Dialog open={newFolderDialogOpen} onOpenChange={setNewFolderDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建文件夹</DialogTitle>
          </DialogHeader>
          <Input
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="文件夹名称"
            onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewFolderDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreateFolder}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名</DialogTitle>
          </DialogHeader>
          <Input
            value={renameTarget?.name || ''}
            onChange={(e) => setRenameTarget(prev => prev ? { ...prev, name: e.target.value } : null)}
            placeholder="新名称"
            onKeyDown={(e) => e.key === 'Enter' && handleRename()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleRename}>确定</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export { MediaView as default };
