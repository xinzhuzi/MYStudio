import { useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { getPersistenceFailures, subscribePersistenceFailures } from '@/lib/storage/persistence-status';

export function PersistenceFailureBanner() {
  const failures = useSyncExternalStore(subscribePersistenceFailures, getPersistenceFailures);
  const [busy, setBusy] = useState(false);
  if (failures.length === 0) return null;
  const retry = async () => {
    setBusy(true);
    try { await Promise.allSettled(failures.map(failure => failure.retry?.())); }
    finally { setBusy(false); }
  };
  return (
    <div role="alert" className="fixed bottom-4 left-4 right-4 z-50 flex items-center justify-between gap-4 rounded-lg border border-destructive/40 bg-background p-4 shadow-none">
      <div className="min-w-0 text-sm">
        <p className="font-medium text-destructive">数据尚未保存到磁盘</p>
        <p className="text-muted-foreground">当前编辑仍保留在本次会话中，请勿关闭应用。</p>
        {failures.map(failure => <p key={failure.key} className="truncate text-xs text-muted-foreground">{failure.message}</p>)}
        {failures.some(failure => failure.operation === 'read') && <p className="text-xs text-muted-foreground">无法读取的原数据已受保护；恢复磁盘访问后重新打开应用以加载。</p>}
      </div>
      {failures.some(failure => failure.retry) && <Button variant="outline" size="sm" disabled={busy} onClick={() => void retry()}>{busy ? '重试中…' : '重试保存'}</Button>}
    </div>
  );
}
