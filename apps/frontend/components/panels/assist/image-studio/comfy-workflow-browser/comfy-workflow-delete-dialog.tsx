// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ComfyWorkflowDeleteScan } from "@/lib/assist/image-studio/comfy-workflow-library";

/**
 * 删除确认弹窗(grill Q11 删除保护):引用清单警告 → 二次确认 → 执行。
 * 引用扫描在打开前由调用方完成(scanDelete 只读不删),本组件只呈现与
 * 二次确认;「X 处引用」用警示色点明,零引用也走二次确认(删除不可逆,
 * 后端做快照备份可恢复)。
 */
export function ComfyWorkflowDeleteDialog({
  open,
  workflowName,
  scan,
  deleting,
  onConfirm,
  onOpenChange,
}: {
  open: boolean;
  workflowName: string;
  /** 引用扫描结果(打开前已拿到);null=扫描中 */
  scan: ComfyWorkflowDeleteScan | null;
  deleting: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [armed, setArmed] = useState(false);
  // 重开时复位二次确认状态
  useEffect(() => {
    if (open) setArmed(false);
  }, [open]);

  const references = scan?.references ?? [];
  const referenceCount = references.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>删除工作流「{workflowName}」</DialogTitle>
          <DialogDescription>
            删除前已自动备份快照,可联系备份恢复;引用它的地方会失效。
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <div className="flex items-center gap-2 font-medium text-foreground">
            <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
            {scan === null ? "正在扫描引用…" : `${referenceCount} 处引用`}
          </div>
          {references.length > 0 ? (
            <ul className="mt-1.5 space-y-1 text-xs text-muted-foreground" data-comfy-delete-references>
              {references.slice(0, 8).map((ref, index) => (
                <li key={`${ref.kind}-${ref.name}-${index}`}>
                  {ref.kind}:{ref.name}
                </li>
              ))}
              {references.length > 8 ? (
                <li>…共 {references.length} 处</li>
              ) : null}
            </ul>
          ) : scan !== null ? (
            <div className="mt-1 text-xs text-muted-foreground">没有画布或节点在用它</div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={deleting}>
            取消
          </Button>
          {armed ? (
            <Button
              variant="destructive"
              onClick={onConfirm}
              disabled={deleting || scan === null}
              data-comfy-delete-confirm
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              {deleting ? "正在删除…" : "确认删除"}
            </Button>
          ) : (
            <Button
              variant="destructive"
              onClick={() => setArmed(true)}
              disabled={scan === null}
              data-comfy-delete-arm
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              删除
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
