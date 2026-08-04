// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { useState, useMemo, useEffect, useCallback } from "react";
import { X, AlertTriangle, Trash2, Copy, ShieldAlert, Lock, HardDrive, FileWarning } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DeletionPlan, PlanItem, BackupImpact } from "@/types/artifacts";
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
  onExecute: () => Promise<void>;

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
      await onExecute();
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
            Delete Artifacts - {plan.scope === "chapter" ? "Chapter" : "Selected Items"}
          </DialogTitle>
          <DialogDescription>
            这是永久删除操作。请核对下方完整清单后再输入精确确认值。
          </DialogDescription>
        </DialogHeader>

        {/* Main content area - scrollable sections */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="space-y-4 py-4">
            {/* Warning Banner */}
            <WarningBanner plan={plan} />

            {/* Delete Group */}
            {plan.deleteItems.length > 0 && (
              <DeletionGroup
                title="To Be Deleted"
                items={plan.deleteItems}
                stats={stats?.deleteStats}
                icon={<Trash2 className="w-5 h-5" />}
                color="red"
              />
            )}

            {/* Migrate Group */}
            {plan.migrateItems.length > 0 && (
              <DeletionGroup
                title="To Be Migrated (Copied)"
                items={plan.migrateItems}
                stats={stats?.migrateStats}
                icon={<Copy className="w-5 h-5" />}
                color="yellow"
                description="Protected assets will be copied to stable location before deletion"
              />
            )}

            {/* Retain Group */}
            {plan.retainItems.length > 0 && (
              <DeletionGroup
                title="Retained (Shared References)"
                items={plan.retainItems}
                stats={stats?.retainStats}
                icon={<ShieldAlert className="w-5 h-5" />}
                color="blue"
                description="These items are shared with other artifacts and cannot be deleted"
              />
            )}

            {/* Blocker Group */}
            {plan.blockerItems.length > 0 && (
              <DeletionGroup
                title="Blocked from Deletion"
                items={plan.blockerItems}
                stats={stats?.blockerStats}
                icon={<Lock className="w-5 h-5" />}
                color="orange"
                description="These items have blockers preventing deletion"
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
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleExecute}
              disabled={!isConfirmationValid || isExecuting}
            >
              {isExecuting ? "Executing..." : `Delete ${plan.confirmationRequired.count ?? "-"}`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Warning banner showing irreversible nature of deletion
 */
function WarningBanner({ plan }: { plan: DeletionPlan }) {
  const totalItems = plan.deleteItems.length + plan.migrateItems.length + plan.retainItems.length + plan.blockerItems.length;

  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
        <div>
            <h4 className="font-semibold text-red-900">删除后无法恢复</h4>
            <p className="text-sm text-red-700 mt-1">
            本次将处理 {totalItems} 项产物、关联记录、物理文件和历史备份。取消不会产生任何写入。
          </p>
        </div>
      </div>
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
  icon,
  color,
  description,
}: {
  title: string;
  items: PlanItem[];
  stats?: Record<string, number>;
  icon: React.ReactNode;
  color: "red" | "yellow" | "blue" | "orange";
  description?: string;
}) {
  const colorClasses = {
    red: "border-red-200 bg-red-50",
    yellow: "border-yellow-200 bg-yellow-50",
    blue: "border-blue-200 bg-blue-50",
    orange: "border-orange-200 bg-orange-50",
  };

  const badgeColors: Record<string, string> = {
    delete: "bg-destructive text-destructive-foreground",
    migrate: "bg-yellow-100 text-yellow-800",
    retain: "bg-blue-100 text-blue-800",
    blocker: "bg-orange-100 text-orange-800",
  };

  return (
    <div className={cn("border rounded-lg p-4", colorClasses[color])}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <Badge variant="secondary">{items.length} items</Badge>
          {stats && Object.values(stats).reduce((a, b) => a + b, 0) > 0 && (
            <Badge variant="outline">{formatBytes(Object.values(stats).reduce((a, b) => a + b, 0))}</Badge>
          )}
        </div>
        {description && (
          <span className="text-xs text-gray-600 italic">{description}</span>
        )}
      </div>

      {/* Summary by stage/kind */}
      {stats && Object.keys(stats).length > 0 && (
        <div className="mb-3">
          <div className="text-xs text-gray-600 mb-2">Breakdown:</div>
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
            className="text-sm p-2 bg-white/50 rounded hover:bg-white transition-colors cursor-default"
          >
            <div className="flex items-center justify-between">
              <div className="font-medium text-gray-900 truncate">{item.name}</div>
              <div className="text-xs text-gray-600 whitespace-nowrap ml-2">
                {item.bytes ? formatBytes(item.bytes) : ""}
              </div>
            </div>
            <div className="flex items-center gap-2 mt-1 text-xs text-gray-600">
              <Badge variant="secondary" className="text-xs">{item.kind}</Badge>
              <span>{item.stage}</span>
            </div>
            {item.reason && (
              <div className="mt-1 text-xs text-gray-700 bg-white/70 p-1 rounded">
                {item.reason}
              </div>
            )}
          </div>
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
        <h3 className="font-semibold text-gray-900">Backup Impact</h3>
        <Badge variant="secondary">{impacts.length} file(s) affected</Badge>
      </div>

      <div className="space-y-2">
        {impacts.map((impact, idx) => (
          <div key={idx} className="text-sm p-2 bg-white rounded border border-gray-200">
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
        placeholder="Enter to confirm"
        className={cn(
          "flex-1",
          isValid ? "border-green-500 bg-green-50" : "border-red-500"
        )}
      />
      {!isValid && value.length > 0 && (
        <div className="text-xs text-red-600 mt-1">
          Must match exactly: "{placeholder}"
        </div>
      )}
      {isValid && (
        <div className="text-xs text-green-600 mt-1">
          ✓ Confirmed
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
      <p className="text-gray-600">No artifacts found matching criteria</p>
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
      return "Type chapter title to confirm";
    case "chapter-id":
      return "Type chapter ID to confirm";
    case "artifact-count":
      return "Click delete to confirm";
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
