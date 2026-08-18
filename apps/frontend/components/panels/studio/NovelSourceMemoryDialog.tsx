import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { aiManager } from "@/lib/ai/ai-manager";
import {
  getSourceMemoryBridge,
  runSourceMemoryExtraction,
  type SourceMemoryExtractionProgress,
  type SourceMemoryExtractionSummary,
} from "@/lib/studio/source-memory";
import type { SourceMemorySearchHit, SourceMemoryStatusReply } from "@/types/source-memory";
import { Database, Search } from "lucide-react";
import { toast } from "sonner";

const STATUS_LABEL: Record<string, string> = {
  idle: "未构建",
  ready: "就绪",
  partial: "部分完成",
  failed: "失败",
};

const STATUS_CLASS: Record<string, string> = {
  idle: "border-border bg-muted text-muted-foreground",
  ready: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  partial: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  failed: "border-red-500/40 bg-red-500/10 text-red-400",
};

function degradedReasonText(reason?: string): string | undefined {
  if (!reason) return undefined;
  if (reason.startsWith("extraction-pending:")) {
    return `${reason.split(":")[1]} 个章节待智能抽取（重建后完成）`;
  }
  if (reason.startsWith("extraction-failed:")) {
    return `${reason.split(":")[1]} 个片段抽取失败，已保留原文检索`;
  }
  return reason;
}

