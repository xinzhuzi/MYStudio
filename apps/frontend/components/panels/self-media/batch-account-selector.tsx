import { useMemo } from "react";
import { AlertCircle, CheckSquare, Square, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SelfMediaAccount } from "@/types/self-media";
import { groupAccountsByPlatform, type BatchAccountValidation, validateBatchAccounts } from "@/lib/self-media/batch-publish";

interface BatchAccountSelectorProps {
  accounts: SelfMediaAccount[];
  contentType: "video" | "image-text";
  /** L6: 主进程台账的当日计数,由父组件注入(点击发布时的判定以此为同一口径) */
  dailyCounts?: Record<string, number>;
  selectedAccountIds: string[];
  onSelectionChange: (accountIds: string[]) => void;
}

export function BatchAccountSelector({
  accounts,
  contentType,
  dailyCounts,
  selectedAccountIds,
  onSelectionChange,
}: BatchAccountSelectorProps) {
  const validations = useMemo(
    () => validateBatchAccounts(accounts, contentType, dailyCounts),
    [accounts, contentType, dailyCounts],
  );

  const validationMap = useMemo(
    () => new Map<string, BatchAccountValidation>(validations.map((v) => [v.accountId, v])),
    [validations],
  );

  const groups = useMemo(
    () => groupAccountsByPlatform(accounts.filter((a) => validationMap.get(a.id)?.eligible)),
    [accounts, validationMap],
  );

  const ineligibleAccounts = useMemo(
    () => accounts.filter((a) => !validationMap.get(a.id)?.eligible),
    [accounts, validationMap],
  );

  function toggleAccount(accountId: string) {
    if (selectedAccountIds.includes(accountId)) {
      onSelectionChange(selectedAccountIds.filter((id) => id !== accountId));
    } else {
      onSelectionChange([...selectedAccountIds, accountId]);
    }
  }

  function togglePlatformGroup(platformAccountIds: string[]) {
    const allSelected = platformAccountIds.every((id) => selectedAccountIds.includes(id));
    if (allSelected) {
      onSelectionChange(selectedAccountIds.filter((id) => !platformAccountIds.includes(id)));
    } else {
      const next = new Set([...selectedAccountIds, ...platformAccountIds]);
      onSelectionChange([...next]);
    }
  }

  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 bg-background/80 px-4 py-8 text-center">
        <Users className="mx-auto h-8 w-8 text-muted-foreground/40" />
        <p className="mt-3 text-sm font-medium text-muted-foreground">
          没有可用的跨平台账号
        </p>
        <p className="mt-1 text-xs text-muted-foreground/80">
          请先在"账号"视图连接各平台
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const groupAccountIds = group.accounts.map((a) => a.id);
        const allGroupSelected = groupAccountIds.every((id) => selectedAccountIds.includes(id));
        const someGroupSelected = groupAccountIds.some((id) => selectedAccountIds.includes(id));

        return (
          <div
            key={group.platform}
            className="rounded-lg border border-border/50 bg-background/80 p-2.5 transition-colors duration-200 hover:border-border/70"
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => togglePlatformGroup(groupAccountIds)}
              className="h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5 text-left"
            >
              {allGroupSelected
                ? <CheckSquare className="h-4 w-4 shrink-0 text-primary" />
                : someGroupSelected
                  ? <CheckSquare className="h-4 w-4 shrink-0 text-primary/50" />
                  : <Square className="h-4 w-4 shrink-0 text-muted-foreground" />}
              <span className="text-sm font-semibold text-foreground">{group.displayName}</span>
              {group.abbreviation !== group.displayName && (
                <Badge variant="outline" className="text-xs font-normal">{group.abbreviation}</Badge>
              )}
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                {group.accounts.length} 个账号
              </span>
            </Button>
            <div className="mt-1 space-y-0.5 pl-2">
              {group.accounts.map((account) => {
                const isSelected = selectedAccountIds.includes(account.id);
                return (
                  <label
                    key={account.id}
                    className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors duration-150 hover:bg-muted/90 ${
                      isSelected ? "bg-primary/10" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleAccount(account.id)}
                      className="h-3.5 w-3.5 accent-primary"
                    />
                    <span className={`truncate ${isSelected ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                      {account.displayName}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
      {ineligibleAccounts.length > 0 && (
        <div className="rounded-lg border border-border/40 bg-muted/80 p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            以下账号暂不可用
          </p>
          <ul className="mt-1.5 space-y-1">
            {ineligibleAccounts.map((account) => (
              <li key={account.id} className="flex items-baseline gap-1.5 text-xs text-muted-foreground/80">
                <span className="shrink-0 text-muted-foreground">{account.displayName}</span>
                <span className="shrink-0 text-muted-foreground/50">·</span>
                <span className="truncate">{validationMap.get(account.id)?.reason ?? "未知原因"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
