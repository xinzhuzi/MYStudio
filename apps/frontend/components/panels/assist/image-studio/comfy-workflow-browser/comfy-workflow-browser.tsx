// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

"use client";

import { useMemo, useState } from "react";
import {
  FolderPlus,
  ImportIcon,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatMissingClassTypesMessage } from "@/lib/assist/image-studio/comfy-workflow-import";
import type {
  ComfyWorkflowDeleteScan,
  ComfyWorkflowLibraryClient,
  ComfyWorkflowLibraryEntry,
} from "@/lib/assist/image-studio/comfy-workflow-library";
import { useImageStudioStore } from "@/stores/assist/image-studio-store";
import { ComfyWorkflowDeleteDialog } from "./comfy-workflow-delete-dialog";
import { ComfyWorkflowImportDialog } from "./comfy-workflow-import-dialog";
import { useComfyWorkflowBrowser } from "./use-comfy-workflow-browser";

/**
 * ComfyUI 工作流浏览器(图片工作室侧栏,09-08 二期)。
 * 交互参照 ComfyUI 新版工作流浏览器(搜索框+文件夹树+数量徽章+选中高亮),
 * 视觉/代码全自研(裁定 6:功能对齐,资源不克隆;语义 token)。
 * 数据源=自管实例工作流库;点击=选中,「导入成节点卡」按钮留给集成
 * 接线(onSelectWorkflow 回调,流C注册表合流后建卡)。
 */
