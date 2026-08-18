import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Wand2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { SeriesMeta } from "@/types/script";
import {
  mergeFillIntoMeta,
  OVERVIEW_FILL_FIELD_LABELS,
  runOverviewMetaFill,
  type OverviewFillQuestions,
} from "@/lib/studio/overview-meta-fill";

/** 概览元数据 AI 填充：问答收集意图 → 生成 → 逐字段预览确认。
 *  问答答案仅约束本次生成不落盘；默认只填空字段，勾选可覆盖已有值。 */

const TONE_OPTIONS = ["忠实原著", "适度改编", "大胆改编", "商业快节奏"] as const;
const FOCUS_OPTIONS = ["主题", "人物弧光", "世界观", "情节节奏"] as const;
const DETAIL_OPTIONS = ["极简（一句话）", "标准（百字）", "完整（故事线）"] as const;

type Phase = "idle" | "questions" | "loading" | "preview";

function formatValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        item && typeof item === "object"
          ? `${(item as Record<string, unknown>).name ?? ""}${(item as Record<string, unknown>).members ? `（${String((item as Record<string, unknown>).members)}）` : ""}`
          : String(item),
      )
      .join("、");
  }
  return String(value ?? "");
}

export function OverviewAiFill(props: {
  meta: SeriesMeta;
  onApply: (updates: Partial<SeriesMeta>) => void;
  buildContext: () => Promise<string | undefined>;
  /** 提示里的「写入作者偏好」跳转 */
  onOpenPreference?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [tone, setTone] = useState<string>("");
  const [focus, setFocus] = useState<string[]>([]);
  const [detailLevel, setDetailLevel] = useState<string>("");
  const [proposal, setProposal] = useState<Record<string, unknown> | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const questions = useMemo<OverviewFillQuestions>(() => ({
    tone: tone || undefined,
    focus: focus.length ? focus : undefined,
    detailLevel: detailLevel || undefined,
  }), [tone, focus, detailLevel]);

  const runFill = useCallback(
    async (withQuestions: boolean) => {
      setPhase("loading");
      try {
        const context = (await props.buildContext()) || "";
        if (!context.trim()) {
          toast.error("暂无可用于填充的素材（原著记忆库/剧本均为空）");
          setPhase("idle");
          return;
        }
        const { aiManager } = await import("@/lib/ai/ai-manager");
        const result = await runOverviewMetaFill({
          context,
          currentMeta: props.meta,
          questions: withQuestions ? questions : undefined,
          callText: async (messages): Promise<string> => {
            const reply = await aiManager.text({
              binding: { agent: "universalAi" },
              messages: [
                { role: "system", content: messages.system },
                { role: "user", content: messages.user },
              ],
              temperature: 0.4,
              maxTokens: 2048,
              fallbackToUniversal: false,
            });
            if (!reply.success || !reply.text) throw new Error(reply.error || "AI 返回失败");
            return reply.text;
          },
        });
        if (!result.ok || !result.fields) {
          toast.error(`AI 填充失败：${result.error ?? "未知错误"}`);
          setPhase("idle");
          return;
        }
        // 默认勾选：当前为空的字段
        const defaults: Record<string, boolean> = {};
        const currentRecord = props.meta as unknown as Record<string, unknown>;
        for (const key of Object.keys(result.fields)) {
          const value = currentRecord[key];
          const empty = value === undefined || value === null || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && value.length === 0);
          defaults[key] = empty;
        }
        setProposal(result.fields);
        setSelected(defaults);
        setPhase("preview");
      } catch (error) {
        toast.error(`AI 填充失败：${error instanceof Error ? error.message : String(error)}`);
        setPhase("idle");
      }
    },
    [props, questions],
  );

  const applySelected = useCallback(() => {
    if (!proposal) return;
    const chosen: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(proposal)) {
      if (selected[key]) chosen[key] = value;
    }
    if (Object.keys(chosen).length === 0) {
      toast.info("未勾选任何字段");
      return;
    }
    const updates = mergeFillIntoMeta(props.meta, chosen, { overwrite: true });
    props.onApply(updates);
    toast.success(`已填充 ${Object.keys(updates).length} 个字段`);
    setPhase("idle");
    setProposal(null);
  }, [proposal, selected, props]);

  const toggleFocus = (option: string) => {
    setFocus((prev) => (prev.includes(option) ? prev.filter((x) => x !== option) : [...prev, option]));
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={phase === "loading"}
        onClick={() => {
          setTone("");
          setFocus([]);
          setDetailLevel("");
          setPhase("questions");
        }}
      >
        {phase === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
        AI 填充
      </Button>

      {/* R3 问答：可全部跳过 */}
      <Dialog open={phase === "questions"} onOpenChange={(open) => !open && setPhase("idle")}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>AI 填充 · 改编意图</DialogTitle>
            <p className="text-xs text-muted-foreground">
              回答会影响生成侧重；全部跳过=纯素材推断。答案只用于本次，不保存。
            </p>
          </DialogHeader>
          <div className="space-y-4 max-h-[55vh] overflow-y-auto">
            <div className="space-y-2">
              <Label className="text-sm">改编基调</Label>
              <RadioGroup value={tone} onValueChange={setTone}>
                {TONE_OPTIONS.map((option) => (
                  <div key={option} className="flex items-center gap-2">
                    <RadioGroupItem value={option} id={`tone-${option}`} />
                    <Label htmlFor={`tone-${option}`} className="font-normal text-sm">{option}</Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">侧重维度（多选）</Label>
              <div className="flex flex-wrap gap-3">
                {FOCUS_OPTIONS.map((option) => (
                  <div key={option} className="flex items-center gap-1.5">
                    <Checkbox
                      checked={focus.includes(option)}
                      onCheckedChange={() => toggleFocus(option)}
                      id={`focus-${option}`}
                    />
                    <Label htmlFor={`focus-${option}`} className="font-normal text-sm">{option}</Label>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">概略详略</Label>
              <RadioGroup value={detailLevel} onValueChange={setDetailLevel}>
                {DETAIL_OPTIONS.map((option) => (
                  <div key={option} className="flex items-center gap-2">
                    <RadioGroupItem value={option} id={`detail-${option}`} />
                    <Label htmlFor={`detail-${option}`} className="font-normal text-sm">{option}</Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
            <p className="text-xs text-muted-foreground">
              常用口味可写入「作者偏好」长期生效。
              {props.onOpenPreference && (
                <Button variant="link" size="sm" className="h-auto p-0 ml-1 text-xs" onClick={props.onOpenPreference}>
                  去设置
                </Button>
              )}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPhase("idle")}>取消</Button>
            <Button variant="outline" onClick={() => void runFill(false)}>跳过问题直接生成</Button>
            <Button onClick={() => void runFill(true)}>开始生成</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* R2 预览：逐字段勾选，默认只勾空字段 */}
      <Dialog open={phase === "preview"} onOpenChange={(open) => !open && setPhase("idle")}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>AI 填充建议 · 确认后写入</DialogTitle>
            <p className="text-xs text-muted-foreground">
              默认只勾选当前为空的字段；勾选已有字段将覆盖你手填的内容。
            </p>
          </DialogHeader>
          <div className="space-y-2 max-h-[55vh] overflow-y-auto">
            {proposal &&
              Object.entries(proposal).map(([key, value]) => {
                const label = OVERVIEW_FILL_FIELD_LABELS[key] ?? key;
                const current = (props.meta as unknown as Record<string, unknown>)[key];
                const currentText = formatValue(current);
                return (
                  <label
                    key={key}
                    className="flex items-start gap-2 rounded-md border p-2.5 hover:bg-muted/40 cursor-pointer"
                  >
                    <Checkbox
                      checked={!!selected[key]}
                      onCheckedChange={(checked) =>
                        setSelected((prev) => ({ ...prev, [key]: checked === true }))
                      }
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="font-medium">{label}</div>
                      {currentText && (
                        <div className="text-xs text-muted-foreground line-through decoration-muted-foreground/50 truncate">
                          现：{currentText}
                        </div>
                      )}
                      <div className="text-xs text-foreground break-words">建议：{formatValue(value)}</div>
                    </div>
                  </label>
                );
              })}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (!proposal) return;
                const all: Record<string, boolean> = {};
                for (const key of Object.keys(proposal)) all[key] = true;
                setSelected(all);
              }}
            >
              全部勾选
            </Button>
            <Button variant="outline" onClick={() => setPhase("idle")}>放弃</Button>
            <Button onClick={applySelected}>确认填充</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
