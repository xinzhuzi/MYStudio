import {
  CloudUpload,
  Download,
  Film,
  Folder,
  FolderInput,
  Home,
  Pencil,
  Scissors,
  Sparkles,
  Trash2,
  type LucideIcon,
} from "lucide-react";
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
import { MediaFile, MediaFolder } from "@/types/media";

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  "ai-image": Sparkles,
  "ai-video": Film,
  upload: CloudUpload,
};

export function getFolderIcon(folder: MediaFolder) {
  if (folder.isSystem && folder.category) {
    const IconComp = CATEGORY_ICONS[folder.category];
    if (IconComp) return IconComp;
  }
  return Folder;
}

export function FolderContextMenu({
  folder,
  children,
  onRename,
  onDelete,
}: {
  folder: MediaFolder;
  children: React.ReactNode;
  onRename: (folder: MediaFolder) => void;
  onDelete: (id: string) => void;
}) {
  if (folder.isSystem) return <>{children}</>;
  return (
    <ContextMenu>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onRename(folder)}>
          <Pencil className="h-4 w-4 mr-2" />
          重命名
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem className="text-destructive" onClick={() => onDelete(folder.id)}>
          <Trash2 className="h-4 w-4 mr-2" />
          删除文件夹
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function MediaItemWithContextMenu({
  item,
  children,
  folders,
  onRemove,
  onExport,
  onRename,
  onMove,
  onSmartSplit,
  onGenerateScenes,
}: {
  item: MediaFile;
  children: React.ReactNode;
  folders: MediaFolder[];
  onRemove: (e: React.MouseEvent, id: string) => Promise<void>;
  onExport: (item: MediaFile) => void;
  onRename: (item: MediaFile) => void;
  onMove: (mediaId: string, folderId: string | null) => Promise<void>;
  onSmartSplit?: (item: MediaFile) => void;
  onGenerateScenes?: (item: MediaFile) => void;
}) {
  const isImage = item.type === "image";
  return (
    <ContextMenu>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {isImage && onSmartSplit && onGenerateScenes && <>
          <ContextMenuItem onClick={() => onSmartSplit(item)}><Scissors className="h-4 w-4 mr-2 text-yellow-500" />智能切割</ContextMenuItem>
          <ContextMenuItem onClick={() => onGenerateScenes(item)}><Film className="h-4 w-4 mr-2 text-blue-500" />分镜生成</ContextMenuItem>
          <ContextMenuSeparator />
        </>}
        <ContextMenuItem onClick={() => onRename(item)}><Pencil className="h-4 w-4 mr-2" />重命名</ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger><FolderInput className="h-4 w-4 mr-2" />移动到</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem onClick={() => onMove(item.id, null)}><Home className="h-4 w-4 mr-2" />根目录</ContextMenuItem>
            {folders.map((f) => <ContextMenuItem key={f.id} onClick={() => onMove(item.id, f.id)}><Folder className="h-4 w-4 mr-2" />{f.name}</ContextMenuItem>)}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onExport(item)}><Download className="h-4 w-4 mr-2" />导出</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem className="text-destructive" onClick={(e) => onRemove(e, item.id)}><Trash2 className="h-4 w-4 mr-2" />删除</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
