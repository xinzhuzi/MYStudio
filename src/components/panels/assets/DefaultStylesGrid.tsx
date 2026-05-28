// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  getDefaultVisualManuals,
  groupDefaultVisualManuals,
  type DefaultVisualManualGroup,
} from "@/lib/studio/visual-manual-classification";
import type { StudioVisualManualDetail, StudioVisualManualSummary } from "@/types/studio-visual-manual";
import { ChevronDown, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { StyleCard } from "./StyleCard";
import { VisualManualEditorDialog } from "./VisualManualEditorDialog";

export const DEFAULT_STYLES_PANEL_COPY = {
  title: "默认风格",
} as const;

export function DefaultStylesGrid() {
  const [manuals, setManuals] = useState<StudioVisualManualSummary[]>([]);
  const manualGroups = useMemo(() => groupDefaultVisualManuals(manuals), [manuals]);
  const defaultManualCount = useMemo(() => getDefaultVisualManuals(manuals).length, [manuals]);
  const [expandedManualCategories, setExpandedManualCategories] = useState<Set<string>>(new Set());
  const [selectedManual, setSelectedManual] = useState<StudioVisualManualDetail | null>(null);
  const [isManualEditorOpen, setIsManualEditorOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const loadManuals = async () => {
    if (!window.studioVisualManuals?.list) {
      toast.error("当前环境不支持读取默认风格，请在 Electron 中打开");
      return;
    }
    setIsLoading(true);
    try {
      const result = await window.studioVisualManuals.list();
      setManuals(result);
      setExpandedManualCategories(new Set(groupDefaultVisualManuals(result).map((group) => group.id)));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取默认风格失败");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadManuals();
  }, []);

  const toggleManualCategory = (id: string) => {
    setExpandedManualCategories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openManualDetail = async (manual: StudioVisualManualSummary) => {
    if (!window.studioVisualManuals?.read) {
      toast.error("当前环境不支持编辑默认风格，请在 Electron 中打开");
      return;
    }
    setIsLoading(true);
    try {
      const result = await window.studioVisualManuals.read(manual.stylePath);
      if (!result.success || !result.manual) throw new Error(result.error || "读取默认风格失败");
      setSelectedManual(result.manual);
      setIsManualEditorOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取默认风格失败");
    } finally {
      setIsLoading(false);
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

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{DEFAULT_STYLES_PANEL_COPY.title}</h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline">{defaultManualCount} 个</Badge>
          <Button variant="outline" size="sm" onClick={loadManuals} disabled={isLoading}>
            <RefreshCw className={isLoading ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"} />
            刷新
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-4">
          {isLoading && manuals.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              正在读取默认风格
            </div>
          ) : null}

          {manualGroups.length > 0 ? (
            <section className="space-y-3">
              {manualGroups.map((group) => (
                <DefaultManualGroupSection
                  key={group.id}
                  group={group}
                  selectedStylePath={selectedManual?.stylePath ?? null}
                  expanded={expandedManualCategories.has(group.id)}
                  onToggle={() => toggleManualCategory(group.id)}
                  onOpenManual={(manual) => void openManualDetail(manual)}
                />
              ))}
            </section>
          ) : !isLoading ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              暂无默认风格
            </div>
          ) : null}
        </div>
      </ScrollArea>

      <VisualManualEditorDialog
        open={isManualEditorOpen}
        manual={selectedManual}
        manualKind="default"
        onOpenChange={setIsManualEditorOpen}
        onSaved={handleManualSaved}
      />
    </div>
  );
}

function DefaultManualGroupSection({
  group,
  selectedStylePath,
  expanded,
  onToggle,
  onOpenManual,
}: {
  group: DefaultVisualManualGroup;
  selectedStylePath: string | null;
  expanded: boolean;
  onToggle: () => void;
  onOpenManual: (manual: StudioVisualManualSummary) => void;
}) {
  return (
    <div>
      <button
        className="flex w-full items-center gap-1.5 py-1 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        onClick={onToggle}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        {group.name}
        <span className="ml-1 text-muted-foreground/60">({group.manuals.length})</span>
      </button>

      {expanded ? (
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {group.manuals.map((manual) => (
            <StyleCard
              key={manual.stylePath}
              name={manual.name}
              description={manual.description || `${manual.moduleCount} 个模块 / ${manual.imageCount} 张图`}
              thumbnailSrc={manual.images[0]?.url}
              isSelected={selectedStylePath === manual.stylePath}
              onClick={() => onOpenManual(manual)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
