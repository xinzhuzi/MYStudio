// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
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
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { LocalImage } from "@/components/ui/local-image";
import type { StudioVisualManualDetail, StudioVisualManualImage } from "@/types/studio-visual-manual";
import { cn } from "@/lib/utils";
import { FolderOpen, ImageIcon, ImagePlus, Save, Trash2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

interface VisualManualEditorDialogProps {
  open: boolean;
  manual: StudioVisualManualDetail | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (manual: StudioVisualManualDetail) => void;
}

type EditableVisualManualImage = StudioVisualManualImage & {
  dataUrl?: string;
  isNew?: boolean;
};

export function VisualManualEditorDialog({
  open,
  manual,
  onOpenChange,
  onSaved,
}: VisualManualEditorDialogProps) {
  const [name, setName] = useState("");
  const [activeModule, setActiveModule] = useState("README");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savedDrafts, setSavedDrafts] = useState<Record<string, string>>({});
  const [images, setImages] = useState<EditableVisualManualImage[]>([]);
  const [savedImageKeys, setSavedImageKeys] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!manual) return;
    const nextDrafts = Object.fromEntries(manual.modules.map((module) => [module.value, module.content]));
    const nextImages = manual.images.map((image) => ({ ...image }));
    setName(manual.name);
    setActiveModule(manual.modules[0]?.value ?? "README");
    setDrafts(nextDrafts);
    setSavedDrafts(nextDrafts);
    setImages(nextImages);
    setSavedImageKeys(nextImages.map(getImageDirtyKey));
  }, [manual]);

  const selectedModule = useMemo(
    () => manual?.modules.find((module) => module.value === activeModule) ?? manual?.modules[0] ?? null,
    [activeModule, manual],
  );
  const isDirty = manual
    ? name !== manual.name
      || JSON.stringify(drafts) !== JSON.stringify(savedDrafts)
      || JSON.stringify(images.map(getImageDirtyKey)) !== JSON.stringify(savedImageKeys)
    : false;

  const updateDraft = (value: string) => {
    if (!selectedModule) return;
    setDrafts((current) => ({ ...current, [selectedModule.value]: value }));
  };

  const handleSave = async () => {
    if (!manual || !window.studioVisualManuals?.write) return;
    if (!name.trim()) {
      toast.error("请填写风格名称");
      return;
    }

    setIsSaving(true);
    try {
      const result = await window.studioVisualManuals.write(manual.stylePath, {
        name: name.trim(),
        modules: manual.modules.map((module) => ({
          value: module.value,
          content: drafts[module.value] ?? "",
        })),
        images: images.map((image) => ({
          relativePath: image.isNew ? undefined : image.relativePath,
          name: image.name,
          dataUrl: image.dataUrl,
        })),
      });
      if (!result.success || !result.manual) throw new Error(result.error || "保存视觉风格失败");
      const nextDrafts = Object.fromEntries(result.manual.modules.map((module) => [module.value, module.content]));
      const nextImages = result.manual.images.map((image) => ({ ...image }));
      setDrafts(nextDrafts);
      setSavedDrafts(nextDrafts);
      setImages(nextImages);
      setSavedImageKeys(nextImages.map(getImageDirtyKey));
      setName(result.manual.name);
      onSaved(result.manual);
      toast.success("视觉风格已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存视觉风格失败");
    } finally {
      setIsSaving(false);
    }
  };

  const openStoragePath = () => {
    if (!manual?.storagePath || !window.electronAPI?.openPath) return;
    void window.electronAPI.openPath(manual.storagePath);
  };

  const handleImageUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    if (selectedFiles.length === 0) return;

    try {
      const newImages = await Promise.all(selectedFiles.map(async (file) => {
        const dataUrl = await fileToDataUrl(file);
        return {
          name: file.name,
          relativePath: `new/${crypto.randomUUID()}/${file.name}`,
          filePath: "",
          url: dataUrl,
          dataUrl,
          isNew: true,
        };
      }));
      setImages((current) => [...current, ...newImages]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取参考图失败");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeImage = (relativePath: string) => {
    setImages((current) => current.filter((image) => image.relativePath !== relativePath));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(820px,calc(100vh-32px))] w-[min(1180px,calc(100vw-32px))] max-w-none flex-col p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <DialogTitle>视觉风格编辑</DialogTitle>
              <DialogDescription className="break-all">
                {manual?.storagePath ?? "当前环境未同步存储目录"}
              </DialogDescription>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {manual?.sourceExists ? <Badge variant="outline">Toonflow 副本</Badge> : <Badge variant="outline">新增</Badge>}
              {manual?.isCustomized ? <Badge variant="secondary">已改</Badge> : null}
              <Button variant="outline" size="sm" onClick={openStoragePath} disabled={!manual?.storagePath}>
                <FolderOpen className="mr-2 h-4 w-4" />
                打开目录
              </Button>
            </div>
          </div>
        </DialogHeader>

        {manual ? (
          <div className="grid min-h-0 flex-1 grid-cols-[270px_minmax(0,1fr)]">
            <aside className="flex min-h-0 flex-col border-r border-border bg-panel/60">
              <div className="space-y-3 border-b border-border p-4">
                <div className="space-y-1.5">
                  <Label htmlFor="visual-manual-name">风格名称</Label>
                  <Input
                    id="visual-manual-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                  <div>
                    <div className="font-medium text-foreground">{manual.moduleCount}</div>
                    <div>模块</div>
                  </div>
                  <div>
                    <div className="font-medium text-foreground">{manual.imageCount}</div>
                    <div>图片</div>
                  </div>
                  <div>
                    <div className="font-medium text-foreground">{manual.stylePath}</div>
                    <div>目录</div>
                  </div>
                </div>
              </div>

              <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-1 p-3">
                  {manual.modules.map((module) => {
                    const active = selectedModule?.value === module.value;
                    return (
                      <button
                        key={module.value}
                        type="button"
                        onClick={() => setActiveModule(module.value)}
                        className={cn(
                          "w-full rounded-md border px-3 py-2 text-left transition-colors",
                          active
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-transparent text-muted-foreground hover:border-border hover:bg-muted/60 hover:text-foreground",
                        )}
                      >
                        <div className="truncate text-sm font-medium">{module.label}</div>
                        <div className="mt-1 truncate text-[11px]">{module.relativePath}</div>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            </aside>

            <div className="flex min-h-0 min-w-0 flex-col">
              <div className="border-b border-border p-4">
                {images.length > 0 ? (
                  <div className="flex gap-3 overflow-x-auto pb-1">
                    {images.map((image) => (
                      <div key={image.relativePath} className="group relative h-24 w-32 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
                        <LocalImage src={image.url} alt={image.name} className="h-full w-full object-cover" />
                        <button
                          type="button"
                          className="absolute right-1 top-1 rounded bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
                          onClick={() => removeImage(image.relativePath)}
                          aria-label={`删除 ${image.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                        <div className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-2 py-1 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                          {image.name}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex h-20 items-center justify-center gap-2 rounded-md border border-dashed text-sm text-muted-foreground">
                    <ImageIcon className="h-4 w-4" />
                    暂无参考图
                  </div>
                )}
                <div className="mt-3 flex justify-end">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleImageUpload}
                  />
                  <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                    <ImagePlus className="mr-2 h-4 w-4" />
                    新增参考图
                  </Button>
                </div>
              </div>

              <ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1">
                <ResizablePanel defaultSize={52} minSize={34}>
                  <div className="flex h-full min-w-0 flex-col p-4 pr-2">
                    <div className="mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span>{selectedModule?.label ?? "模块"} 编辑</span>
                      <span className="truncate">{selectedModule?.relativePath}</span>
                    </div>
                    <Textarea
                      value={selectedModule ? drafts[selectedModule.value] ?? "" : ""}
                      onChange={(event) => updateDraft(event.target.value)}
                      className="h-full min-h-0 flex-1 resize-none font-mono text-xs leading-5"
                    />
                  </div>
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={48} minSize={32}>
                  <div className="flex h-full min-w-0 flex-col p-4 pl-2">
                    <div className="mb-2 text-xs font-medium text-muted-foreground">Markdown 预览</div>
                    <ScrollArea className="min-h-0 flex-1 rounded-md border bg-background">
                      <article className="max-w-none space-y-3 p-5 text-sm leading-7 text-foreground">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            h1: ({ children }) => <h1 className="text-xl font-semibold">{children}</h1>,
                            h2: ({ children }) => <h2 className="mt-5 text-lg font-semibold">{children}</h2>,
                            h3: ({ children }) => <h3 className="mt-4 text-base font-semibold">{children}</h3>,
                            p: ({ children }) => <p className="text-foreground/90">{children}</p>,
                            ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
                            ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
                            blockquote: ({ children }) => <blockquote className="border-l-2 pl-4 text-muted-foreground">{children}</blockquote>,
                            code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{children}</code>,
                            pre: ({ children }) => <pre className="overflow-auto rounded-md bg-muted p-3 text-xs leading-5">{children}</pre>,
                            table: ({ children }) => <table className="w-full border-collapse text-left text-xs">{children}</table>,
                            th: ({ children }) => <th className="border px-2 py-1 font-semibold">{children}</th>,
                            td: ({ children }) => <td className="border px-2 py-1 align-top">{children}</td>,
                          }}
                        >
                          {selectedModule ? drafts[selectedModule.value] ?? "" : ""}
                        </ReactMarkdown>
                      </article>
                    </ScrollArea>
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">请选择视觉风格</div>
        )}

        <DialogFooter className="border-t border-border px-5 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
          <Button onClick={handleSave} disabled={!manual || !isDirty || isSaving}>
            <Save className="mr-2 h-4 w-4" />
            {isSaving ? "保存中" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("读取参考图失败"));
    reader.readAsDataURL(file);
  });
}

function getImageDirtyKey(image: EditableVisualManualImage) {
  return image.isNew
    ? `new:${image.name}:${image.dataUrl?.length ?? 0}`
    : image.relativePath;
}
