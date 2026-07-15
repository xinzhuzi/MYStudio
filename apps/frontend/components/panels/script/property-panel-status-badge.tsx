import type { CompletionStatus } from '@/types/script';

export function PropertyPanelStatusBadge({ status }: { status?: CompletionStatus }) {
  const config = {
    pending: { label: '未开始', className: 'bg-muted text-muted-foreground' },
    in_progress: { label: '进行中', className: 'bg-yellow-500/10 text-yellow-600' },
    completed: { label: '已完成', className: 'bg-green-500/10 text-green-600' },
  };
  const { label, className } = config[status || 'pending'];
  return <span className={`px-2 py-0.5 rounded text-xs ${className}`}>{label}</span>;
}
