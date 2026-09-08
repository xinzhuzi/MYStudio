// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FilePlus2, FolderUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { analyzeComfyWorkflowText, formatMissingClassTypesMessage } from "@/lib/assist/image-studio/comfy-workflow-import";
import type {
  ComfyWorkflowImportConflictMode,
  ComfyWorkflowImportFile,
  ComfyWorkflowImportFileResult,
} from "@/lib/assist/image-studio/comfy-workflow-library";

/**
 * 外部导入弹窗(grill Q8 裁定):文件/目录多选(系统选择器)→ 预览列表
 * (名称/节点数/缺失插件标记,缺失的导入前红字列出)→ 同名冲突处理
 * (跳过/覆盖/两者保留,批量或逐文件)→ 导入进度。数据经
 * /comfy/workflows/import(typed client);显式复制进自管库,不扫描
 * 不绑定外部应用。
 */

/** 预览行:文件分析结果(纯数据,独立可测) */
export interface ComfyImportPreviewItem {
  name: string;
  content: string;
  /** 分析失败(UI 格式/坏 JSON)→ 红字指路,不进导入 */
  error?: string;
  nodeCount?: number;
  missingClassTypes?: string[];
  /** 与库内同名(冲突) */
  conflict: boolean;
  /** 逐文件冲突模式(默认跟随批量) */
  mode: ComfyWorkflowImportConflictMode;
}

/** 纯函数:选中的文件 → 预览行(导入弹窗与测试共用) */
export function buildComfyImportPreview(
  files: { name: string; content: string }[],
  libraryNames: ReadonlySet<string>,
  availableClassTypes: readonly string[],
): ComfyImportPreviewItem[] {
  return files
    .filter((file) => /\.json$/i.test(file.name))
    .map((file) => {
      const baseName = file.name.replace(/\.json$/i, "");
      const analyzed = analyzeComfyWorkflowText(file.content, {
        availableClassTypes,
      });
      if (!analyzed.ok) {
        return { name: file.name, content: file.content, error: analyzed.error, conflict: false, mode: "skip" };
      }
      return {
        name: file.name,
        content: file.content,
        nodeCount: analyzed.descriptor.nodeCount,
        missingClassTypes: analyzed.descriptor.missing,
        conflict: libraryNames.has(baseName),
        mode: "skip",
      };
    });
}

