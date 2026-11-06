import type { SidecarJobReply } from "@/lib/assist/image-studio/comfy-sidecar-bridge";

const TORCH_STEPS = [
  ["preflight", "预检"], ["snapshot", "快照"], ["stop-engine", "停止引擎"],
  ["install", "安装"], ["verify-import", "导入验证"], ["restart", "重启"],
  ["smoke", "烟测"], ["ledger", "落账"],
] as const;

export function TorchUpgradeProgress({ job, warning }: { job: SidecarJobReply; warning?: string | null }) {
  const current = TORCH_STEPS.findIndex(([name]) => name === job.step);
  return <div className="space-y-1" data-testid="torch-upgrade-progress">
    {TORCH_STEPS.map(([step, label], index) => {
      const state = job.status === "complete" || index < current ? "✅" : index === current ? (job.status === "error" ? "❌" : "⏳") : "⬜";
      return <div key={step} className="text-xs">{state} {label}</div>;
    })}
    <p className="text-xs text-muted-foreground">{job.message}</p>
    {warning && <p className="text-xs text-warning">{warning}</p>}
    {job.tail?.length ? <pre className="max-h-28 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{job.tail.join("\n")}</pre> : null}
  </div>;
}
