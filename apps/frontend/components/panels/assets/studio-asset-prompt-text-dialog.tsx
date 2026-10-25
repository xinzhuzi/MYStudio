"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Copy, Dices, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";
import {
  parseWorkflowPrompt,
  type WorkflowPromptBreakdown,
} from "@/lib/studio/workflow-prompt-parser";
import {
  PROMPT_TEXT_BRIDGE_MISSING_LABEL,
  PROMPT_TEXT_DEGRADATION_LABELS,
  type PromptTextFailReason,
} from "@/lib/studio/asset-prompt-inspect";

/**
 * 提示词 tEXt 查询弹层(10-25-asset-prompt-layered-panel A-2③/B-3 共用壳):
 * 打开时经 studioAssets 桥只读原图 tEXt(B-1 通道)→workflow-prompt-parser 解构→
 * 按层展示(正向终稿/注入层全文/负面/seed/路);失败走 §4.4 降级矩阵文案,禁编造。
 * ③实发终稿与查词共用本壳,差异只在 title/ownerNote/footnote(调用方注入)。
 */
export interface PromptTextInspectTarget {
  /** 原图文件路径(B-1 白名单受管路径;缩略图剥 tEXt,恒走原图)。 */
  imagePath: string;
  imageName: string;
  /** 弹层标题(调用方拼好,如「无衣物定妆 · 实发终稿」/「查词 · 晏燎_无衣物定妆_v1」)。 */
  title: string;
  /** 族兄弟归属标注(「来自同族资产 {名}」,§4.4 矩阵);null/undefined=不标注。 */
  ownerNote?: string | null;
  /** 底部小字(③:「来自该型最近产物的引擎实收,非本次预演」);查词不带。 */
  footnote?: string;
  /** 原图 url(B-4 重掷 i2i 路参考图;i2i 且缺 url 时重掷钮置灰)。 */
  imageUrl?: string;
}

type PromptTextLoadState =
  | { status: "loading" }
  | { status: "failed"; reason: PromptTextFailReason | "bridge-missing" }
  | { status: "parsed"; breakdown: WorkflowPromptBreakdown; rawText: string }
  | { status: "raw-only"; rawText: string; driftNote: string };

function copyToClipboard(text: string, successLabel: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    toast.error("内容为空");
    return;
  }
  if (!navigator.clipboard?.writeText) {
    toast.error("当前环境不支持复制");
    return;
  }
  void navigator.clipboard.writeText(trimmed).then(
    () => toast.success(successLabel),
    () => toast.error("复制失败"),
  );
}