export function ComfyWorkflowBrowser({
  client,
  onSelectWorkflow,
  onClose,
}: {
  client: ComfyWorkflowLibraryClient;
  /** 集成接线点:选中项「导入成节点卡」(descriptor→注册表→建卡由集成者落地) */
  onSelectWorkflow?: (workflowId: string) => void;
  onClose?: () => void;
}) {
  const browser = useComfyWorkflowBrowser(client);
  const search = useImageStudioStore((state) => state.comfyBrowserSearch);
  const setSearch = useImageStudioStore((state) => state.setComfyBrowserSearch);
  const folderId = useImageStudioStore((state) => state.comfyBrowserFolderId);
  const selectFolder = useImageStudioStore((state) => state.selectComfyBrowserFolder);
  const selectedId = useImageStudioStore((state) => state.comfyBrowserSelectedId);
  const selectWorkflow = useImageStudioStore((state) => state.selectComfyWorkflow);

  const [importOpen, setImportOpen] = useState(false);
  const [availableClassTypes, setAvailableClassTypes] = useState<string[]>([]);
  const [renameTarget, setRenameTarget] = useState<{ kind: "workflow" | "folder"; id: string; name: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteScan, setDeleteScan] = useState<ComfyWorkflowDeleteScan | null>(null);
  const [deleting, setDeleting] = useState(false);

  const tree = browser.tree;
  const searching = search.trim().length > 0;

  /** 列表口径:搜索=全库按名过滤;否则=选中文件夹(全部=根层) */
  const visibleWorkflows = useMemo(() => {
    const workflows = tree?.workflows ?? [];
    if (searching) {
      const needle = search.trim().toLowerCase();
      return workflows.filter((wf) => wf.name.toLowerCase().includes(needle));
    }
    return workflows.filter((wf) => wf.folderId === folderId);
  }, [tree, searching, search, folderId]);

  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const wf of tree?.workflows ?? []) {
      if (wf.folderId) counts.set(wf.folderId, (counts.get(wf.folderId) ?? 0) + 1);
    }
    return counts;
  }, [tree]);

  const rootCount = useMemo(
    () => (tree?.workflows ?? []).filter((wf) => wf.folderId === null).length,
    [tree],
  );

  const libraryNames = useMemo(
    () => new Set((tree?.workflows ?? []).map((wf) => wf.name)),
    [tree],
  );

  const openImport = async () => {
    setAvailableClassTypes(await browser.getAvailableClassTypes());
    setImportOpen(true);
  };

  const startDelete = async (entry: ComfyWorkflowLibraryEntry) => {
    setDeleteTarget({ id: entry.id, name: entry.name });
    setDeleteScan(null);
    setDeleteScan(await browser.scanDelete(entry.id));
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await browser.confirmDelete(deleteTarget.id);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <aside
      className="flex w-64 shrink-0 flex-col border-r bg-background"
      data-comfy-browser
      aria-label="ComfyUI 工作流库"
    >
      <div className="flex h-9 shrink-0 items-center gap-1 border-b px-2">
        <span className="flex-1 truncate text-xs font-semibold text-foreground">工作流库</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label="刷新工作流库"
          title="重新读取库列表"
          onClick={() => void browser.refresh()}
          disabled={browser.loading}
          data-comfy-browser-refresh
        >
          <RefreshCw className={cn("h-3.5 w-3.5", browser.loading && "animate-spin")} />
        </Button>
        {onClose ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="收起工作流库"
            onClick={onClose}
            data-comfy-browser-close
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>

      <div className="shrink-0 space-y-1.5 border-b p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索工作流…"
            className="h-7 pl-7 text-xs"
            aria-label="搜索工作流"
            data-comfy-browser-search
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="h-7 w-full text-xs"
          onClick={() => void openImport()}
          data-comfy-browser-import
        >
          <ImportIcon className="mr-1 h-3.5 w-3.5" />
          从外部导入…
        </Button>
      </div>

      {/* 文件夹树:全部(根层)+ 各文件夹,数量徽章;搜索时树保持可用 */}
      <div className="shrink-0 p-1" role="tree" aria-label="工作流文件夹">
        <button
          type="button"
          role="treeitem"
          aria-selected={folderId === null}
          onClick={() => selectFolder(null)}
          className={cn(
            "flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-xs",
            folderId === null
              ? "bg-accent font-medium text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/50",
          )}
          data-comfy-browser-folder="root"
        >
          <span className="flex-1 truncate text-left">全部工作流</span>
          <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
            {rootCount}
          </span>
        </button>
        {(tree?.folders ?? []).map((folder) => (
          <div key={folder.id} className="group flex items-center">
            <button
              type="button"
              role="treeitem"
              aria-selected={folderId === folder.id}
              onClick={() => selectFolder(folder.id)}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-2 py-1 text-xs",
                folderId === folder.id
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50",
              )}
              data-comfy-browser-folder={folder.id}
            >
              <span className="flex-1 truncate text-left">{folder.name}</span>
              <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
                {folderCounts.get(folder.id) ?? 0}
              </span>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100"
                  aria-label={`文件夹「${folder.name}」操作`}
                  data-comfy-folder-menu={folder.id}
                >
                  <MoreHorizontal className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem
                  onSelect={() => {
                    setRenameTarget({ kind: "folder", id: folder.id, name: folder.name });
                    setRenameValue(folder.name);
                  }}
                >
                  <Pencil className="mr-2 h-3.5 w-3.5" />
                  重命名文件夹
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => void browser.deleteFolder(folder.id)}
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  删除文件夹
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
        <button
          type="button"
          onClick={() => {
            setNewFolderName("");
            setNewFolderOpen(true);
          }}
          className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-xs text-muted-foreground hover:bg-accent/50"
          data-comfy-browser-new-folder
        >
          <FolderPlus className="h-3.5 w-3.5" aria-hidden />
          新建文件夹
        </button>
      </div>

      {/* 列表:名称/节点数徽章/缺失插件红标;点击=选中高亮 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-1" data-comfy-browser-list>
        {browser.error ? (
          <div className="px-2 py-3 text-xs text-destructive" data-comfy-browser-error>
            {browser.error}
          </div>
        ) : null}
        {!browser.error && visibleWorkflows.length === 0 ? (
          <div className="px-2 py-3 text-xs text-muted-foreground">
            {searching ? "没有匹配的工作流" : "这里还没有工作流——点上方「从外部导入…」复制进来"}
          </div>
        ) : null}
        {visibleWorkflows.map((entry) => (
          <div
            key={entry.id}
            className={cn(
              "group flex cursor-pointer items-center gap-1.5 rounded-sm px-2 py-1.5 text-xs",
              selectedId === entry.id
                ? "bg-accent text-accent-foreground"
                : "hover:bg-accent/50",
            )}
            onClick={() => selectWorkflow(entry.id)}
            data-comfy-browser-workflow={entry.id}
            data-selected={selectedId === entry.id || undefined}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{entry.name}</div>
              <div className="mt-0.5 flex items-center gap-1">
                <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                  {entry.nodeCount} 节点
                </Badge>
                {entry.missingClassTypes.length > 0 ? (
                  <Badge
                    variant="destructive"
                    className="px-1.5 py-0 text-[10px]"
                    title={formatMissingClassTypesMessage(entry.missingClassTypes)}
                    data-comfy-browser-missing
                  >
                    缺 {entry.missingClassTypes.length} 插件
                  </Badge>
                ) : null}
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100"
                  aria-label={`工作流「${entry.name}」操作`}
                  data-comfy-workflow-menu={entry.id}
                  onClick={(event) => event.stopPropagation()}
                >
                  <MoreHorizontal className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem
                  onSelect={() => {
                    setRenameTarget({ kind: "workflow", id: entry.id, name: entry.name });
                    setRenameValue(entry.name);
                  }}
                >
                  <Pencil className="mr-2 h-3.5 w-3.5" />
                  重命名
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>移动到</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem onSelect={() => void browser.moveWorkflow(entry.id, null)}>
                      全部工作流(根层)
                    </DropdownMenuItem>
                    {(tree?.folders ?? [])
                      .filter((folder) => folder.id !== entry.folderId)
                      .map((folder) => (
                        <DropdownMenuItem
                          key={folder.id}
                          onSelect={() => void browser.moveWorkflow(entry.id, folder.id)}
                        >
                          {folder.name}
                        </DropdownMenuItem>
                      ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => void startDelete(entry)}
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  删除…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
      </div>

      {/* 选中项操作条:「导入成节点卡」留给集成接线(onSelectWorkflow) */}
      {onSelectWorkflow && selectedId ? (
        <div className="shrink-0 border-t p-2">
          <Button
            size="sm"
            className="h-7 w-full text-xs"
            onClick={() => onSelectWorkflow(selectedId)}
            data-comfy-browser-import-as-node
          >
            导入成节点卡
          </Button>
        </div>
      ) : null}

      <ComfyWorkflowImportDialog
        open={importOpen}
        libraryNames={libraryNames}
        availableClassTypes={availableClassTypes}
        onImport={(files, mode) => browser.importFiles(files, mode)}
        onOpenChange={setImportOpen}
      />

      <ComfyWorkflowDeleteDialog
        open={deleteTarget !== null}
        workflowName={deleteTarget?.name ?? ""}
        scan={deleteScan}
        deleting={deleting}
        onConfirm={() => void confirmDelete()}
        onOpenChange={(next) => {
          if (!next) setDeleteTarget(null);
        }}
      />

      {/* 重命名(工作流/文件夹共用小弹窗) */}
      <Dialog
        open={renameTarget !== null}
        onOpenChange={(next) => {
          if (!next) setRenameTarget(null);
        }}
      >
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>重命名{renameTarget?.kind === "folder" ? "文件夹" : "工作流"}</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            aria-label="新名称"
            data-comfy-rename-input
            onKeyDown={(event) => {
              if (event.key === "Enter" && renameTarget && renameValue.trim()) {
                const target = renameTarget;
                setRenameTarget(null);
                void (target.kind === "folder"
                  ? browser.renameFolder(target.id, renameValue)
                  : browser.renameWorkflow(target.id, renameValue));
              }
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameTarget(null)}>
              取消
            </Button>
            <Button
              disabled={!renameValue.trim()}
              onClick={() => {
                if (!renameTarget || !renameValue.trim()) return;
                const target = renameTarget;
                setRenameTarget(null);
                void (target.kind === "folder"
                  ? browser.renameFolder(target.id, renameValue)
                  : browser.renameWorkflow(target.id, renameValue));
              }}
              data-comfy-rename-confirm
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 新建文件夹 */}
      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>新建文件夹</DialogTitle>
          </DialogHeader>
          <Input
            value={newFolderName}
            onChange={(event) => setNewFolderName(event.target.value)}
            placeholder="文件夹名"
            aria-label="文件夹名"
            data-comfy-new-folder-input
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNewFolderOpen(false)}>
              取消
            </Button>
            <Button
              disabled={!newFolderName.trim()}
              onClick={() => {
                setNewFolderOpen(false);
                void browser.createFolder(newFolderName, null);
              }}
              data-comfy-new-folder-confirm
            >
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
