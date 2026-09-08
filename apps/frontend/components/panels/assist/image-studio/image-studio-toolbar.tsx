// Copyright © 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import {
  Download,
  Flame as FlameIcon,
  FolderOpen,
  Image as ImageIcon,
  ImagePlus,
  LayoutGrid,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Shirt as ShirtIcon,
  Type,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ImageWorkflowGraph } from "@/types/studio";

/**
 * 图片工作室画布顶部工具栏(09-02 分族收敛:14 控件→6)。
 * 布局=画布切换 + 主操作「文生图」一键直达 + 添加族下拉(图生图/参考图/提示词)
 * + 面板开关(助手/生成记录) + 管理与工具下拉(布局/文件夹/画布管理/导入导出)。
 * 高频主操作不进菜单;同功能族合并;破坏性操作(删画布)收进菜单远离日常区。
 */
export function ImageStudioToolbar({
  workflows,
  activeWorkflowId,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
  onAddTextToImage,
  onAddImageToImage,
  onAddReference,
  onAddUncloth,
  onAddUnclothMask,
  onAddNsfw,
  onAddPrompt,
  onTidy,
  onOpenHistory,
  onOpenAssistant,
  onOpenComfyBrowser,
  onExport,
  onImport,
  onOpenFolder
}: {
  workflows: ImageWorkflowGraph[];
  activeWorkflowId: string | null;
  onSwitch: (workflowId: string) => void;
  onCreate: () => void;
  onRename: () => void;
  onDelete: () => void;
  onAddTextToImage: () => void;
  onAddImageToImage: () => void;
  onAddReference: () => void;
  onAddUncloth: () => void;
  onAddUnclothMask: () => void;
  onAddNsfw: () => void;
  onAddPrompt: () => void;
  onTidy: () => void;
  onOpenHistory: () => void;
  onOpenAssistant: () => void;
  /** ComfyUI 工作流浏览器(09-08 二期):可选=宿主未接时不显示 */
  onOpenComfyBrowser?: () => void;
  onExport?: () => void;
  onImport?: () => void;
  onOpenFolder: () => void;
}) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b bg-background px-3">
      <Select value={activeWorkflowId ?? ""} onValueChange={onSwitch}>
        <SelectTrigger className="h-8 w-[168px] text-xs" aria-label="切换画布">
          <SelectValue placeholder="选择画布" />
        </SelectTrigger>
        <SelectContent>
          {workflows.map((workflow) => (
            <SelectItem key={workflow.id} value={workflow.id} className="text-xs">
              {workflow.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="secondary"
            className="h-8"
            aria-label="添加节点"
            title="文生图 / 图生图 / 参考图 / 提示词节点"
            data-image-studio-add-more
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            添加
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={onAddTextToImage} data-image-studio-add-t2i>
            <Type className="mr-2 h-3.5 w-3.5" />
            文生图
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onAddImageToImage} data-image-studio-add-i2i>
            <ImagePlus className="mr-2 h-3.5 w-3.5" />
            图生图
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={onAddUncloth}
            data-image-studio-add-uncloth
            title="稳定版:Krea2Edit 指令编辑(①编辑指令/②一致性描述),不吃重绘/锚定词头"
          >
            <ShirtIcon className="mr-2 h-3.5 w-3.5" />
            无衣物·稳定
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={onAddUnclothMask}
            data-image-studio-add-uncloth-mask
            title="遮罩版:双分割+两遍采样+色彩对齐(Krea2_无衣物_遮罩 同构);提示词写「重绘:…;锚定:…」全文"
          >
            <ShirtIcon className="mr-2 h-3.5 w-3.5" />
            无衣物·遮罩
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onAddNsfw} data-image-studio-add-nsfw>
            <FlameIcon className="mr-2 h-3.5 w-3.5" />
            NSFW破限
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onAddReference} data-image-studio-add-reference>
            <ImageIcon className="mr-2 h-3.5 w-3.5" />
            参考图节点
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onAddPrompt}>
            <Type className="mr-2 h-3.5 w-3.5" />
            提示词节点
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="flex-1" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            aria-label="画布与工具菜单"
            title="布局 / 生成文件夹 / 画布管理 / 导入导出"
            data-image-studio-tools-menu
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={onOpenHistory}
            data-image-studio-history-toggle
            title="弹窗查看历史生成,可一键复原到画布"
          >
            生成记录…
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={onOpenAssistant}
            data-image-studio-assistant-toggle
            title="选中节点后对话,回答可插为提示词节点或直接生图"
          >
            画布助手…
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={onOpenComfyBrowser}
            disabled={!onOpenComfyBrowser}
            data-image-studio-comfy-browser-toggle
            title="ComfyUI 工作流库:搜索/文件夹/外部导入,完整管理自管实例的工作流"
          >
            工作流库…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onTidy} title="按参考图/提示词/成图三列重排全部节点">
            <LayoutGrid className="mr-2 h-3.5 w-3.5" />
            整理布局
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onOpenFolder} data-image-studio-open-folder title="媒体库 ai-image 分类">
            <FolderOpen className="mr-2 h-3.5 w-3.5" />
            打开生成文件夹
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onCreate}>
            <Plus className="mr-2 h-3.5 w-3.5" />
            新建画布
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onRename} disabled={!activeWorkflowId}>
            <Pencil className="mr-2 h-3.5 w-3.5" />
            重命名当前画布
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={onDelete}
            disabled={!activeWorkflowId}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            删除当前画布
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onExport} disabled={!onExport} title="当前画布导出为 JSON">
            <Download className="mr-2 h-3.5 w-3.5" />
            导出画布
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onImport} disabled={!onImport} title="从 JSON 导入为新画布">
            <Upload className="mr-2 h-3.5 w-3.5" />
            导入画布
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