export function StudioAssetPromptTextDialog({
  open,
  onOpenChange,
  target,
  onReroll,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: PromptTextInspectTarget | null;
  /** B-4 用此词重掷(10-25 追加令):parsed 态弹层带「用此词重掷」钮,点击回传
   *  解析结果(正向终稿/路/注入层);重发由调用方动作执行,弹层保持只读展示。 */
  onReroll?: (info: { breakdown: WorkflowPromptBreakdown }) => void;
}) {
  const [state, setState] = useState<PromptTextLoadState>({ status: "loading" });

  // 打开/换目标即重读(B-1 只读通道);解析失败(tEXt 在但键位漂移)降级展示原始
  // tEXt+漂移注记,不吞不编。卸载/重开竞态用 cancelled 旗防旧结果覆写新目标。
  useEffect(() => {
    if (!open || !target) {
      setState({ status: "loading" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    const bridge = getStudioAssetsBridge();
    if (!bridge?.readImagePromptText) {
      setState({ status: "failed", reason: "bridge-missing" });
      return;
    }
    bridge
      .readImagePromptText({ filePath: target.imagePath })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setState({ status: "failed", reason: result.reason });
          return;
        }
        try {
          setState({ status: "parsed", breakdown: parseWorkflowPrompt(result.text), rawText: result.text });
        } catch (error) {
          setState({
            status: "raw-only",
            rawText: result.text,
            driftNote: error instanceof Error ? error.message : String(error),
          });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: "failed", reason: "read-failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [open, target]);

  const failedLabel =
    state.status === "failed"
      ? state.reason === "bridge-missing"
        ? PROMPT_TEXT_BRIDGE_MISSING_LABEL
        : PROMPT_TEXT_DEGRADATION_LABELS[state.reason]
      : null;

  return (
    <Dialog open={open && !!target} onOpenChange={onOpenChange}>
      <DialogContent className="studio-asset-prompt-text-dialog flex max-h-[80vh] w-[720px]! max-w-[720px]! flex-col overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="flex min-w-0 items-center gap-2 text-base">
            <span className="truncate">{target?.title ?? "提示词"}</span>
          </DialogTitle>
          <DialogDescription className="sr-only">
            查看该图引擎实收的提示词元数据分层内容。
          </DialogDescription>
          {target?.ownerNote ? (
            <p className="text-[11px] leading-4 text-primary/90" title={target.ownerNote}>
              {target.ownerNote}
            </p>
          ) : null}
        </DialogHeader>
        <ScrollArea className="studio-asset-prompt-text-scrollbar min-h-0 flex-1 [&>[data-radix-scroll-area-viewport]>div]:block!">
          <div className="space-y-3 p-5">
            {state.status === "loading" && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                正在读取提示词元数据…
              </div>
            )}
            {state.status === "failed" && (
              <p className="text-xs leading-5 text-muted-foreground" role="status">
                {failedLabel}
              </p>
            )}
            {state.status === "raw-only" && (
              <section className="space-y-2" aria-label="原始提示词元数据">
                <p className="text-[11px] leading-4 text-muted-foreground" title={state.driftNote}>
                  解析失败({state.driftNote}):无法分层展示,以下为原始 tEXt。
                </p>
                <p className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-md border border-border/60 bg-muted/30 p-2.5 text-[11px] leading-5 text-foreground/90">
                  {state.rawText}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 gap-1 text-[11px]"
                  onClick={() => copyToClipboard(state.rawText, "已复制原始 tEXt")}
                >
                  <Copy className="h-3 w-3" />
                  复制原始 tEXt
                </Button>
              </section>
            )}
            {state.status === "parsed" && (
              <div className="space-y-3" aria-label="提示词分层">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-medium">
                    {state.breakdown.routeHint === "i2i" ? "图生图" : "文生图"}
                  </Badge>
                  {state.breakdown.seed !== null && (
                    <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-medium text-muted-foreground">
                      seed {state.breakdown.seed}
                    </Badge>
                  )}
                  <span className="min-w-0 truncate text-[11px] text-muted-foreground" title={target?.imageName}>
                    {target?.imageName}
                  </span>
                </div>
                <section className="space-y-1 rounded-md border border-border/60 bg-muted/30 p-2.5" aria-label="正向终稿">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-foreground">正向终稿</span>
                    <div className="flex shrink-0 items-center gap-1">
                      {onReroll && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 gap-1 text-[11px]"
                          disabled={state.breakdown.routeHint === "i2i" && !target?.imageUrl}
                          title={state.breakdown.routeHint === "i2i" && !target?.imageUrl ? "图生图路重掷缺参考图 url" : "以该正向终稿按原路再生成一张(同配方新掷)"}
                          onClick={() => onReroll({ breakdown: state.breakdown })}
                        >
                          <Dices className="h-3 w-3" />
                          用此词重掷
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 gap-1 text-[11px]"
                        onClick={() => copyToClipboard(state.breakdown.finalText, "已复制终稿全文")}
                      >
                        <Copy className="h-3 w-3" />
                        复制全文
                      </Button>
                    </div>
                  </div>
                  <p className="whitespace-pre-wrap text-[11px] leading-5 text-foreground/90">
                    {state.breakdown.finalText}
                  </p>
                </section>
                {state.breakdown.layers.length > 0 && (
                  <section className="space-y-2" aria-label="注入层全文">
                    <div className="text-xs font-semibold text-foreground">注入层全文</div>
                    {state.breakdown.layers.map((layer) => (
                      <div key={layer.name} className="space-y-1 rounded-md border border-border/60 bg-muted/30 p-2.5">
                        <div className="text-[10px] font-medium text-muted-foreground">{layer.name}</div>
                        <p className="whitespace-pre-wrap text-[11px] leading-5 text-foreground/90">{layer.text}</p>
                      </div>
                    ))}
                  </section>
                )}
                <section className="space-y-1 rounded-md border border-border/60 bg-muted/30 p-2.5" aria-label="负面">
                  <div className="text-xs font-semibold text-foreground">负面(可读源)</div>
                  <p className="whitespace-pre-wrap text-[11px] leading-5 text-foreground/90">
                    {state.breakdown.negative || "(无可读负面文本)"}
                  </p>
                </section>
              </div>
            )}
            {target?.footnote ? (
              <p className="border-t border-border/40 pt-2 text-[10px] leading-4 text-muted-foreground/80">
                {target.footnote}
              </p>
            ) : null}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
