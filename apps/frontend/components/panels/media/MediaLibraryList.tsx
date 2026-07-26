import { Folder, Sparkles } from "lucide-react";
import {
  FolderContextMenu,
  MediaItemWithContextMenu,
  getFolderIcon,
} from "./media-context-menus";
import {
  MediaItemPreview,
  type MediaLibraryGridProps,
} from "./MediaLibraryGrid";
import { formatMediaDuration } from "./media-view-helpers";

export type MediaLibraryListProps = Omit<
  MediaLibraryGridProps,
  "currentFolderId"
>;

export function MediaLibraryList({
  systemFolders,
  customFolders,
  mediaItems,
  visibleFolders,
  folderFileCounts,
  onSetCurrentFolder,
  onRenameFolder,
  onDeleteFolder,
  onRemoveMedia,
  onExportMedia,
  onRenameMedia,
  onMoveMedia,
  onSmartSplit,
  onGenerateScenes,
  onPreviewMedia,
}: MediaLibraryListProps) {
  return (
    <div className="space-y-1">
      {systemFolders.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground px-2 pt-1 font-medium">
            素材分类
          </p>
          {systemFolders.map((folder) => {
            const IconComp = getFolderIcon(folder);
            const count = folderFileCounts[folder.id] || 0;
            return (
              <div
                key={folder.id}
                className="flex items-center gap-2 p-2 rounded hover:bg-accent cursor-pointer"
                onDoubleClick={() => onSetCurrentFolder(folder.id)}
              >
                <div className="w-12 h-12 rounded bg-primary/5 flex items-center justify-center flex-shrink-0 border border-primary/20">
                  <IconComp className="h-6 w-6 text-primary/70" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate font-medium">{folder.name}</p>
                  <p className="text-xs text-muted-foreground">{count} 项</p>
                </div>
              </div>
            );
          })}
        </>
      )}

      {customFolders.length > 0 && (
        <>
          {systemFolders.length > 0 && (
            <p className="text-xs text-muted-foreground px-2 pt-2 font-medium">
              自定义文件夹
            </p>
          )}
          {customFolders.map((folder) => {
            const count = folderFileCounts[folder.id] || 0;
            return (
              <FolderContextMenu
                key={folder.id}
                folder={folder}
                onRename={onRenameFolder}
                onDelete={onDeleteFolder}
              >
                <div
                  className="flex items-center gap-2 p-2 rounded hover:bg-accent cursor-pointer"
                  onDoubleClick={() => onSetCurrentFolder(folder.id)}
                >
                  <div className="w-12 h-12 rounded bg-muted/50 flex items-center justify-center flex-shrink-0">
                    <Folder className="h-6 w-6 text-primary/70" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{folder.name}</p>
                    <p className="text-xs text-muted-foreground">{count} 项</p>
                  </div>
                </div>
              </FolderContextMenu>
            );
          })}
        </>
      )}

      {mediaItems.map((item) => (
        <MediaItemWithContextMenu
          key={item.id}
          item={item}
          folders={visibleFolders}
          onRemove={onRemoveMedia}
          onExport={onExportMedia}
          onRename={onRenameMedia}
          onMove={onMoveMedia}
          onSmartSplit={onSmartSplit}
          onGenerateScenes={onGenerateScenes}
        >
          <div
            className="flex items-center gap-2 p-2 rounded hover:bg-accent cursor-pointer"
            onClick={() => onPreviewMedia(item)}
            draggable={item.type === "video"}
            onDragStart={(event) => {
              if (item.type !== "video") return;
              event.dataTransfer.setData(
                "application/json",
                JSON.stringify({
                  type: "media",
                  mediaType: item.type,
                  mediaId: item.id,
                  name: item.name,
                  url: item.url,
                  thumbnailUrl: item.thumbnailUrl,
                  duration: item.duration || 5,
                }),
              );
              event.dataTransfer.effectAllowed = "copy";
            }}
          >
            <div className="w-12 h-12 rounded overflow-hidden bg-muted flex-shrink-0 relative">
              <MediaItemPreview item={item} />
              {item.source && item.source !== "upload" && (
                <div className="absolute top-0.5 left-0.5 bg-primary/80 rounded p-0.5">
                  <Sparkles className="h-2 w-2 text-white" />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate">{item.name}</p>
              <p className="text-xs text-muted-foreground">
                {item.type}
                {item.duration && ` · ${formatMediaDuration(item.duration)}`}
                {item.source && item.source !== "upload" && " · AI生成"}
              </p>
            </div>
          </div>
        </MediaItemWithContextMenu>
      ))}
    </div>
  );
}
