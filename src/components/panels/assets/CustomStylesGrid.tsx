// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * CustomStylesGrid - 自定义风格网格
 * 展示本地 skills 副本中的视觉风格，保留旧版 localStorage 风格数据
 */

import { useEffect, useMemo, useState } from "react";
import { useCustomStyleStore } from "@/stores/custom-style-store";
import { StyleCard } from "./StyleCard";
import { StyleEditor } from "./StyleEditor";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCustomVisualManuals } from "@/lib/studio/visual-manual-classification";
import type { StudioVisualManualDetail, StudioVisualManualSummary } from "@/types/studio-visual-manual";
import { Copy, Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { VisualManualEditorDialog } from "./VisualManualEditorDialog";

export const CUSTOM_STYLES_PANEL_COPY = {
  title: "我的风格",
  manualSectionTitle: "本地风格",
  legacySectionTitle: "旧版自定义风格",
  createDescription: "新风格会保存到当前本地存储目录的 skills/art_skills 下，不写入包体内置资源。",
} as const;
export { getCustomVisualManuals };

export function CustomStylesGrid() {
  const {
    styles,
    selectedStyleId,
    editingStyleId,
    selectStyle,
    setEditingStyle,
    deleteStyle,
    duplicateStyle,
  } = useCustomStyleStore();
  const [manuals, setManuals] = useState<StudioVisualManualSummary[]>([]);
  const [selectedManual, setSelectedManual] = useState<StudioVisualManualDetail | null>(null);
  const [isManualEditorOpen, setIsManualEditorOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createPath, setCreatePath] = useState("");
  const [createSourcePath, setCreateSourcePath] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [allManuals, setAllManuals] = useState<StudioVisualManualSummary[]>([]);

  const totalCount = manuals.length + styles.length;
  const sortedManuals = useMemo(
    () => [...manuals].sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN")),
    [manuals],
  );

  const loadManuals = async () => {
    if (!window.studioVisualManuals?.list) {
      toast.error("当前环境不支持读取我的风格，请在 Electron 中打开");
      return;
    }
    setIsLoading(true);
    try {
      const result = await window.studioVisualManuals.list();
      setManuals(getCustomVisualManuals(result));
      setAllManuals(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取我的风格失败");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadManuals();
  }, []);

  const openManual = async (manual: StudioVisualManualSummary) => {
    if (!window.studioVisualManuals?.read) {
      toast.error("当前环境不支持编辑我的风格，请在 Electron 中打开");
      return;
    }
    setIsLoading(true);
    try {
      const result = await window.studioVisualManuals.read(manual.stylePath);
      if (!result.success || !result.manual) throw new Error(result.error || "读取我的风格失败");
      setSelectedManual(result.manual);
      setIsManualEditorOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取我的风格失败");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateManual = async () => {
    if (!window.studioVisualManuals?.create) {
      toast.error("当前环境不支持新增我的风格，请在 Electron 中打开");
      return;
    }
    const name = createName.trim();
    const stylePath = normalizeCreatePath(createPath || name);
    if (!name) {
      toast.error("请填写风格名称");
      return;
    }
    if (!stylePath) {
      toast.error("请填写有效目录名");
      return;
    }

    setIsCreating(true);
    try {
      let result: { success: boolean; manual?: StudioVisualManualDetail; error?: string };
      if (createSourcePath && window.studioVisualManuals.duplicate) {
        result = await window.studioVisualManuals.duplicate({
          sourceStylePath: createSourcePath,
          name,
          stylePath,
        });
      } else {
        result = await window.studioVisualManuals.create({ name, stylePath });
      }
      if (!result.success || !result.manual) throw new Error(result.error || "新增我的风格失败");
      setManuals((current) => [...current.filter((item) => item.stylePath !== result.manual!.stylePath), result.manual!]);
      setSelectedManual(result.manual);
      setCreateName("");
      setCreatePath("");
      setCreateSourcePath("");
      setIsCreateOpen(false);
      setIsManualEditorOpen(true);
      toast.success(createSourcePath ? "已从默认风格复制创建" : "我的风格已新增");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "新增我的风格失败");
    } finally {
      setIsCreating(false);
    }
  };

  const handleManualSaved = (manual: StudioVisualManualDetail) => {
    setSelectedManual(manual);
    setManuals((current) => current.map((item) => (
      item.stylePath === manual.stylePath
        ? {
          ...item,
          name: manual.name,
          description: manual.description,
          moduleCount: manual.moduleCount,
          imageCount: manual.imageCount,
          images: manual.images,
          isCustomized: manual.isCustomized,
        }
        : item
    )));
  };

  // 正在编辑 → 显示编辑器
  if (editingStyleId !== null) {
    return (
      <StyleEditor
        styleId={editingStyleId}
        onClose={() => setEditingStyle(null)}
      />
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* 顶部栏 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">{CUSTOM_STYLES_PANEL_COPY.title}</h2>
          <span className="text-xs text-muted-foreground">{totalCount} 个</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadManuals} disabled={isLoading}>
            <RefreshCw className={isLoading ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"} />
            刷新
          </Button>
          <Button size="sm" onClick={() => setIsCreateOpen(true)}>
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            新建风格
          </Button>
        </div>
      </div>

      {/* 内容区域 */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          {isLoading && totalCount === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              正在读取我的风格
            </div>
          ) : null}

          {!isLoading && totalCount === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <div className="text-sm mb-2">还没有自定义风格</div>
              <div className="text-xs mb-4">点击「新建风格」创建你的第一个风格</div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsCreateOpen(true)}
              >
                <Plus className="w-3.5 h-3.5 mr-1.5" />
                新建风格
              </Button>
            </div>
          ) : null}

          {sortedManuals.length > 0 ? (
            <section className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                {CUSTOM_STYLES_PANEL_COPY.manualSectionTitle}
                <Badge variant="outline">{sortedManuals.length}</Badge>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {sortedManuals.map((manual) => (
                  <StyleCard
                    key={manual.stylePath}
                    name={manual.name}
                    description={manual.description || `${manual.moduleCount} 个模块 / ${manual.imageCount} 张图`}
                    thumbnailSrc={manual.images[0]?.url}
                    isCustom
                    isSelected={selectedManual?.stylePath === manual.stylePath}
                    onClick={() => void openManual(manual)}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {styles.length > 0 ? (
            <section className="mt-6 space-y-3">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                {CUSTOM_STYLES_PANEL_COPY.legacySectionTitle}
                <Badge variant="outline">{styles.length}</Badge>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {styles.map((style) => (
                  <ContextMenu key={style.id}>
                    <ContextMenuTrigger>
                      <StyleCard
                        name={style.name}
                        description={style.description}
                        referenceImages={style.referenceImages}
                        isCustom
                        isSelected={selectedStyleId === style.id}
                        onClick={() => selectStyle(style.id)}
                        onDoubleClick={() => setEditingStyle(style.id)}
                      />
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem onClick={() => setEditingStyle(style.id)}>
                        <Pencil className="w-3.5 h-3.5 mr-2" />
                        编辑
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => duplicateStyle(style.id)}>
                        <Copy className="w-3.5 h-3.5 mr-2" />
                        复制
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        variant="destructive"
                        onClick={() => deleteStyle(style.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-2" />
                        删除
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </ScrollArea>

      <VisualManualEditorDialog
        open={isManualEditorOpen}
        manual={selectedManual}
        manualKind="custom"
        onOpenChange={setIsManualEditorOpen}
        onSaved={handleManualSaved}
      />

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="w-[min(560px,calc(100vw-32px))] max-w-none">
          <DialogHeader>
            <DialogTitle>新增风格</DialogTitle>
            <DialogDescription>{CUSTOM_STYLES_PANEL_COPY.createDescription}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="custom-visual-style-source">从默认风格复制（可选）</Label>
              <select
                id="custom-visual-style-source"
                className="w-full rounded-md border border-border bg-muted/20 px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                value={createSourcePath}
                onChange={(event) => {
                  setCreateSourcePath(event.target.value);
                  if (event.target.value) {
                    const source = allManuals.find((m) => m.stylePath === event.target.value);
                    if (source && !createName) setCreateName(source.name + "（副本）");
                  }
                }}
              >
                <option value="">空白创建</option>
                {allManuals.map((m) => (
                  <option key={m.stylePath} value={m.stylePath}>{m.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="custom-visual-style-name">风格名称</Label>
              <Input
                id="custom-visual-style-name"
                value={createName}
                onChange={(event) => {
                  setCreateName(event.target.value);
                  if (!createPath) setCreatePath(makeDefaultStylePath(event.target.value));
                }}
                placeholder="例如：道劫新水墨风格"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="custom-visual-style-path">目录名</Label>
              <Input
                id="custom-visual-style-path"
                value={createPath}
                onChange={(event) => setCreatePath(event.target.value)}
                placeholder="例如：daojie_new_ink"
              />
              <div className="break-all text-xs text-muted-foreground">
                将创建：skills/art_skills/{normalizeCreatePath(createPath || createName) || "无效目录名"}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>取消</Button>
            <Button onClick={handleCreateManual} disabled={isCreating}>
              {isCreating ? "新增中" : createSourcePath ? "复制创建" : "新增"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function makeDefaultStylePath(value: string) {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || `custom_style_${Date.now()}`;
}

function normalizeCreatePath(value: string) {
  const normalized = value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/g, "");
  if (!normalized || normalized === "." || normalized.includes("/") || normalized.includes("..")) return "";
  return normalized;
}
