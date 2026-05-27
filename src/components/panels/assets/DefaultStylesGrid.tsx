// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import type {
  StudioVisualManualCategory,
  StudioVisualManualDetail,
  StudioVisualManualSummary,
} from "@/types/studio-visual-manual";
import { ChevronDown, ChevronRight, Loader2, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { StyleCard } from "./StyleCard";
import { VisualManualEditorDialog } from "./VisualManualEditorDialog";

const CATEGORY_LABELS: Record<StudioVisualManualCategory, string> = {
  daojie: "道劫专属",
  "2d": "2D 风格",
  "3d": "3D 风格",
  real: "真人风格",
  other: "其他风格",
};

const CATEGORY_ORDER: StudioVisualManualCategory[] = ["daojie", "2d", "3d", "real", "other"];

export function DefaultStylesGrid() {
  const [manuals, setManuals] = useState<StudioVisualManualSummary[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<Set<StudioVisualManualCategory>>(
    new Set(CATEGORY_ORDER),
  );
  const [selectedManual, setSelectedManual] = useState<StudioVisualManualDetail | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createPath, setCreatePath] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const groupedManuals = useMemo(() => {
    const groups = new Map<StudioVisualManualCategory, StudioVisualManualSummary[]>();
    for (const category of CATEGORY_ORDER) groups.set(category, []);
    for (const manual of manuals) groups.get(manual.category)?.push(manual);
    return CATEGORY_ORDER
      .map((category) => ({ category, manuals: groups.get(category) ?? [] }))
      .filter((group) => group.manuals.length > 0);
  }, [manuals]);

  const loadManuals = async () => {
    if (!window.studioVisualManuals?.list) {
      toast.error("当前环境不支持读取视觉风格，请在 Electron 中打开");
      return;
    }
    setIsLoading(true);
    try {
      const result = await window.studioVisualManuals.list();
      setManuals(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取视觉风格失败");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadManuals();
  }, []);

  const toggleCategory = (id: StudioVisualManualCategory) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openManual = async (manual: StudioVisualManualSummary) => {
    if (!window.studioVisualManuals?.read) {
      toast.error("当前环境不支持编辑视觉风格，请在 Electron 中打开");
      return;
    }
    setIsLoading(true);
    try {
      const result = await window.studioVisualManuals.read(manual.stylePath);
      if (!result.success || !result.manual) throw new Error(result.error || "读取视觉风格失败");
      setSelectedManual(result.manual);
      setIsEditorOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取视觉风格失败");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!window.studioVisualManuals?.create) {
      toast.error("当前环境不支持新增视觉风格，请在 Electron 中打开");
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
      const result = await window.studioVisualManuals.create({
        name,
        stylePath,
      });
      if (!result.success || !result.manual) throw new Error(result.error || "新增视觉风格失败");
      setManuals((current) => [...current.filter((item) => item.stylePath !== result.manual!.stylePath), result.manual!]);
      setSelectedManual(result.manual);
      setCreateName("");
      setCreatePath("");
      setIsCreateOpen(false);
      setIsEditorOpen(true);
      toast.success("视觉风格已新增");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "新增视觉风格失败");
    } finally {
      setIsCreating(false);
    }
  };

  const handleSaved = (manual: StudioVisualManualDetail) => {
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

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">Toonflow 视觉风格</h2>
          <div className="mt-1 text-xs text-muted-foreground">来自当前存储目录的 skills/art_skills，可直接编辑存储副本</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline">{manuals.length} 个</Badge>
          <Button variant="outline" size="sm" onClick={loadManuals} disabled={isLoading}>
            <RefreshCw className={isLoading ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"} />
            刷新
          </Button>
          <Button size="sm" onClick={() => setIsCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            新增风格
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-4">
          {isLoading && manuals.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              正在读取视觉风格
            </div>
          ) : null}

          {!isLoading && manuals.length === 0 ? (
            <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
              当前存储目录还没有视觉风格
            </div>
          ) : null}

          {groupedManuals.map((group) => (
            <div key={group.category}>
              <button
                className="flex w-full items-center gap-1.5 py-1 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => toggleCategory(group.category)}
              >
                {expandedCategories.has(group.category) ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                {CATEGORY_LABELS[group.category]}
                <span className="ml-1 text-muted-foreground/60">({group.manuals.length})</span>
              </button>

              {expandedCategories.has(group.category) && (
                <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {group.manuals.map((manual) => (
                    <StyleCard
                      key={manual.stylePath}
                      name={manual.name}
                      description={manual.description || `${manual.moduleCount} 个模块 / ${manual.imageCount} 张图`}
                      thumbnailSrc={manual.images[0]?.url}
                      isSelected={selectedManual?.stylePath === manual.stylePath}
                      onClick={() => void openManual(manual)}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>

      <VisualManualEditorDialog
        open={isEditorOpen}
        manual={selectedManual}
        onOpenChange={setIsEditorOpen}
        onSaved={handleSaved}
      />

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="w-[min(560px,calc(100vw-32px))] max-w-none">
          <DialogHeader>
            <DialogTitle>新增视觉风格</DialogTitle>
            <DialogDescription>新风格会写入当前存储目录的 skills/art_skills 下，不会修改内置种子。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="visual-style-name">风格名称</Label>
              <Input
                id="visual-style-name"
                value={createName}
                onChange={(event) => {
                  setCreateName(event.target.value);
                  if (!createPath) setCreatePath(makeDefaultStylePath(event.target.value));
                }}
                placeholder="例如：道劫新水墨风格"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="visual-style-path">目录名</Label>
              <Input
                id="visual-style-path"
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
            <Button onClick={handleCreate} disabled={isCreating}>
              {isCreating ? "新增中" : "新增"}
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
