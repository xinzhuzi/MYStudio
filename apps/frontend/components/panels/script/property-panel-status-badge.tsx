import type { CompletionStatus } from '@/types/script';

export function PropertyPanelStatusBadge({ status }: { status?: CompletionStatus }) {
  const config = {
    pending: { label: '未开始', className: 'bg-muted text-muted-foreground' },
    in_progress: { label: '进行中', className: 'bg-warning/10 text-warning' },
    completed: { label: '已完成', className: 'bg-success/10 text-success' },
  };
  const { label, className } = config[status || 'pending'];
  return <span className={`px-2 py-0.5 rounded text-xs ${className}`}>{label}</span>;
}
