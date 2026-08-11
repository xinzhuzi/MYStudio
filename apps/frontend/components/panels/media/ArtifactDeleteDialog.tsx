// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { useState, useMemo, useEffect } from "react";
import { AlertTriangle, Trash2, Copy, ShieldAlert, Lock, HardDrive, FileWarning } from "lucide-react";
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
  /** Open/closed state */
  isOpen: boolean;

  /** Deletion plan to display */
  plan?: DeletionPlan | null;

  /** Callback when dialog is closed (cancel - zero IPC calls made) */
  onClose: () => void;

  /** Callback when deletion is confirmed and executed */
  onExecute: (confirmation: DeletionConfirmation) => Promise<void>;

  /** Custom className for root element */
  className?: string;
}

/**
 * Artifact Delete Dialog Component
 *
 * Non-nested full-width sections showing deletion plan breakdown:
 * - Warning banner
 * - Delete group (items to be deleted)
 * - Migrate group (protected assets being copied)
 * - Retain group (shared references with explanation)
 * - Blocker group (items blocking deletion with reasons)
 * - Backup impact section
 * - Confirmation controls
 *
 * Cancel behavior: Escape/close = zero IPC calls
 * Confirm: Only enabled after exact match or count verification
 */
export function ArtifactDeleteDialog({
  isOpen,
  plan,
  onClose,
  onExecute,
  className,
}: ArtifactDeleteDialogProps) {
  const [confirmedText, setConfirmedText] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);

  // Reset confirmation input when plan changes
  useEffect(() => {
    if (isOpen) {
      setConfirmedText("");
    }
  }, [isOpen, plan?.planId]);

  // Calculate summary stats
  const stats = useMemo(() => {
    if (!plan) return null;

    const deleteStats = groupByKindStage(plan.deleteItems);
    const migrateStats = groupByKindStage(plan.migrateItems);
    const retainStats = groupByKindStage(plan.retainItems);
    const blockerStats = groupByKindStage(plan.blockerItems);

    return {
      deleteCount: plan.deleteItems.length,
      deleteBytes: plan.byteTotals.deleteBytes,
      deleteStats,
      migrateCount: plan.migrateItems.length,
      migrateBytes: plan.byteTotals.migrateBytes,
      migrateStats,
      retainCount: plan.retainItems.length,
      retainBytes: plan.byteTotals.retainBytes,
      retainStats,
      blockerCount: plan.blockerItems.length,
      blockerStats,
      totalBytes: plan.byteTotals.totalBytes,
      backupImpactCount: plan.backupImpact.length,
    };
  }, [plan]);

  // Check if confirmation is valid
  const isConfirmationValid = useMemo(() => {
    if (!plan || !plan.executionAllowed || plan.blockerItems.length > 0) return false;

    const conf = plan.confirmationRequired;

    if (conf.type === "artifact-count") {
      return (conf.count ?? 0) > 0;
    }
    if (!confirmedText) return false;

    if (conf.type === "chapter-title") {
      return confirmedText === conf.value;
    } else if (conf.type === "chapter-id") {
      return confirmedText === conf.value;
    }

    return false;
  }, [plan, confirmedText]);

  // Handle execute click
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

  // Handle escape key - just close dialog (no IPC calls)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!plan) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={cn("max-w-4xl w-full max-h-[90vh] flex flex-col", className)}>
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-red-500" />
            确认删除产物 — {plan.scope === "chapter" ? "整章" : "选中项"}
          </DialogTitle>
          <DialogDescription>
            这是永久删除操作，不可撤销。请核对下方完整清单后再确认。
          </DialogDescription>
        </DialogHeader>

        {/* Main content area - scrollable sections */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="space-y-4 py-4">
            {/* Warning Banner */}
            <WarningBanner plan={plan} />
            <PlanScopeSummary plan={plan} />

            {/* Delete Group */}
            {plan.deleteItems.length > 0 && (
              <DeletionGroup
                title="将删除"
                items={plan.deleteItems}
                stats={stats?.deleteStats}
                bytes={stats?.deleteBytes ?? 0}
                icon={<Trash2 className="w-5 h-5" />}
                color="red"
              />
            )}

            {/* Migrate Group */}
            {plan.migrateItems.length > 0 && (
              <DeletionGroup
                title="将迁移（复制保留）"
                items={plan.migrateItems}
                stats={stats?.migrateStats}
                bytes={stats?.migrateBytes ?? 0}
                icon={<Copy className="w-5 h-5" />}
                color="yellow"
                description="受保护资产会先复制到稳定位置，再删除原文件"
              />
            )}

            {/* Retain Group */}
            {plan.retainItems.length > 0 && (
              <DeletionGroup
                title="保留（被其它产物共享）"
                items={plan.retainItems}
                stats={stats?.retainStats}
                bytes={stats?.retainBytes ?? 0}
                icon={<ShieldAlert className="w-5 h-5" />}
                color="blue"
                description="这些产物被其它产物引用，不会删除"
              />
            )}

            {/* Blocker Group */}
            {plan.blockerItems.length > 0 && (
              <DeletionGroup
                title="无法删除（存在阻塞）"
                items={plan.blockerItems}
                stats={stats?.blockerStats}
                bytes={0}
                icon={<Lock className="w-5 h-5" />}
                color="orange"
                description="这些产物有阻塞项，本次无法删除"
              />
            )}

            {/* Backup Impact Section */}
            {plan.backupImpact.length > 0 && (
              <BackupImpactSection impacts={plan.backupImpact} />
            )}

            {/* Empty state */}
            {plan.deleteItems.length === 0 &&
              plan.migrateItems.length === 0 &&
              plan.retainItems.length === 0 &&
              plan.blockerItems.length === 0 && (
                <EmptyState />
              )}
          </div>
        </ScrollArea>

        {/* Footer - confirmation controls */}
        <DialogFooter className="flex-shrink-0 pt-4 border-t">
          {plan.confirmationRequired.type !== "artifact-count" && (
            <ConfirmInput
              value={confirmedText}
              onChange={setConfirmedText}
              placeholder={plan.confirmationRequired.value ?? ""}
              label={getConfirmationLabel(plan.confirmationRequired)}
            />
          )}

          <div className="flex gap-2 ml-auto">
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={handleExecute}
              disabled={!isConfirmationValid || isExecuting}
            >
              {isExecuting
                ? "正在删除…"
                : plan.confirmationRequired.type === "artifact-count" && typeof plan.confirmationRequired.count === "number"
                  ? `确认删除（${plan.confirmationRequired.count} 项）`
                  : "确认删除"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Warning banner showing irreversible nature of deletion. When the plan
 * touches items that disturb the pipeline (migrate / retain / blocker), an
 * extra highlighted notice reminds the user that downstream work may need to
 * be regenerated in the workflow.
 */
function WarningBanner({ plan }: { plan: DeletionPlan }) {
  const totalItems = plan.deleteItems.length + plan.migrateItems.length + plan.retainItems.length + plan.blockerItems.length;

  // Items outside the "safe delete" group disturb the pipeline: migrating
  // protected assets, retained shared references, or blocked items all imply
  // downstream artifacts can break and may have to be remade.
  const flowBreakingCount =
    plan.migrateItems.length + plan.retainItems.length + plan.blockerItems.length;

  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-3">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
        <div>
            <h4 className="font-semibold text-red-900">删除后无法恢复</h4>
            <p className="text-sm text-red-700 mt-1">
            本次将处理 {totalItems} 项产物、关联记录、物理文件和历史备份。取消不会产生任何写入。
          </p>
        </div>
      </div>
      {flowBreakingCount > 0 && (
        <div className="flex items-start gap-3 bg-orange-100 border border-orange-300 rounded-md p-3">
          <ShieldAlert className="w-5 h-5 text-orange-700 flex-shrink-0 mt-0.5" />
          <div>
            <h5 className="font-semibold text-orange-900">将影响整体流程</h5>
            <p className="text-sm text-orange-800 mt-1">
              其中有 <strong>{flowBreakingCount}</strong> 项被其它产物依赖或受保护:
              删除后<strong>会破坏整体流程</strong>,你可能需要回到工作流中
              <strong>重新制作</strong>相关的下游产物。请确认后再继续。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function PlanScopeSummary({ plan }: { plan: DeletionPlan }) {
  const confirmationValue = plan.confirmationRequired.type === "artifact-count"
    ? `${plan.confirmationRequired.count ?? 0} 项`
    : plan.confirmationRequired.value ?? "未提供";

  return (
    <section aria-label="删除范围摘要" className="border border-muted rounded-lg p-4 bg-card">
      <div className="grid gap-3 sm:grid-cols-2">
        <ScopeValue label="项目 ID" value={plan.projectId} />
        <ScopeValue label="章节 ID" value={plan.chapterId} />
        <ScopeValue label="删除范围" value={plan.scope === "chapter" ? "整章" : "选中产物"} />
        <ScopeValue label="精确确认值" value={confirmationValue} emphasize />
      </div>
      <div className="grid grid-cols-2 gap-2 mt-4 sm:grid-cols-4" aria-label="空间影响">
        <ByteTotal label="删除释放" bytes={plan.byteTotals.deleteBytes} />
        <ByteTotal label="迁移占用" bytes={plan.byteTotals.migrateBytes} />
        <ByteTotal label="保留占用" bytes={plan.byteTotals.retainBytes} />
        <ByteTotal label="计划总量" bytes={plan.byteTotals.totalBytes} />
      </div>
    </section>
  );
}

function ScopeValue({ label, value, emphasize = false }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 break-all font-mono text-sm", emphasize && "font-semibold text-red-600")}>
        {value}
      </div>
    </div>
  );
}

function ByteTotal({ label, bytes }: { label: string; bytes: number }) {
  return (
    <div className="min-w-0 border-l-2 border-muted pl-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-sm">{formatBytes(bytes)}</div>
    </div>
  );
}

/**
 * Group section showing items in a category
 */
function DeletionGroup({
  title,
  items,
  stats,
  bytes,
  icon,
  color,
  description,
}: {
  title: string;
  items: PlanItem[];
  stats?: Record<string, number>;
  bytes: number;
  icon: React.ReactNode;
  color: "red" | "yellow" | "blue" | "orange";
  description?: string;
}) {
  // Unified neutral container (white card + thin border) with a semantic
  // accent only on the left edge and the heading icon. Keeps the dialog calm
  // and consistent with the rest of the app instead of four saturated blocks.
  const accentClasses = {
    red: "border-l-red-500 [&_svg]:text-red-500",
    yellow: "border-l-yellow-500 [&_svg]:text-yellow-600",
    blue: "border-l-blue-500 [&_svg]:text-blue-500",
    orange: "border-l-orange-500 [&_svg]:text-orange-500",
  };

  return (
    <div className={cn("border border-l-4 border-muted rounded-lg p-4 bg-card", accentClasses[color])}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <Badge variant="secondary">{items.length} 项</Badge>
          <Badge variant="outline">{formatBytes(bytes)}</Badge>
        </div>
        {description && (
          <span className="text-xs text-gray-600 italic">{description}</span>
        )}
      </div>

      {/* Summary by stage/kind */}
      {stats && Object.keys(stats).length > 0 && (
        <div className="mb-3">
          <div className="text-xs text-gray-600 mb-2">分类统计：</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(stats).map(([category, count]) => (
              <Badge key={category} variant="outline" className="text-xs">
                {category}: {count}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Item list */}
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {items.map((item) => (
          <div
            key={item.artifactId}
            className="text-sm py-3 border-t first:border-t-0 border-muted"
          >
            <div className="flex items-center justify-between">
              <div className="font-medium text-gray-900 break-all">{item.name}</div>
              <div className="text-xs text-gray-600 whitespace-nowrap ml-2">
                {item.bytes !== undefined ? formatBytes(item.bytes) : ""}
              </div>
            </div>
            <div className="flex items-center gap-2 mt-1 text-xs text-gray-600">
              <Badge variant="secondary" className="text-xs">{item.kind}</Badge>
              <span>{item.stage}</span>
            </div>
            {item.reason && (
              <div className="mt-2 text-xs text-gray-700">
                {item.reason}
              </div>
            )}
            <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
              <ItemEvidence label="产物 ID" values={[item.artifactId]} />
              <ItemEvidence
                label="上游归属"
                values={item.upstreamOwnerIds?.length ? item.upstreamOwnerIds : ["无"]}
              />
              <ItemEvidence
                label="物理路径"
                values={item.physicalPath ? [item.physicalPath] : ["无"]}
              />
              <ItemEvidence
                label="物理引用"
                values={item.physicalRefs?.length
                  ? item.physicalRefs.map((ref) => (
                    `${ref.type} · ${ref.path} · ${ref.bytes === undefined ? "大小未知" : formatBytes(ref.bytes)}`
                  ))
                  : ["无"]}
              />
              {item.physicalHash256 && (
                <ItemEvidence label="SHA-256" values={[item.physicalHash256]} />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ItemEvidence({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="min-w-0">
      <div className="text-muted-foreground">{label}</div>
      <div className="mt-1 space-y-1 font-mono text-foreground">
        {values.map((value) => (
          <div key={value} className="break-all">{value}</div>
        ))}
      </div>
    </div>
  );
}

/**
 * Backup impact section showing which backup files are affected
 */
function BackupImpactSection({ impacts }: { impacts: BackupImpact[] }) {
  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
      <div className="flex items-center gap-2 mb-3">
        <HardDrive className="w-5 h-5 text-gray-700" />
        <h3 className="font-semibold text-gray-900">历史备份影响</h3>
        <Badge variant="secondary">影响 {impacts.length} 个文件</Badge>
      </div>

      <div className="space-y-2">
        {impacts.map((impact) => (
          <div key={`${impact.format}:${impact.action}:${impact.filePath}`} className="text-sm p-2 bg-white rounded border border-gray-200">
            <div className="flex items-center justify-between">
              <div className="font-mono text-xs text-gray-700 truncate flex-1">
                {impact.filePath}
              </div>
              <Badge
                variant={impact.action === "delete" ? "destructive" : "secondary"}
                className="ml-2 text-xs"
              >
                {impact.action.toUpperCase()}
              </Badge>
            </div>
            {impact.reason && (
              <div className="mt-1 text-xs text-gray-600">{impact.reason}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Confirmation input field requiring exact match
 */
function ConfirmInput({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
}) {
  const isValid = value === placeholder;

  return (
    <div className="flex-1 mr-4">
      <label className="text-sm font-medium text-gray-700 mb-1 block">
        {label}
      </label>
      <Input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="输入确认值"
        className={cn(
          "flex-1",
          isValid ? "border-green-500 bg-green-50" : "border-red-500"
        )}
      />
      {!isValid && value.length > 0 && (
        <div className="text-xs text-red-600 mt-1">
          必须完全一致："{placeholder}"
        </div>
      )}
      {isValid && (
        <div className="text-xs text-green-600 mt-1">
          ✓ 已确认
        </div>
      )}
    </div>
  );
}

/**
 * Empty state when no artifacts found
 */
function EmptyState() {
  return (
    <div className="text-center py-8">
      <FileWarning className="w-12 h-12 text-gray-400 mx-auto mb-2" />
      <p className="text-gray-600">没有符合条件的产物</p>
    </div>
  );
}

/**
 * Group items by kind and stage for statistics
 */
function groupByKindStage(items: PlanItem[]) {
  const stats: Record<string, number> = {};

  items.forEach((item) => {
    const key = `${item.kind}/${item.stage}`;
    stats[key] = (stats[key] ?? 0) + 1;
  });

  return stats;
}

/**
 * Get human-readable label for confirmation input
 */
function getConfirmationLabel(conf: DeletionPlan["confirmationRequired"]): string {
  switch (conf.type) {
    case "chapter-title":
      return "输入章节标题以确认";
    case "chapter-id":
      return "输入章节 ID 以确认";
    case "artifact-count":
      return "点击「确认删除」即可";
    default:
      return "";
  }
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}
