// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { useState, useMemo, useEffect } from "react";
import { AlertTriangle, Trash2, Copy, ShieldAlert, Lock, HardDrive, FileWarning, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DeletionConfirmation, DeletionPlan, PlanItem, BackupImpact } from "@/types/artifacts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

export interface ArtifactDeleteDialogProps {
  isOpen: boolean;
  plan?: DeletionPlan | null;
  loading?: boolean;
  onClose: () => void;
  onExecute: (confirmation: DeletionConfirmation) => Promise<void>;
  className?: string;
}

export function ArtifactDeleteDialog({
  isOpen,
  plan,
  loading = false,
  onClose,
  onExecute,
  className,
}: ArtifactDeleteDialogProps) {
  const [confirmedText, setConfirmedText] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);

  useEffect(() => {
    if (isOpen) setConfirmedText("");
  }, [isOpen, plan?.planId]);

  const isConfirmationValid = useMemo(() => {
    if (!plan || !plan.executionAllowed) return false;
    // For artifact-scope (选中项删除), if there are delete items to process,
    // allow execution even when some blockers exist — the user explicitly
    // chose to delete those items. Blockers are shown as warnings, not hard
    // stops. Only block when there's nothing to delete at all.
    const hasDeleteTargets = plan.deleteItems.length > 0 || plan.migrateItems.length > 0;
    if (!hasDeleteTargets) return false;
    const conf = plan.confirmationRequired;
    if (conf.type === "artifact-count") return (conf.count ?? 0) > 0;
    if (!confirmedText) return false;
    if (conf.type === "chapter-title") return confirmedText === conf.value;
    if (conf.type === "chapter-id") return confirmedText === conf.value;
    return false;
  }, [plan, confirmedText]);

  const handleExecute = async () => {
    if (!isConfirmationValid || !plan) return;
    try {
      setIsExecuting(true);
      const confirmation: DeletionConfirmation = plan.confirmationRequired.type === "artifact-count"
        ? { type: "artifacts", artifactCount: plan.confirmationRequired.count }
        : plan.confirmationRequired.type === "chapter-title"
          ? { type: "chapter", chapterTitle: confirmedText }
          : { type: "chapter", chapterId: confirmedText };
      await onExecute(confirmation);
      onClose();
    } finally {
      setIsExecuting(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Loading state — dialog appears immediately with a spinner.
  if (loading && !plan) {
    return (
      <Dialog open={true} onOpenChange={onClose}>
        <DialogContent className={cn("max-w-lg w-full flex flex-col", className)}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              正在计算删除计划…
            </DialogTitle>
            <DialogDescription>正在扫描项目产物依赖关系，请稍候。</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!plan) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={cn("max-w-2xl w-full max-h-[85vh] flex flex-col", className)}>
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-destructive" />
            确认删除 — {plan.scope === "chapter" ? "整章" : `${plan.deleteItems.length + plan.migrateItems.length} 项`}
          </DialogTitle>
          <DialogDescription className="text-destructive/80">
            永久删除，不可撤销。取消不会产生任何写入。
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="space-y-3 py-3">
            {/* Delete Group */}
            {plan.deleteItems.length > 0 && (
              <DeletionGroup title="将删除" items={plan.deleteItems} bytes={plan.byteTotals.deleteBytes} icon={<Trash2 className="w-4 h-4" />} color="red" />
            )}

            {/* Migrate Group */}
            {plan.migrateItems.length > 0 && (
              <DeletionGroup title="将迁移（复制保留）" items={plan.migrateItems} bytes={plan.byteTotals.migrateBytes} icon={<Copy className="w-4 h-4" />} color="yellow" description="受保护资产先复制再删除原文件" />
            )}

            {/* Retain Group */}
            {plan.retainItems.length > 0 && (
              <DeletionGroup title="保留（被共享引用）" items={plan.retainItems} bytes={plan.byteTotals.retainBytes} icon={<ShieldAlert className="w-4 h-4" />} color="blue" description="被其它产物引用，不会删除" />
            )}

            {/* Blocker Group */}
            {plan.blockerItems.length > 0 && (
              <DeletionGroup title="无法删除（存在阻塞）" items={plan.blockerItems} bytes={0} icon={<Lock className="w-4 h-4" />} color="orange" description="有阻塞项，本次无法删除" />
            )}

            {/* Backup Impact */}
            {plan.backupImpact.length > 0 && (
              <BackupImpactSection impacts={plan.backupImpact} />
            )}

            {/* Empty state */}
            {plan.deleteItems.length === 0 && plan.migrateItems.length === 0 && plan.retainItems.length === 0 && plan.blockerItems.length === 0 && (
              <EmptyState />
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="flex-shrink-0 pt-3 border-t">
          {plan.confirmationRequired.type !== "artifact-count" && (
            <ConfirmInput value={confirmedText} onChange={setConfirmedText} placeholder={plan.confirmationRequired.value ?? ""} label={getConfirmationLabel(plan.confirmationRequired)} />
          )}
          <div className="flex gap-2 ml-auto">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button variant="destructive" onClick={handleExecute} disabled={!isConfirmationValid || isExecuting}>
              {isExecuting ? "正在删除…" : plan.confirmationRequired.type === "artifact-count" && typeof plan.confirmationRequired.count === "number"
                ? `确认删除（${plan.confirmationRequired.count} 项）`
                : "确认删除"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeletionGroup({
  title, items, bytes, icon, color, description,
}: {
  title: string;
  items: PlanItem[];
  bytes: number;
  icon: React.ReactNode;
  color: "red" | "yellow" | "blue" | "orange";
  description?: string;
}) {
  const accentClasses = {
    red: "border-l-red-500",
    yellow: "border-l-yellow-500",
    blue: "border-l-blue-500",
    orange: "border-l-orange-500",
  };

  return (
    <div className={cn("border border-l-4 border-muted rounded-lg p-3 bg-card", accentClasses[color])}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-foreground">
          {icon}
          <span className="font-semibold text-sm">{title}</span>
          <Badge variant="secondary" className="text-xs">{items.length} 项</Badge>
          {bytes > 0 && <Badge variant="outline" className="text-xs">{formatBytes(bytes)}</Badge>}
        </div>
        {description && <span className="text-xs text-muted-foreground">{description}</span>}
      </div>
      <div className="space-y-1.5 max-h-48 overflow-y-auto">
        {items.map((item) => (
          <div key={item.artifactId} className="text-xs py-2 border-t first:border-t-0 border-muted">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-foreground break-all">{item.name}</span>
              {item.bytes !== undefined && item.bytes > 0 && (
                <span className="text-muted-foreground whitespace-nowrap">{formatBytes(item.bytes)}</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-1 text-muted-foreground">
              <Badge variant="secondary" className="text-[10px] py-0">{item.kind}</Badge>
              <span>{item.stage}</span>
            </div>
            {item.reason && <p className="mt-1 text-muted-foreground">{item.reason}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function BackupImpactSection({ impacts }: { impacts: BackupImpact[] }) {
  return (
    <div className="border border-muted rounded-lg p-3 bg-muted/30">
      <div className="flex items-center gap-2 mb-2 text-foreground">
        <HardDrive className="w-4 h-4 text-muted-foreground" />
        <span className="font-semibold text-sm">历史备份影响</span>
        <Badge variant="secondary" className="text-xs">{impacts.length} 个文件</Badge>
      </div>
      <div className="space-y-1.5">
        {impacts.map((impact) => (
          <div key={`${impact.format}:${impact.action}:${impact.filePath}`} className="text-xs p-2 bg-card rounded border border-muted">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-muted-foreground truncate flex-1">{impact.filePath}</span>
              <Badge variant={impact.action === "delete" ? "destructive" : "secondary"} className="text-[10px] py-0">{impact.action.toUpperCase()}</Badge>
            </div>
            {impact.reason && <p className="mt-1 text-muted-foreground">{impact.reason}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function ConfirmInput({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  const isValid = value === placeholder;
  return (
    <div className="flex-1 mr-4">
      <label className="text-sm font-medium text-foreground mb-1 block">{label}</label>
      <Input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder="输入确认值" className={cn(isValid ? "border-success/40" : "border-destructive")} />
      {!isValid && value.length > 0 && <p className="text-xs text-destructive mt-1">必须完全一致："{placeholder}"</p>}
      {isValid && <p className="text-xs text-success mt-1">✓ 已确认</p>}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-8">
      <FileWarning className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
      <p className="text-sm text-muted-foreground">没有符合条件的产物</p>
    </div>
  );
}

function getConfirmationLabel(conf: DeletionPlan["confirmationRequired"]): string {
  switch (conf.type) {
    case "chapter-title": return "输入章节标题以确认";
    case "chapter-id": return "输入章节 ID 以确认";
    case "artifact-count": return "点击「确认删除」即可";
    default: return "";
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}
