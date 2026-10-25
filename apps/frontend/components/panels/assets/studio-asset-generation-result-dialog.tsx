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
import { Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import type { AssetImageKind } from "@/types/studio-assets";

/**
 * 生成结果弹窗(10-26 用户令:每次点生成完成后自动弹出)——三段确认:
 * ①输入提示词(用户主体句+型/阶段徽章)/②实发终稿(自发桥读刚产物 PNG tEXt→
 * parseWorkflowPrompt,四态降级复刻 prompt-text-dialog 范式,禁编造)/③大模型返回
 * 结果(生成图预览+文件名+全链耗时)。单发=records 单条;批量补缺队列=末尾汇总
 * (records 多条+Select 选记录)。耗时口径定死=全链(删旧图/写库/取产物),非纯引擎。
 */
export interface GenerationOutcomeRecord {
  /** 产物归属资产 id(弹窗侧跨资产守卫用,对齐 10-25 深审修哲学)。 */
  assetId: string;
  assetName: string;
  kind: AssetImageKind;
  stage?: string;
  /** 用户主体句实发链取值(t2i 路=槽>共享句>描述;人脸 text 路同链;重掷=finalText
   *  逐字);null=i2i 族(固定指令锚画面,主体句不参与,①段显固定说明)。 */
  subjectText: string | null;
  imageName: string;
  imageLocalPath?: string;
  /** 写回资产库后的新产物主图路径(仅 savedToLibrary 才带;②段据此读 tEXt)。 */
  managedFilePath?: string;
  previewUrl?: string;
  /** 全链耗时(含删旧图/写库/取产物,非纯引擎耗时;如实显不拆分)。 */
  elapsedMs: number;
  /** true=批量补缺队列逐发记录(弹窗侧累积,末尾汇总呈现)。 */
  fromQueue: boolean;
}

/** 弹窗数据:单发=records 单条+batch null;队列=records 多条+batch 计数(末尾汇总)。 */
export interface GenerationOutcome {
  records: GenerationOutcomeRecord[];
  batch: { total: number; completed: number; abortedKind?: string } | null;
}

/** ②段降级:产物未写回资产库(get 失败/写回失败)→无 managedFilePath 可读。 */
const MANAGED_PATH_MISSING_LABEL = "产物未写回资产库,无法读取实发终稿";

type FinalTextLoadState =
  | { status: "loading" }
  | { status: "failed"; reason: PromptTextFailReason | "bridge-missing" | "not-in-library" }
  | { status: "parsed"; breakdown: WorkflowPromptBreakdown }
  | { status: "raw-only"; rawText: string; driftNote: string };

export function StudioAssetGenerationResultDialog({
  open,
  onOpenChange,
  outcome,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  outcome: GenerationOutcome | null;
}) {
  const records = outcome?.records ?? [];
  const [selectedValue, setSelectedValue] = useState<string>("");
  // 选中记录:Select 值→imageName 匹配;单发/缺省回落首条
  const selected =
    records.find((record) => record.imageName === selectedValue) ?? records[0] ?? null;

  // 换 outcome(新一轮弹窗会话)即复位选择
  useEffect(() => {
    setSelectedValue("");
  }, [outcome]);

  // ② 实发终稿:对选中 record.managedFilePath 自发桥读 tEXt→parseWorkflowPrompt
  // (复刻 prompt-text-dialog 范式:cancelled 旗/桥缺失→固定文案/五态 reason→降级
  // 矩阵/parse 抛错→raw-only 不编造;无 managedFilePath→「未写回资产库」降级)
  const [finalTextState, setFinalTextState] = useState<FinalTextLoadState>({ status: "loading" });
  useEffect(() => {
    if (!open || !selected) {
      setFinalTextState({ status: "loading" });
      return;
    }
    let cancelled = false;
    setFinalTextState({ status: "loading" });
    if (!selected.managedFilePath) {
      setFinalTextState({ status: "failed", reason: "not-in-library" });
      return;
    }
    const bridge = getStudioAssetsBridge();
    if (!bridge?.readImagePromptText) {
      setFinalTextState({ status: "failed", reason: "bridge-missing" });
      return;
    }
    bridge
      .readImagePromptText({ filePath: selected.managedFilePath })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setFinalTextState({ status: "failed", reason: result.reason });
          return;
        }
        try {
          setFinalTextState({ status: "parsed", breakdown: parseWorkflowPrompt(result.text) });
        } catch (error) {
          setFinalTextState({
            status: "raw-only",
            rawText: result.text,
            driftNote: error instanceof Error ? error.message : String(error),
          });
        }
      })
      .catch(() => {
        if (!cancelled) setFinalTextState({ status: "failed", reason: "read-failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [open, selected]);

  if (!outcome || records.length === 0 || !selected) return null;

  const batch = outcome.batch;
  const title = batch
    ? `一键补缺结果 · ${records[0].assetName} · 已完成 ${batch.completed}/${batch.total}${batch.abortedKind ? ` · ${batch.abortedKind}中止` : ""}`
    : `生成结果 · ${selected.kind}`;

  const failedLabel =
    finalTextState.status === "failed"
      ? finalTextState.reason === "bridge-missing"
        ? PROMPT_TEXT_BRIDGE_MISSING_LABEL
        : finalTextState.reason === "not-in-library"
          ? MANAGED_PATH_MISSING_LABEL
          : PROMPT_TEXT_DEGRADATION_LABELS[finalTextState.reason]
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* z-[260]!:基座 z-[250] 经 cn=twMerge 被传入 className 覆盖,子 Overlay 同
          z-[250] 靠 portal 后挂居上(嵌套弹窗层叠坑,方案钉不可省) */}
      <DialogContent className="studio-asset-generation-result-dialog flex max-h-[80vh] w-[720px]! max-w-[720px]! flex-col overflow-hidden p-0 z-[260]!">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="text-base">{title}</DialogTitle>
          <DialogDescription className="sr-only">
            生成结果确认:输入提示词、实发终稿与生成产物。
          </DialogDescription>
          {records.length > 1 && (
            <div className="mt-1 flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">记录</span>
              <Select value={selected.imageName} onValueChange={setSelectedValue}>
                <SelectTrigger className="h-6 w-auto gap-1 px-2 py-0 text-[11px]" aria-label="记录">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {records.map((record) => (
                    <SelectItem
                      key={`${record.assetId}__${record.imageName}`}
                      value={record.imageName}
                      className="text-xs"
                    >
                      {record.imageName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </DialogHeader>
        <ScrollArea className="studio-asset-prompt-text-scrollbar min-h-0 flex-1 [&>[data-radix-scroll-area-viewport]>div]:block!">
          <div className="space-y-3 p-5">
            {/* ① 输入提示词(用户主体句+型/阶段徽章;i2i 族主体句不参与→固定说明) */}
            <section className="space-y-1 rounded-md border border-border/60 bg-muted/30 p-2.5" aria-label="输入提示词">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-semibold text-foreground">① 输入提示词</span>
                <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-medium">{selected.kind}</Badge>
                {selected.stage && (
                  <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-medium text-muted-foreground">{selected.stage}</Badge>
                )}
              </div>
              <p className="whitespace-pre-wrap text-[11px] leading-5 text-foreground/90">
                {selected.subjectText ?? `${selected.kind}走图生图:固定指令锚画面,主体句不参与`}
              </p>
            </section>
            {/* ② 实发终稿(发给模型的最后一个阶段提示词,自发读刚产物 tEXt) */}
            <section className="space-y-1 rounded-md border border-border/60 bg-muted/30 p-2.5" aria-label="实发终稿">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-semibold text-foreground">② 实发终稿(发给模型的最后阶段提示词)</span>
                {finalTextState.status === "parsed" && (
                  <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-medium">
                    {finalTextState.breakdown.routeHint === "i2i" ? "图生图" : "文生图"}
                  </Badge>
                )}
              </div>
              {finalTextState.status === "loading" && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  正在读取提示词元数据…
                </div>
              )}
              {finalTextState.status === "failed" && (
                <p className="text-xs leading-5 text-muted-foreground" role="status">
                  {failedLabel}
                </p>
              )}
              {finalTextState.status === "raw-only" && (
                <div className="space-y-1">
                  <p className="text-[11px] leading-4 text-muted-foreground" title={finalTextState.driftNote}>
                    解析失败({finalTextState.driftNote}):无法解构终稿,以下为原始 tEXt。
                  </p>
                  <p className="max-h-[30vh] overflow-y-auto whitespace-pre-wrap rounded-md border border-border/60 bg-muted/30 p-2.5 text-[11px] leading-5 text-foreground/90">
                    {finalTextState.rawText}
                  </p>
                </div>
              )}
              {finalTextState.status === "parsed" && (
                <p className="whitespace-pre-wrap text-[11px] leading-5 text-foreground/90">
                  {finalTextState.breakdown.finalText}
                </p>
              )}
            </section>
            {/* ③ 大模型返回结果(生成图预览+文件名+全链耗时) */}
            <section className="space-y-1" aria-label="生成结果">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground">③ 生成结果</span>
                <span
                  className="text-[11px] text-muted-foreground"
                  title="全链耗时:含删旧图/写回资产库/取产物,非纯引擎耗时"
                >
                  {(selected.elapsedMs / 1000).toFixed(1)} 秒
                </span>
              </div>
              {selected.previewUrl ? (
                <img
                  src={selected.previewUrl}
                  alt={selected.imageName}
                  className="max-h-[40vh] w-full rounded-md border border-border object-contain"
                />
              ) : (
                <div className="flex h-32 items-center justify-center rounded-md border border-dashed border-border text-[11px] text-muted-foreground">
                  无预览图
                </div>
              )}
              <p className="truncate text-[11px] text-muted-foreground" title={selected.imageName}>
                {selected.imageName}
              </p>
            </section>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