/** 原著记忆库管理：状态/记录数/失效原因 + 显式重建（增量重抽变化章节）+ 检索自测。 */
export function NovelSourceMemoryDialog(props: {
  open: boolean;
  projectId?: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const bridge = getSourceMemoryBridge();
  const [status, setStatus] = useState<SourceMemoryStatusReply | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [progress, setProgress] = useState<SourceMemoryExtractionProgress | null>(null);
  const [summary, setSummary] = useState<SourceMemoryExtractionSummary | null>(null);
  const [searchText, setSearchText] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchHits, setSearchHits] = useState<SourceMemorySearchHit[] | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!bridge || !props.projectId) return;
    try {
      setStatus(await bridge.status(props.projectId));
    } catch {
      setStatus({ success: false });
    }
  }, [bridge, props.projectId]);

  useEffect(() => {
    if (props.open) void refreshStatus();
  }, [props.open, refreshStatus]);

  const handleRebuild = useCallback(async () => {
    if (!props.projectId || !bridge) return;
    if (!aiManager.resolve({ agent: "universalAi" })) {
      toast.error("未配置通用AI模型，请先到设置的云端AI中绑定通用AI");
      return;
    }
    setRebuilding(true);
    setProgress(null);
    setSummary(null);
    try {
      const result = await runSourceMemoryExtraction({
        projectId: props.projectId,
        bridge,
        callText: async (messages) => {
          const reply = await aiManager.text({
            binding: { agent: "universalAi" },
            messages: [
              { role: "system", content: messages.system },
              { role: "user", content: messages.user },
            ],
            temperature: 0.2,
            maxTokens: 4096,
            // 抽取要快速失败：通道不通时 2 分钟内给出结论，不空磨重试
            timeoutMs: 120_000,
          });
          if (!reply.success || !reply.text) {
            throw new Error(reply.error || "AI 调用失败");
          }
          return reply.text;
        },
        onProgress: setProgress,
      });
      setSummary(result);
      if (!result.success) {
        toast.error(`原著记忆库重建失败：${result.error ?? "未知错误"}`);
      } else if (result.status === "partial") {
        toast.warning(`重建完成（部分）：${result.failedChunks} 个片段抽取失败，原文检索保留`);
      } else if (result.status === "nothing-to-do") {
        toast.success("原著记忆库已是最新，无变化章节需要重抽");
      } else {
        toast.success(`原著记忆库重建完成：${result.structuredCount} 条结构化记录`);
      }
      await refreshStatus();
    } finally {
      setRebuilding(false);
    }
  }, [bridge, props.projectId, refreshStatus]);

  const handleSearch = useCallback(async () => {
    if (!props.projectId || !bridge) return;
    const query = searchText.trim();
    if (!query) return;
    setSearching(true);
    try {
      const result = await bridge.search(props.projectId, query, 6);
      setSearchHits(result.success && result.hits ? result.hits : []);
    } catch {
      setSearchHits([]);
    } finally {
      setSearching(false);
    }
  }, [bridge, props.projectId, searchText]);

  const reasonText = degradedReasonText(status?.degradedReason);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-4 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>原著记忆库</DialogTitle>
          <p className="text-xs text-muted-foreground">
            项目随行的原著档案：圣经与章节切块入本地全文检索，变化章节经 AI 增量抽取为
            11 类结构化事实（人物/关系/事件/伏笔等），供事件分析、剧本链、导演计划、分镜表按需检索注入。
          </p>
        </DialogHeader>

        {!bridge ? (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            当前环境不支持原著记忆库（需要 Electron 主进程 IPC）。
          </p>
        ) : (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
            <section className="space-y-2 rounded-lg border border-border bg-panel/40 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs ${
                    STATUS_CLASS[status?.status ?? "idle"] ?? STATUS_CLASS.idle
                  }`}
                >
                  <Database className="h-3 w-3" />
                  {STATUS_LABEL[status?.status ?? "idle"] ?? status?.status ?? "未构建"}
                </span>
                {status?.builtAt ? (
                  <span className="text-xs text-muted-foreground">
                    构建于 {new Date(status.builtAt).toLocaleString()}
                  </span>
                ) : null}
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">结构化记录</dt>
                  <dd>{status?.structuredCount ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">原文块</dt>
                  <dd>{status?.rawCount ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">总记录</dt>
                  <dd>{status?.recordCount ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">buildId</dt>
                  <dd className="truncate" title={status?.buildId}>
                    {status?.buildId ?? "—"}
                  </dd>
                </div>
              </dl>
              {reasonText ? (
                <p className="text-xs text-amber-400">状态原因：{reasonText}</p>
              ) : null}
              {progress ? (
                <p className={`text-xs ${progress.failed ? "text-amber-400" : "text-muted-foreground"}`}>
                  抽取进度：{progress.done}/{progress.total}
                  {progress.failed ? `（失败 ${progress.failed}）` : ""}
                  {progress.lastError ? ` · 最近错误：${progress.lastError.slice(0, 80)}` : ""}
                </p>
              ) : null}
              {summary?.success && summary.status !== "nothing-to-do" ? (
                <p className="text-xs text-muted-foreground">
                  上次重建：{summary.status === "ready" ? "全部完成" : `失败 ${summary.failedChunks} 片段`}
                  ，结构化 {summary.structuredCount} 条 / 原文 {summary.rawCount} 条
                </p>
              ) : null}
            </section>

            <section className="space-y-2">
              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchText}
                    onChange={(event) => setSearchText(event.target.value)}
                    onKeyDown={(event) => event.key === "Enter" && void handleSearch()}
                    className="pl-9"
                    placeholder="检索自测：输入人名/事件，如「晏燎」"
                  />
                </div>
                <Button
                  variant="outline"
                  disabled={!searchText.trim() || searching}
                  onClick={() => void handleSearch()}
                >
                  {searching ? "查询中…" : "查询"}
                </Button>
              </div>
              {searchHits !== null ? (
                searchHits.length ? (
                  <ul className="space-y-1.5">
                    {searchHits.map((hit) => (
                      <li
                        key={hit.recordId}
                        className="rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-xs"
                      >
                        <span className="mr-1.5 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                          {hit.kind}
                        </span>
                        <span className="font-medium">{hit.title}</span>
                        <span className="text-muted-foreground">（{hit.sourcePath}）</span>
                        <p className="mt-0.5 text-muted-foreground">{hit.snippet}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">无命中（未构建或库中无此内容）。</p>
                )
              ) : null}
            </section>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            关闭
          </Button>
          {bridge ? (
            <Button disabled={rebuilding || !props.projectId} onClick={() => void handleRebuild()}>
              {rebuilding ? "重建中…" : "重建记忆库"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
