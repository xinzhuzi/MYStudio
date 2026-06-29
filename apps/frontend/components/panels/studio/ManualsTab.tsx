import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { StudioManualCatalog } from "@/lib/studio/manuals";
import type { StudioManualPreset, StudioWorkflowConfig } from "@/types/studio";
import { BookMarked, Check, Edit3, Palette } from "lucide-react";
import { cn } from "@/lib/utils";
import { ManualEditDialog } from "./ManualEditDialog";

export function ManualsTab(props: {
  workflowConfig: StudioWorkflowConfig;
  setWorkflowConfig: (updates: Partial<StudioWorkflowConfig>) => void;
  manualCatalog: StudioManualCatalog;
}) {
  const visualManuals = props.manualCatalog.visual ?? [];
  const directorManuals = props.manualCatalog.director ?? [];
  const [editing, setEditing] = useState<{
    kind: "visual" | "director";
    manual: StudioManualPreset;
  } | null>(null);

  return (
    <div className="grid grid-cols-[320px_1fr] gap-5">
      {/* 左：项目配置（ToonFlow 风格）*/}
      <Card className="h-fit rounded-lg">
        <CardHeader>
          <CardTitle className="text-sm">项目配置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">项目类型</Label>
            <select
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={props.workflowConfig.projectType ?? "novel"}
              onChange={(e) =>
                props.setWorkflowConfig({ projectType: e.target.value })
              }
            >
              <option value="novel">基于小说原文</option>
              <option value="script">基于剧本</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              单集时长（分钟）
            </Label>
            <Input
              type="number"
              min={1}
              value={props.workflowConfig.episodeDurationMin ?? 3}
              onChange={(e) =>
                props.setWorkflowConfig({
                  episodeDurationMin: e.target.value
                    ? Number(e.target.value)
                    : undefined,
                })
              }
              className="h-8"
              placeholder="例如 3"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">集数</Label>
            <Input
              type="number"
              min={1}
              value={props.workflowConfig.episodeCount ?? ""}
              onChange={(e) =>
                props.setWorkflowConfig({
                  episodeCount: e.target.value
                    ? Number(e.target.value)
                    : undefined,
                })
              }
              className="h-8"
              placeholder="例如 12"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">小说类型</Label>
            <Input
              value={props.workflowConfig.novelGenre ?? ""}
              onChange={(e) =>
                props.setWorkflowConfig({
                  novelGenre: e.target.value || undefined,
                })
              }
              className="h-8"
              placeholder="例如 玄幻、科幻、言情"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">平台规格</Label>
            <select
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={props.workflowConfig.platformSpec ?? ""}
              onChange={(e) =>
                props.setWorkflowConfig({
                  platformSpec: e.target.value || undefined,
                })
              }
            >
              <option value="">未选择</option>
              <option value="16:9">16:9 横屏</option>
              <option value="9:16">9:16 竖屏</option>
              <option value="1:1">1:1 方形</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">小说简介</Label>
            <Textarea
              value={props.workflowConfig.novelSynopsis ?? ""}
              onChange={(e) =>
                props.setWorkflowConfig({
                  novelSynopsis: e.target.value || undefined,
                })
              }
              className="min-h-[120px] text-sm"
              placeholder="请输入小说简介"
            />
          </div>
        </CardContent>
      </Card>

      {/* 右：视觉手册 + 导演手册 */}
      <div className="space-y-5">
        {/* 视觉手册网格 */}
        <section>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Palette className="h-4 w-4" /> 视觉手册（画风）
            <span className="text-xs font-normal text-muted-foreground">
              {visualManuals.length} 个 · 点击选择
            </span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
            {visualManuals.map((manual) => {
              const active = manual.id === props.workflowConfig.visualManualId;
              return (
                <div
                  key={manual.id}
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    props.setWorkflowConfig({
                      visualManualId: active ? undefined : manual.id,
                    })
                  }
                  className={cn(
                    "group relative cursor-pointer overflow-hidden rounded-lg border bg-card text-left transition-colors",
                    active
                      ? "border-primary ring-2 ring-primary/30"
                      : "border-border hover:border-primary/40",
                  )}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditing({ kind: "visual", manual });
                    }}
                    className="absolute right-1.5 top-1.5 z-10 hidden rounded-md bg-background/90 p-1 shadow group-hover:block hover:text-primary"
                    title="编辑文档"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                  </button>
                  <div className="aspect-video overflow-hidden bg-muted">
                    {manual.images?.[0] ? (
                      <img
                        src={manual.images[0]}
                        alt={manual.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <Palette className="h-6 w-6 opacity-30" />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                    <span className="truncate text-xs font-medium">
                      {manual.name}
                    </span>
                    {active ? (
                      <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 导演手册网格 */}
        <section>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <BookMarked className="h-4 w-4" /> 导演手册
            <span className="text-xs font-normal text-muted-foreground">
              {directorManuals.length} 个 · 点击选择
            </span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
            {directorManuals.map((manual) => {
              const active =
                manual.id === props.workflowConfig.directorManualId;
              return (
                <div
                  key={manual.id}
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    props.setWorkflowConfig({
                      directorManualId: active ? undefined : manual.id,
                    })
                  }
                  className={cn(
                    "group relative cursor-pointer rounded-lg border p-3 text-left transition-colors",
                    active
                      ? "border-primary bg-primary/5 ring-2 ring-primary/30"
                      : "border-border hover:border-primary/40",
                  )}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditing({ kind: "director", manual });
                    }}
                    className="absolute right-1.5 top-1.5 z-10 hidden rounded-md bg-background/90 p-1 shadow group-hover:block hover:text-primary"
                    title="编辑文档"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                  </button>
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-sm font-medium">
                      {manual.name}
                    </span>
                    {active ? (
                      <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                    ) : null}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    导演叙事手法技能包
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      </div>
      <ManualEditDialog
        open={!!editing}
        kind={editing?.kind ?? "visual"}
        manual={editing?.manual ?? null}
        onOpenChange={(o) => {
          if (!o) setEditing(null);
        }}
      />
    </div>
  );
}
