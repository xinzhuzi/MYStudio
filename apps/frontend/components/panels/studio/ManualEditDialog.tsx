"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { getManualModuleKeys, getManualModuleRelativePath, getManualSkillSource } from "@/lib/studio/manuals";
import type { StudioManualPreset } from "@/types/studio";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

type ManualKind = "visual" | "director";

export function ManualEditDialog({
  open,
  kind,
  manual,
  onOpenChange,
}: {
  open: boolean;
  kind: ManualKind;
  manual: StudioManualPreset | null;
  onOpenChange: (open: boolean) => void;
}) {
  const moduleKeys = manual ? getManualModuleKeys(kind) : [];
  const [activeKey, setActiveKey] = useState<string>("README");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (manual) {
      setDrafts({ ...manual.modules });
      setActiveKey("README");
    }
  }, [manual]);

  if (!manual) return null;

  const handleSave = async () => {
    if (!window.studioSkills?.writeText) {
      toast.error("当前环境不支持编辑手册，请在桌面版中打开");
      return;
    }
    setSaving(true);
    const source = getManualSkillSource(kind);
    let saved = 0;
    try {
      for (const key of moduleKeys) {
        const next = drafts[key] ?? "";
        if (next === (manual.modules[key] ?? "")) continue;
        const relativePath = `${source}/${manual.id}/${getManualModuleRelativePath(kind, key)}`;
        const res = await window.studioSkills.writeText(relativePath, next);
        if (res?.success) {
          manual.modules[key] = next;
          saved += 1;
        }
      }
      toast.success(saved > 0 ? `已保存 ${saved} 个文档` : "没有改动");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>编辑{kind === "visual" ? "视觉风格" : "导演手册"}：{manual.name}</DialogTitle>
        </DialogHeader>
        {manual.images?.length ? (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {manual.images.map((src, i) => (
              <img key={i} src={src} alt={`${manual.name}-${i}`} className="h-16 w-24 shrink-0 rounded-md border object-cover" />
            ))}
          </div>
        ) : null}
        <div className="grid grid-cols-[180px_1fr] gap-3" style={{ height: "60vh" }}>
          <ScrollArea className="rounded-md border">
            <div className="p-1.5">
              {moduleKeys.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveKey(key)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                    activeKey === key ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted/50",
                  )}
                >
                  <span className="truncate">{key === "README" ? "说明 (README)" : key}</span>
                  {(drafts[key] ?? "").trim() ? <span className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" /> : null}
                </button>
              ))}
            </div>
          </ScrollArea>
          <Textarea
            value={drafts[activeKey] ?? ""}
            onChange={(e) => setDrafts((d) => ({ ...d, [activeKey]: e.target.value }))}
            className="h-full resize-none font-mono text-xs leading-5"
            placeholder="该文档暂无内容，可在此编辑"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
