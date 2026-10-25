"use client";

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { getPromptLayers, listPromptLayerKinds } from "@/lib/studio/asset-prompt-layers";
import type { AssetImageKind } from "@/types/studio-assets";

/**
 * 源提示词 JSON 弹窗(10-26 用户令:「展示个按钮直接弹窗展示json数据」):
 * 选型→逐型展示 qi21_bases.json 原始条目(JSON.stringify 2 空格缩进,只读);
 * 底座恒展示(全部型共用);不做前端美化——用户裁定不做复杂 UI,直出原始数据。
 */
export function StudioAssetSourcePromptDialog({
  open,
  onOpenChange,
  initialKind,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialKind?: AssetImageKind | null;
}) {
  const allKinds = useMemo(() => listPromptLayerKinds(), []);
  const [kind, setKind] = useState<string>(initialKind ?? allKinds[0] ?? "");

  const typeJson = useMemo(() => {
    if (!kind) return "";
    const layers = getPromptLayers(kind);
    if (!layers) return "(该型无条目)";
    // 只展示型层(不含底座——底座单独一节);排除内部下划线字段
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(layers.type)) {
      if (!k.startsWith("_")) clean[k] = v;
    }
    return JSON.stringify(clean, null, 2);
  }, [kind]);

  const baseJson = useMemo(() => {
    const layers = kind ? getPromptLayers(kind) : null;
    if (!layers) return "";
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(layers.base)) {
      if (!k.startsWith("_")) clean[k] = v;
    }
    return JSON.stringify(clean, null, 2);
  }, [kind]);

  const copyJson = (text: string, label: string) => {
    if (!text) return;
    void navigator.clipboard?.writeText(text).then(
      () => toast.success(`已复制${label}`),
      () => toast.error("复制失败"),
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] w-[720px]! max-w-[720px]! flex-col overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="text-base">源提示词</DialogTitle>
          <DialogDescription className="sr-only">
            查看该型在 qi21_bases.json 中的原始提示词数据。
          </DialogDescription>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">型</span>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger className="h-6 w-auto gap-1 px-2 py-0 text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {allKinds.map((k) => (
                  <SelectItem key={k} value={k} className="text-xs">{k}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </DialogHeader>
        <ScrollArea className="studio-asset-prompt-text-scrollbar min-h-0 flex-1 [&>[data-radix-scroll-area-viewport]>div]:block!">
          <div className="space-y-3 p-5">
            <section className="space-y-1" aria-label="型层 JSON">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground">型层(qi21_bases.json)</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 text-[11px]"
                  onClick={() => copyJson(typeJson, "型层 JSON")}
                >
                  <Copy className="h-3 w-3" />
                  复制
                </Button>
              </div>
              <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap rounded-md border border-border/60 bg-muted/30 p-2.5 text-[11px] leading-5 text-foreground/90">
                {typeJson}
              </pre>
            </section>
            <section className="space-y-1" aria-label="底座 JSON">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground">美术风格底座(全部型共用)</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 text-[11px]"
                  onClick={() => copyJson(baseJson, "底座 JSON")}
                >
                  <Copy className="h-3 w-3" />
                  复制
                </Button>
              </div>
              <pre className="max-h-[30vh] overflow-auto whitespace-pre-wrap rounded-md border border-border/60 bg-muted/30 p-2.5 text-[11px] leading-5 text-foreground/90">
                {baseJson}
              </pre>
            </section>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
