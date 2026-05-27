// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SidebarToggleButton } from "@/components/ChromeControls";
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
import {
  STUDIO_SKILL_CATEGORY_LABELS,
  getStudioSkillCategory,
  listStudioSkillFiles,
  type StudioSkillFile,
  type StudioSkillFileCategory,
} from "@/lib/studio/skill-files";
import { cn } from "@/lib/utils";
import {
  BookOpenText,
  Clapperboard,
  FileText,
  Hammer,
  Palette,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

interface SkillsViewProps {
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

type EditableSkillFile = StudioSkillFile & {
  filePath?: string;
  storagePath?: string;
  sourcePath?: string;
  size?: number;
  updatedAt?: number;
  isCustomized?: boolean;
  sourceExists?: boolean;
};

const categoryFilters: Array<{ id: "all" | StudioSkillFileCategory; label: string }> = [
  { id: "all", label: "全部" },
  { id: "agent", label: STUDIO_SKILL_CATEGORY_LABELS.agent },
  { id: "visual", label: STUDIO_SKILL_CATEGORY_LABELS.visual },
  { id: "director", label: STUDIO_SKILL_CATEGORY_LABELS.director },
  { id: "production", label: STUDIO_SKILL_CATEGORY_LABELS.production },
];

const createCategoryOptions: Array<{ id: StudioSkillFileCategory; label: string; prefix: string }> = [
  { id: "agent", label: STUDIO_SKILL_CATEGORY_LABELS.agent, prefix: "agent_skills" },
  { id: "visual", label: STUDIO_SKILL_CATEGORY_LABELS.visual, prefix: "art_skills" },
  { id: "director", label: STUDIO_SKILL_CATEGORY_LABELS.director, prefix: "story_skills" },
  { id: "production", label: STUDIO_SKILL_CATEGORY_LABELS.production, prefix: "production_skills" },
];

export function SkillsView({
  sidebarCollapsed = false,
  onToggleSidebar,
}: SkillsViewProps) {
  const bundledFiles = useMemo<EditableSkillFile[]>(() => listStudioSkillFiles(), []);
  const [files, setFiles] = useState<EditableSkillFile[]>(bundledFiles);
  const [activeCategory, setActiveCategory] = useState<"all" | StudioSkillFileCategory>("all");
  const [query, setQuery] = useState("");
  const [selectedPath, setSelectedPath] = useState(() => bundledFiles[0]?.relativePath ?? "");
  const [draft, setDraft] = useState(() => bundledFiles[0]?.content ?? "");
  const [savedContent, setSavedContent] = useState(() => bundledFiles[0]?.content ?? "");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createCategory, setCreateCategory] = useState<StudioSkillFileCategory>("agent");
  const [createPath, setCreatePath] = useState("new_skill.md");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const selectedFile = useMemo(
    () => files.find((file) => file.relativePath === selectedPath) ?? files[0] ?? null,
    [files, selectedPath],
  );
  const isDirty = draft !== savedContent;
  const createRelativePath = useMemo(
    () => buildSkillCreatePath(createCategory, createPath),
    [createCategory, createPath],
  );

  const categoryCounts = useMemo(() => {
    const counts: Record<StudioSkillFileCategory, number> = {
      agent: 0,
      visual: 0,
      director: 0,
      production: 0,
      other: 0,
    };
    for (const file of files) counts[file.category] += 1;
    return counts;
  }, [files]);

  const filteredFiles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return files.filter((file) => {
      const categoryMatched = activeCategory === "all" || file.category === activeCategory;
      if (!categoryMatched) return false;
      if (!normalizedQuery) return true;
      return [
        file.title,
        file.relativePath,
        file.directory,
      ].some((value) => value.toLowerCase().includes(normalizedQuery));
    });
  }, [activeCategory, files, query]);

  const loadFile = useCallback(async (file: EditableSkillFile) => {
    setSelectedPath(file.relativePath);
    setIsLoading(true);
    try {
      if (window.studioSkills?.readText) {
        const result = await window.studioSkills.readText(file.relativePath);
        if (!result.success) throw new Error(result.error || "读取技能文件失败");
        const nextContent = result.content ?? "";
        setDraft(nextContent);
        setSavedContent(nextContent);
        setFiles((current) => current.map((item) => (
          item.relativePath === file.relativePath
            ? {
              ...item,
              content: nextContent,
              filePath: result.filePath ?? item.filePath,
              storagePath: result.storagePath ?? item.storagePath,
            }
            : item
        )));
      } else {
        setDraft(file.content);
        setSavedContent(file.content);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取技能文件失败");
      setDraft(file.content);
      setSavedContent(file.content);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!window.studioSkills?.list) return;
    let cancelled = false;
    window.studioSkills.list()
      .then((remoteFiles) => {
        if (cancelled) return;
        const bundledByPath = new Map(bundledFiles.map((file) => [file.relativePath, file]));
        const merged = remoteFiles.map((remote) => {
          const bundled = bundledByPath.get(remote.relativePath);
          const filename = remote.relativePath.split("/").at(-1) ?? remote.relativePath;
          const directory = remote.relativePath.includes("/") ? remote.relativePath.split("/").slice(0, -1).join("/") : "根级技能";
          return {
            id: remote.relativePath,
            relativePath: remote.relativePath,
            directory,
            filename,
            title: bundled?.title ?? filename.replace(/\.md$/, ""),
            category: bundled?.category ?? getStudioSkillCategory(remote.relativePath),
            content: bundled?.content ?? "",
            filePath: remote.filePath,
            storagePath: remote.storagePath,
            sourcePath: remote.sourcePath,
            size: remote.size,
            updatedAt: remote.updatedAt,
            isCustomized: remote.isCustomized,
            sourceExists: remote.sourceExists,
          };
        });
        if (merged.length > 0) {
          setFiles(merged);
          const nextFile = merged.find((file) => file.relativePath === selectedPath) ?? merged[0];
          if (nextFile) void loadFile(nextFile);
        }
      })
      .catch((error) => {
        console.warn("[SkillsView] Failed to list studio skills:", error);
      });
    return () => {
      cancelled = true;
    };
  }, [bundledFiles, loadFile]);

  const handleSelectFile = (file: EditableSkillFile) => {
    if (file.relativePath === selectedPath) return;
    if (isDirty && !window.confirm("当前技能尚未保存，切换文件会丢弃未保存内容。继续切换？")) return;
    void loadFile(file);
  };

  const handleReload = () => {
    if (!selectedFile) return;
    if (isDirty && !window.confirm("重新加载会丢弃未保存内容。继续？")) return;
    void loadFile(selectedFile);
  };

  const handleSave = async () => {
    if (!selectedFile) return;
    if (!window.studioSkills?.writeText) {
      toast.error("当前环境不支持写回技能文件，请在 Electron 中打开");
      return;
    }
    setIsSaving(true);
    try {
      const result = await window.studioSkills.writeText(selectedFile.relativePath, draft);
      if (!result.success) throw new Error(result.error || "保存技能文件失败");
      setSavedContent(draft);
      setFiles((current) => current.map((item) => (
        item.relativePath === selectedFile.relativePath
          ? {
            ...item,
            content: draft,
            filePath: result.filePath ?? item.filePath,
            storagePath: result.storagePath ?? item.storagePath,
            updatedAt: result.updatedAt ?? item.updatedAt,
            isCustomized: true,
          }
          : item
      )));
      toast.success("技能文件已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存技能文件失败");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreate = async () => {
    if (!window.studioSkills?.createText) {
      toast.error("当前环境不支持新增技能文件，请在 Electron 中打开");
      return;
    }
    const relativePath = createRelativePath;
    if (!relativePath) {
      toast.error("请填写有效的 Markdown 文件路径");
      return;
    }
    const initialContent = `# ${getSkillTitleFromPath(relativePath)}\n\n`;
    setIsSaving(true);
    try {
      const result = await window.studioSkills.createText(relativePath, initialContent);
      if (!result.success || !result.relativePath) throw new Error(result.error || "新增技能文件失败");
      const nextFile = makeEditableSkillFile(result.relativePath, initialContent, {
        filePath: result.filePath,
        storagePath: result.storagePath,
        size: result.size,
        updatedAt: result.updatedAt,
        isCustomized: result.isCustomized ?? true,
        sourceExists: result.sourceExists ?? false,
      });
      setFiles((current) => [...current.filter((item) => item.relativePath !== nextFile.relativePath), nextFile]);
      setSelectedPath(nextFile.relativePath);
      setDraft(initialContent);
      setSavedContent(initialContent);
      setIsCreateOpen(false);
      setCreatePath("new_skill.md");
      toast.success("技能文件已新增");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "新增技能文件失败");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedFile) return;
    if (!window.studioSkills?.deleteText) {
      toast.error("当前环境不支持删除技能文件，请在 Electron 中打开");
      return;
    }
    if (!window.confirm(`删除技能文件：${selectedFile.relativePath}\n删除后会记录在存储目录中，不会修改内置种子。继续？`)) return;
    setIsSaving(true);
    try {
      const result = await window.studioSkills.deleteText(selectedFile.relativePath);
      if (!result.success) throw new Error(result.error || "删除技能文件失败");
      const remaining = files.filter((item) => item.relativePath !== selectedFile.relativePath);
      setFiles(remaining);
      const nextFile = remaining[0] ?? null;
      setSelectedPath(nextFile?.relativePath ?? "");
      setDraft(nextFile?.content ?? "");
      setSavedContent(nextFile?.content ?? "");
      if (nextFile) void loadFile(nextFile);
      toast.success("技能文件已删除");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除技能文件失败");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="skills-workspace flex h-full flex-col overflow-hidden bg-background">
      <div className="h-16 shrink-0 border-b border-border bg-panel px-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          {sidebarCollapsed && onToggleSidebar && (
            <SidebarToggleButton
              sidebarCollapsed
              onToggleSidebar={onToggleSidebar}
            />
          )}
          <h2 className="text-lg font-bold text-foreground flex items-center gap-3">
            <BookOpenText className="h-5 w-5 text-primary" />
            技能编辑
          </h2>
          <Badge variant="outline">{files.length} 个 Markdown</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setIsCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            新增
          </Button>
          <Button variant="outline" size="sm" onClick={handleDelete} disabled={!selectedFile || isSaving}>
            <Trash2 className="mr-2 h-4 w-4" />
            删除
          </Button>
          <Button variant="outline" size="sm" onClick={handleReload} disabled={!selectedFile || isLoading}>
            <RefreshCw className={cn("mr-2 h-4 w-4", isLoading && "animate-spin")} />
            重载
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!selectedFile || !isDirty || isSaving}>
            <Save className="mr-2 h-4 w-4" />
            {isSaving ? "保存中" : "保存"}
          </Button>
        </div>
      </div>

      <ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={30} minSize={22} maxSize={42}>
          <div className="flex h-full flex-col border-r border-border bg-panel/60">
            <div className="space-y-3 border-b border-border p-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="pl-9"
                  placeholder="搜索技能文件"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                {categoryFilters.map((category) => (
                  <Button
                    key={category.id}
                    type="button"
                    variant={activeCategory === category.id ? "default" : "outline"}
                    size="sm"
                    className="justify-start"
                    onClick={() => setActiveCategory(category.id)}
                  >
                    {category.id !== "all" ? <CategoryIcon category={category.id} /> : <FileText className="mr-2 h-4 w-4" />}
                    <span className="truncate">{category.label}</span>
                    {category.id !== "all" ? <span className="ml-auto text-xs opacity-70">{categoryCounts[category.id]}</span> : null}
                  </Button>
                ))}
              </div>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-1 p-3">
                {filteredFiles.map((file) => {
                  const active = file.relativePath === selectedPath;
                  return (
                    <button
                      key={file.relativePath}
                      type="button"
                      onClick={() => handleSelectFile(file)}
                      className={cn(
                        "w-full rounded-md border px-3 py-2 text-left transition-colors",
                        active
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-transparent text-muted-foreground hover:border-border hover:bg-muted/60 hover:text-foreground",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <CategoryIcon category={file.category} />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{file.title}</span>
                      </div>
                      <div className="mt-1 truncate text-[11px]">{file.relativePath}</div>
                    </button>
                  );
                })}
                {filteredFiles.length === 0 ? (
                  <div className="px-3 py-10 text-center text-sm text-muted-foreground">没有匹配的技能文件</div>
                ) : null}
              </div>
            </ScrollArea>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={70} minSize={45}>
          <div className="flex h-full min-w-0 flex-col">
            <div className="border-b border-border px-5 py-3">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{selectedFile ? STUDIO_SKILL_CATEGORY_LABELS[selectedFile.category] : "未选择"}</Badge>
                {selectedFile?.sourceExists ? <Badge variant="outline">存储副本</Badge> : null}
                {selectedFile?.isCustomized ? <Badge variant="outline">已改</Badge> : null}
                {isDirty ? <Badge variant="outline">未保存</Badge> : <Badge variant="outline">已保存</Badge>}
              </div>
              <div className="mt-2 truncate text-sm font-medium">{selectedFile?.title ?? "请选择技能文件"}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                <div className="break-all">相对路径：{selectedFile?.relativePath ?? ""}</div>
                <div className="break-all">本地路径：{selectedFile?.storagePath ?? selectedFile?.filePath ?? "未同步到本地存储"}</div>
              </div>
            </div>

            <ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1">
              <ResizablePanel defaultSize={52} minSize={32}>
                <div className="flex h-full min-w-0 flex-col p-4 pr-2">
                  <div className="mb-2 text-xs font-medium text-muted-foreground">Markdown 编辑</div>
                  <Textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    readOnly={!selectedFile || isLoading}
                    className="h-full min-h-0 flex-1 resize-none font-mono text-xs leading-5"
                    placeholder="选择左侧技能文件后编辑 Markdown"
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
                          a: ({ children, href }) => <a className="text-primary underline" href={href}>{children}</a>,
                        }}
                      >
                        {draft}
                      </ReactMarkdown>
                    </article>
                  </ScrollArea>
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="w-[min(620px,calc(100vw-32px))] max-w-none">
          <DialogHeader>
            <DialogTitle>新增技能文件</DialogTitle>
            <DialogDescription>新文件会写入当前存储目录的 skills 分类下。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="skill-category">分类</Label>
              <select
                id="skill-category"
                value={createCategory}
                onChange={(event) => setCreateCategory(event.target.value as StudioSkillFileCategory)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {createCategoryOptions.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="skill-path">文件路径</Label>
              <Input
                id="skill-path"
                value={createPath}
                onChange={(event) => setCreatePath(event.target.value)}
                placeholder={createCategory === "visual" || createCategory === "director" ? "风格名/README.md" : "new_skill.md"}
              />
              <div className="break-all text-xs text-muted-foreground">将创建：{createRelativePath || "无效路径"}</div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>取消</Button>
            <Button onClick={handleCreate} disabled={isSaving || !createRelativePath}>新增</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CategoryIcon(props: { category: StudioSkillFileCategory }) {
  const className = "mr-2 h-4 w-4 shrink-0";
  if (props.category === "visual") return <Palette className={className} />;
  if (props.category === "director") return <Clapperboard className={className} />;
  if (props.category === "production") return <Hammer className={className} />;
  return <BookOpenText className={className} />;
}

function buildSkillCreatePath(category: StudioSkillFileCategory, value: string) {
  const option = createCategoryOptions.find((item) => item.id === category);
  if (!option) return "";
  const cleaned = value.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!cleaned || cleaned.includes("../") || cleaned.includes("/../")) return "";
  const withExtension = cleaned.endsWith(".md") ? cleaned : `${cleaned}.md`;
  return withExtension.startsWith(`${option.prefix}/`) ? withExtension : `${option.prefix}/${withExtension}`;
}

function getSkillTitleFromPath(relativePath: string) {
  const filename = relativePath.split("/").at(-1) ?? "new_skill.md";
  return filename.replace(/\.md$/, "").replace(/[_-]+/g, " ").trim() || "新技能";
}

function makeEditableSkillFile(
  relativePath: string,
  content: string,
  meta: Partial<EditableSkillFile> = {},
): EditableSkillFile {
  const filename = relativePath.split("/").at(-1) ?? relativePath;
  const directory = relativePath.includes("/") ? relativePath.split("/").slice(0, -1).join("/") : "根级技能";
  return {
    id: relativePath,
    relativePath,
    directory,
    filename,
    title: getSkillTitleFromPath(relativePath),
    category: getStudioSkillCategory(relativePath),
    content,
    ...meta,
  };
}
