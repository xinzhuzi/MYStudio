// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { Image as ImageIcon, ImagePlus, LayoutGrid, Pencil, Plus, Trash2, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ImageWorkflowGraph } from "@/types/studio";

/**
 * 图片工作室画布顶部工具栏:画布切换/管理 + 节点组快捷添加 + 整理布局 +
 * 历史抽屉开关。
 */
export function ImageStudioToolbar({
  workflows,
  activeWorkflowId,
  historyOpen,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
  onAddTextToImage,
  onAddImageToImage,
  onAddReference,
  onAddPrompt,
  onTidy,
  onToggleHistory,
}: {
  workflows: ImageWorkflowGraph[];
  activeWorkflowId: string | null;
  historyOpen: boolean;
  onSwitch: (workflowId: string) => void;
  onCreate: () => void;
  onRename: () => void;
  onDelete: () => void;
  onAddTextToImage: () => void;
  onAddImageToImage: () => void;
  onAddReference: () => void;
  onAddPrompt: () => void;
  onTidy: () => void;
  onToggleHistory: () => void;
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
      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onCreate} title="新建画布">
        <Plus className="h-4 w-4" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8"
        onClick={onRename}
        disabled={!activeWorkflowId}
        title="重命名当前画布"
      >
        <Pencil className="h-4 w-4" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8"
        onClick={onDelete}
        disabled={!activeWorkflowId}
        title="删除当前画布"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
      <div className="mx-1 h-5 w-px bg-border" />
      <Button size="sm" variant="secondary" className="h-8" onClick={onAddTextToImage} data-image-studio-add-t2i>
        <Type className="mr-1 h-3.5 w-3.5" />
        文生图
      </Button>
      <Button size="sm" variant="secondary" className="h-8" onClick={onAddImageToImage} data-image-studio-add-i2i>
        <ImagePlus className="mr-1 h-3.5 w-3.5" />
        图生图
      </Button>
      <Button size="sm" variant="ghost" className="h-8" onClick={onAddReference} data-image-studio-add-reference>
        <ImageIcon className="mr-1 h-3.5 w-3.5" />
        参考图
      </Button>
      <Button size="sm" variant="ghost" className="h-8" onClick={onAddPrompt}>
        <Type className="mr-1 h-3.5 w-3.5" />
        提示词
      </Button>
      <div className="flex-1" />
      <Button size="sm" variant="ghost" className="h-8" onClick={onTidy} title="按参考图/提示词/成图三列重排全部节点">
        <LayoutGrid className="mr-1 h-3.5 w-3.5" />
        整理布局
      </Button>
      <Button
        size="sm"
        variant={historyOpen ? "secondary" : "ghost"}
        className="h-8"
        onClick={onToggleHistory}
        data-image-studio-history-toggle
      >
        生成记录
      </Button>
    </div>
  );
}
