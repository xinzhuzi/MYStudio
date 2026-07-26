import {
  Folder,
  Image,
  Music,
  Sparkles,
  Video,
} from "lucide-react";
import type { MediaFile, MediaFolder } from "@/types/media";
import {
  FolderContextMenu,
  MediaItemWithContextMenu,
  getFolderIcon,
} from "./media-context-menus";
import { formatMediaDuration } from "./media-view-helpers";

export type MediaItemPreviewProps = {
  item: MediaFile;
};

export function MediaItemPreview({ item }: MediaItemPreviewProps) {
  if (item.type === "image") {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <img
          src={item.url}
          alt={item.name}
          className="w-full max-h-full object-cover"
          loading="lazy"
        />
      </div>
    );
  }

  if (item.type === "video") {
    if (item.thumbnailUrl) {
      return (
        <div className="relative w-full h-full">
          <img
            src={item.thumbnailUrl}
            alt={item.name}
            className="w-full h-full object-cover rounded"
            loading="lazy"
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/20 rounded">
            <Video className="h-6 w-6 text-white" />
          </div>
          {item.duration && (
            <div className="absolute bottom-1 right-1 bg-black/70 text-white text-xs px-1 rounded">
              {formatMediaDuration(item.duration)}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="w-full h-full bg-muted/30 flex flex-col items-center justify-center text-muted-foreground rounded">
        <Video className="h-6 w-6 mb-1" />
        <span className="text-xs">Video</span>
      </div>
    );
  }

  if (item.type === "audio") {
    return (
      <div className="w-full h-full bg-green-500/20 flex flex-col items-center justify-center text-muted-foreground rounded border border-green-500/20">
        <Music className="h-6 w-6 mb-1" />
        <span className="text-xs">Audio</span>
        {item.duration && (
          <span className="text-xs opacity-70">
            {formatMediaDuration(item.duration)}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-muted/30 flex flex-col items-center justify-center text-muted-foreground rounded">
      <Image className="h-6 w-6" />
    </div>
  );
}

export type MediaLibraryGridProps = {
  systemFolders: MediaFolder[];
  customFolders: MediaFolder[];
  mediaItems: MediaFile[];
  visibleFolders: MediaFolder[];
  folderFileCounts: Record<string, number>;
  currentFolderId: string | null;
  onSetCurrentFolder: (folderId: string | null) => void;
  onRenameFolder: (folder: MediaFolder) => void;
  onDeleteFolder: (folderId: string) => void;
  onRemoveMedia: (event: React.MouseEvent, mediaId: string) => Promise<void>;
  onExportMedia: (item: MediaFile) => void;
  onRenameMedia: (item: MediaFile) => void;
  onMoveMedia: (mediaId: string, folderId: string | null) => Promise<void>;
  onSmartSplit: (item: MediaFile) => void;
  onGenerateScenes: (item: MediaFile) => void;
  onPreviewMedia: (item: MediaFile) => void;
};

export function MediaLibraryGrid({
  systemFolders,
  customFolders,
  mediaItems,
  visibleFolders,
  folderFileCounts,
  currentFolderId,
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
}: MediaLibraryGridProps) {
  return (
    <div className="space-y-3">
      {systemFolders.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-1.5 font-medium">
            素材分类
          </p>
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: "repeat(auto-fill, 100px)" }}
          >
            {systemFolders.map((folder) => {
              const IconComp = getFolderIcon(folder);
              const count = folderFileCounts[folder.id] || 0;
              return (
                <div
                  key={folder.id}
                  className="cursor-pointer hover:opacity-80 transition-opacity"
                  onDoubleClick={() => onSetCurrentFolder(folder.id)}
                >
                  <div className="w-[100px] h-[100px] rounded overflow-hidden bg-primary/5 flex flex-col items-center justify-center border border-primary/20 hover:border-primary/50 gap-1">
                    <IconComp className="h-8 w-8 text-primary/70" />
                    <span className="text-[10px] text-muted-foreground">
                      {count} 项
                    </span>
                  </div>
                  <p className="text-xs mt-1 truncate text-center font-medium">
                    {folder.name}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(customFolders.length > 0 || mediaItems.length > 0) && (
        <div>
          {systemFolders.length > 0 &&
            (customFolders.length > 0 || mediaItems.length > 0) && (
              <p className="text-xs text-muted-foreground mb-1.5 font-medium">
                {currentFolderId === null ? "自定义文件夹" : "内容"}
              </p>
            )}
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: "repeat(auto-fill, 100px)" }}
          >
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
                    className="cursor-pointer hover:opacity-80 transition-opacity"
                    onDoubleClick={() => onSetCurrentFolder(folder.id)}
                  >
                    <div className="w-[100px] h-[100px] rounded overflow-hidden bg-muted/50 flex flex-col items-center justify-center border-2 border-dashed border-muted-foreground/20 hover:border-primary/50 gap-1">
                      <Folder className="h-8 w-8 text-primary/70" />
                      <span className="text-[10px] text-muted-foreground">
                        {count} 项
                      </span>
                    </div>
                    <p className="text-xs mt-1 truncate text-center">
                      {folder.name}
                    </p>
                  </div>
                </FolderContextMenu>
              );
            })}

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
                  className="cursor-pointer hover:opacity-80 transition-opacity relative"
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
                  <div className="w-[100px] h-[100px] rounded overflow-hidden bg-muted relative">
                    <MediaItemPreview item={item} />
                    {item.source && item.source !== "upload" && (
                      <div className="absolute top-1 left-1 bg-primary/80 rounded p-0.5">
                        <Sparkles className="h-3 w-3 text-white" />
                      </div>
                    )}
                  </div>
                  <p className="text-xs mt-1 truncate">{item.name}</p>
                </div>
              </MediaItemWithContextMenu>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
