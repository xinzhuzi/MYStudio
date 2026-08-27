import { toast } from "sonner";

export interface BatchFailureReporter {
  /**
   * 记录一项失败。同一原因的失败复用同一条 toast 并累加计数(sonner 同 id 替换刷新),
   * 批量场景不再弹一摞一模一样的复读弹窗;不同原因各自一条。
   */
  report: (title: string, reason: string) => void;
}

/** noun 如「分镜」「资产」,用于计数文案 */
export function createBatchFailureReporter(noun: string): BatchFailureReporter {
  const groups = new Map<string, { id: string; count: number }>();
  return {
    report(title, reason) {
      const key = reason.trim() || "未知错误";
      const existing = groups.get(key);
      if (existing) {
        existing.count += 1;
        toast.error(`${existing.count} 个${noun}生成失败(同一原因):${key}`, { id: existing.id });
        return;
      }
      const id = `batch-failure:${noun}:${key.slice(0, 40)}:${groups.size + 1}`;
      groups.set(key, { id, count: 1 });
      toast.error(`${title} 生成失败:${key}`, { id });
    },
  };
}