export function ComfyWorkflowImportDialog({
  open,
  libraryNames,
  availableClassTypes,
  onImport,
  onOpenChange,
}: {
  open: boolean;
  /** 库内现有名(冲突检测;调用方从树快照取) */
  libraryNames: ReadonlySet<string>;
  /** object_info 摘要(缺插件标记口径) */
  availableClassTypes: readonly string[];
  /** 执行导入(逐文件模式由调用方按行下发);返回逐文件结果 */
  onImport: (files: ComfyWorkflowImportFile[], mode: ComfyWorkflowImportConflictMode) => Promise<ComfyWorkflowImportFileResult[]>;
  onOpenChange: (open: boolean) => void;
}) {
  const [items, setItems] = useState<ComfyImportPreviewItem[]>([]);
  const [batchMode, setBatchMode] = useState<ComfyWorkflowImportConflictMode>("skip");
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<ComfyWorkflowImportFileResult[] | null>(null);
  const [scanning, setScanning] = useState(false);

  // 重开时清空上一轮
  useEffect(() => {
    if (open) {
      setItems([]);
      setResults(null);
      setImporting(false);
      setScanning(false);
      setBatchMode("skip");
    }
  }, [open]);

  const readFileList = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      setScanning(true);
      try {
        const files = await Promise.all(
          [...fileList].map(async (file) => ({ name: file.name, content: await file.text() })),
        );
        setItems(buildComfyImportPreview(files, libraryNames, availableClassTypes));
      } finally {
        setScanning(false);
      }
    },
    [libraryNames, availableClassTypes],
  );

  const conflictCount = useMemo(() => items.filter((item) => item.conflict).length, [items]);
  const importable = useMemo(
    () => items.filter((item) => !item.error),
    [items],
  );

  const applyBatchMode = (mode: ComfyWorkflowImportConflictMode) => {
    setBatchMode(mode);
    setItems((prev) => prev.map((item) => (item.conflict ? { ...item, mode } : item)));
  };

  const setItemMode = (name: string, mode: ComfyWorkflowImportConflictMode) => {
    setItems((prev) => prev.map((item) => (item.name === name ? { ...item, mode } : item)));
  };

  const handleImport = async () => {
    if (importable.length === 0) return;
    setImporting(true);
    try {
      // 按模式分桶、每个文件只发一次:非冲突文件模式无意义(随批量模式
      // 下发),冲突文件按其逐文件选择(skip/overwrite/keep-both)
      const batches = new Map<ComfyWorkflowImportConflictMode, ComfyWorkflowImportFile[]>();
      for (const item of importable) {
        const mode = item.conflict ? item.mode : batchMode;
        const list = batches.get(mode) ?? [];
        list.push({ name: item.name, content: item.content });
        batches.set(mode, list);
      }
      const finalResults: ComfyWorkflowImportFileResult[] = [];
      for (const [mode, files] of batches) {
        const results = await onImport(files, mode);
        finalResults.push(...results);
      }
      setResults(finalResults);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>从外部导入工作流</DialogTitle>
          <DialogDescription>
            选择 ComfyUI 的 API 格式工作流 JSON 复制进自管库(画布格式会被拦下并指路)。
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <label className="cursor-pointer">
            <input
              type="file"
              accept=".json,application/json"
              multiple
              className="hidden"
              onChange={(event) => {
                void readFileList(event.target.files);
                event.target.value = "";
              }}
              data-comfy-import-file-input
            />
            <Button variant="secondary" size="sm" asChild disabled={importing}>
              <span>
                <FilePlus2 className="mr-1 h-3.5 w-3.5" />
                选文件
              </span>
            </Button>
          </label>
          <label className="cursor-pointer">
            <input
              type="file"
              className="hidden"
              multiple
              {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
              onChange={(event) => {
                void readFileList(event.target.files);
                event.target.value = "";
              }}
              data-comfy-import-dir-input
            />
            <Button variant="secondary" size="sm" asChild disabled={importing}>
              <span>
                <FolderUp className="mr-1 h-3.5 w-3.5" />
                选目录
              </span>
            </Button>
          </label>
          {scanning ? <span className="text-xs text-muted-foreground">正在读取…</span> : null}
        </div>

        {items.length > 0 ? (
          <div className="max-h-64 space-y-1.5 overflow-y-auto" data-comfy-import-preview>
            {items.map((item) => (
              <div
                key={item.name}
                className="rounded-md border px-2.5 py-2 text-xs"
                data-comfy-import-row={item.name}
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">{item.name}</span>
                  {item.error ? (
                    <span className="text-destructive">无法导入</span>
                  ) : (
                    <>
                      <span className="text-muted-foreground">{item.nodeCount} 节点</span>
                      {item.missingClassTypes && item.missingClassTypes.length > 0 ? (
                        <span
                          className="text-destructive"
                          title={formatMissingClassTypesMessage(item.missingClassTypes)}
                        >
                          缺 {item.missingClassTypes.length} 插件
                        </span>
                      ) : null}
                      {item.conflict ? (
                        <span className="text-warning" title="与库内同名">同名</span>
                      ) : null}
                    </>
                  )}
                </div>
                {item.error ? (
                  <div className="mt-1 text-destructive" data-comfy-import-error>{item.error}</div>
                ) : item.missingClassTypes && item.missingClassTypes.length > 0 ? (
                  <div className="mt-1 text-destructive" data-comfy-import-missing>
                    {formatMissingClassTypesMessage(item.missingClassTypes)}
                  </div>
                ) : null}
                {item.conflict && !item.error && results === null ? (
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="text-muted-foreground">同名处理:</span>
                    <Select value={item.mode} onValueChange={(value) => setItemMode(item.name, value as ComfyWorkflowImportConflictMode)}>
                      <SelectTrigger className="h-6 w-24 text-xs" aria-label={`${item.name} 同名处理`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="skip">跳过</SelectItem>
                        <SelectItem value="overwrite">覆盖</SelectItem>
                        <SelectItem value="keep-both">两者保留</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
            还没选文件——点上方「选文件」或「选目录」(目录会自动找出里面的 .json)
          </div>
        )}

        {results !== null ? (
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs" data-comfy-import-results>
            {results.map((result, index) => (
              <div key={`${result.name}-${index}`} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{result.name}</span>
                {result.status === "imported" ? (
                  <span className="text-info">已导入</span>
                ) : result.status === "renamed" ? (
                  <span className="text-info">已导入为「{result.renamedTo}」</span>
                ) : result.status === "skipped" ? (
                  <span className="text-muted-foreground">已跳过(同名)</span>
                ) : (
                  <span className="text-destructive">{result.error}</span>
                )}
              </div>
            ))}
          </div>
        ) : null}

        {conflictCount > 0 && results === null ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{conflictCount} 个同名,批量设为:</span>
            <Select value={batchMode} onValueChange={(value) => applyBatchMode(value as ComfyWorkflowImportConflictMode)}>
              <SelectTrigger className="h-7 w-28 text-xs" aria-label="批量同名处理">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="skip">跳过</SelectItem>
                <SelectItem value="overwrite">覆盖</SelectItem>
                <SelectItem value="keep-both">两者保留</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={importing}>
            {results !== null ? "关闭" : "取消"}
          </Button>
          {results === null ? (
            <Button
              onClick={() => void handleImport()}
              disabled={importing || importable.length === 0}
              data-comfy-import-submit
            >
              {importing ? `正在导入 ${importable.length} 个…` : `导入 ${importable.length} 个`}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
