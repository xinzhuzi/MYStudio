import { useMemo } from "react";
import { CheckSquare, Square } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SelfMediaAccount } from "@/types/self-media";
import { groupAccountsByPlatform, type BatchAccountValidation, validateBatchAccounts } from "@/lib/self-media/batch-publish";

interface BatchAccountSelectorProps {
  accounts: SelfMediaAccount[];
  contentType: "video" | "image-text";
  selectedAccountIds: string[];
  onSelectionChange: (accountIds: string[]) => void;
}

export function BatchAccountSelector({
  accounts,
  contentType,
  selectedAccountIds,
  onSelectionChange,
}: BatchAccountSelectorProps) {
  const validations = useMemo(
    () => validateBatchAccounts(accounts, contentType),
    [accounts, contentType],
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
      <div className="rounded-lg border border-dashed border-border/70 px-4 py-6 text-center text-xs text-muted-foreground">
        没有可用的跨平台账号，请先在"账号"视图连接各平台。
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
          <div key={group.platform} className="rounded-lg border border-border/60 bg-background/30 p-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => togglePlatformGroup(groupAccountIds)}
              className="flex w-full items-center gap-2 text-left"
            >
              {allGroupSelected
                ? <CheckSquare className="h-4 w-4 shrink-0 text-primary" />
                : someGroupSelected
                  ? <CheckSquare className="h-4 w-4 shrink-0 text-primary/50" />
                  : <Square className="h-4 w-4 shrink-0 text-muted-foreground" />}
              <span className="text-sm font-medium">{group.displayName}</span>
              <Badge variant="outline" className="ml-auto text-xs">[{group.abbreviation}]</Badge>
              <span className="text-xs text-muted-foreground">{group.accounts.length} 账号</span>
            </Button>
            <div className="mt-2 space-y-1 pl-6">
              {group.accounts.map((account) => {
                const isSelected = selectedAccountIds.includes(account.id);
                return (
                  <label
                    key={account.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted/40"
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleAccount(account.id)}
                      className="h-3.5 w-3.5"
                    />
                    <span className="truncate">{account.displayName}</span>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
      {ineligibleAccounts.length > 0 && (
        <div className="rounded-lg border border-border/40 bg-muted/20 p-2">
          <p className="mb-1 text-xs text-muted-foreground">以下账号暂不可用：</p>
          {ineligibleAccounts.map((account) => (
            <p key={account.id} className="text-xs text-muted-foreground/70">
              {account.displayName}：{validationMap.get(account.id)?.reason ?? "未知原因"}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
