import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useThemeStore } from "@/stores/app/theme-store";
import { getFileStorageBridge } from "@/lib/bridge/file-storage";
import {
  AUTHOR_PREFERENCE_MAX_CHARS,
  AUTHOR_PREFERENCE_STORAGE_KEY,
  AUTHOR_PREFERENCE_TEMPLATE,
  readAuthorPreference,
} from "@/lib/studio/author-preference";
import { runAuthorPreferenceFill } from "@/lib/studio/author-preference-fill";
import { SlidersHorizontal, Wand2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { MdEditor } from "md-editor-rt";
import "md-editor-rt/lib/style.css";

/** 作者偏好编辑器：应用级改编口味卡，注入全部文本管线；超上限禁保存（不静默截断）。
 *  与原著圣经成对：偏好管「我怎么改编」（跨项目），圣经管「这本书的事实」（项目级）。
 *  AI 起草同概览填充纪律：问答收意图（可跳过）→ 草稿进编辑器 → 人工审改后手动保存，AI 不直接落盘。 */

const GENRE_OPTIONS = ["仙侠", "都市", "悬疑", "科幻", "历史", "言情"] as const;
const ADAPT_OPTIONS = ["忠实原著", "适度改编", "大胆改编"] as const;
const PACING_OPTIONS = ["快节奏强钩子", "张弛交替", "沉稳铺垫"] as const;

export function AuthorPreferenceDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const theme = useThemeStore((state) => state.theme);
  const bridge = getFileStorageBridge();
  const [value, setValue] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genres, setGenres] = useState<string[]>([]);
  const [adaptDegree, setAdaptDegree] = useState("");
  const [pacing, setPacing] = useState("");
  const [dealbreakers, setDealbreakers] = useState("");

  useEffect(() => {
    if (!props.open) return;
    setLoaded(false);
    setAiOpen(false);
    void readAuthorPreference().then((text) => {
      setValue(text.trim() ? text : AUTHOR_PREFERENCE_TEMPLATE);
      setLoaded(true);
    });
  }, [props.open]);

  const handleSave = useCallback(async () => {
    if (!bridge?.setItem) {
      toast.error("当前环境不支持保存作者偏好（需要桌面端文件存储）");
      return;
    }
    if (value.length > AUTHOR_PREFERENCE_MAX_CHARS) return;
    const ok = await bridge.setItem(AUTHOR_PREFERENCE_STORAGE_KEY, value);
    if (!ok) {
      toast.error("作者偏好保存失败");
      return;
    }
    props.onOpenChange(false);
    toast.success("作者偏好已保存，下次 AI 文本阶段生效");
  }, [bridge, props, value]);

  const runFill = useCallback(
    async (withQuestions: boolean) => {
      setGenerating(true);
      try {
        const { aiManager } = await import("@/lib/ai/ai-manager");
        const result = await runAuthorPreferenceFill({
          currentText: value,
          questions: withQuestions
            ? {
                genres: genres.length ? genres : undefined,
                adaptDegree: adaptDegree || undefined,
                pacing: pacing || undefined,
                dealbreakers: dealbreakers.trim() || undefined,
              }
            : undefined,
          callText: async (messages): Promise<string> => {
            const reply = await aiManager.text({
              binding: { agent: "universalAi" },
              messages: [
                { role: "system", content: messages.system },
                { role: "user", content: messages.user },
              ],
              temperature: 0.6,
              maxTokens: 1200,
              fallbackToUniversal: false,
            });
            if (!reply.success || !reply.text) throw new Error(reply.error || "AI 返回失败");
            return reply.text;
          },
        });
        if (!result.ok) {
          toast.error(`AI 起草失败：${result.error}`);
          return;
        }
        setValue(result.markdown);
        setAiOpen(false);
        toast.success("AI 草稿已生成，请检查修改后点「保存」生效");
      } catch (error) {
        toast.error(`AI 起草失败：${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setGenerating(false);
      }
    },
    [value, genres, adaptDegree, pacing, dealbreakers],
  );

  const isOverLimit = value.length > AUTHOR_PREFERENCE_MAX_CHARS;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="flex h-[80vh] max-w-[88vw] flex-col gap-3 sm:max-w-[88vw]">
        <DialogHeader>
          <DialogTitle>作者偏好</DialogTitle>
          <p className="text-xs text-muted-foreground">
            你的改编口味卡，全应用生效（所有项目共用，非某本书的设定）。注入事件分析、剧本链、
            导演计划、分镜表；生图/TTS 不注入。与正文事实冲突时以正文为准。
          </p>
        </DialogHeader>
        <div className="min-h-0 flex-1">
          {aiOpen ? (
            <div className="h-full space-y-4 overflow-y-auto p-1">
              <p className="text-xs text-muted-foreground">
                回答会影响草稿侧重；全部跳过=通用改编口味推断。答案只用于本次生成，不保存。
              </p>
              <div className="space-y-2">
                <Label className="text-sm">题材偏好（多选）</Label>
                <div className="flex flex-wrap gap-3">
                  {GENRE_OPTIONS.map((option) => (
                    <div key={option} className="flex items-center gap-1.5">
                      <Checkbox
                        id={`pref-genre-${option}`}
                        checked={genres.includes(option)}
                        onCheckedChange={() =>
                          setGenres((prev) =>
                            prev.includes(option) ? prev.filter((x) => x !== option) : [...prev, option],
                          )
                        }
                      />
                      <Label htmlFor={`pref-genre-${option}`} className="font-normal text-sm">{option}</Label>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-sm">改编幅度</Label>
                <RadioGroup value={adaptDegree} onValueChange={setAdaptDegree}>
                  {ADAPT_OPTIONS.map((option) => (
                    <div key={option} className="flex items-center gap-2">
                      <RadioGroupItem value={option} id={`pref-adapt-${option}`} />
                      <Label htmlFor={`pref-adapt-${option}`} className="font-normal text-sm">{option}</Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>
              <div className="space-y-2">
                <Label className="text-sm">节奏口味</Label>
                <RadioGroup value={pacing} onValueChange={setPacing}>
                  {PACING_OPTIONS.map((option) => (
                    <div key={option} className="flex items-center gap-2">
                      <RadioGroupItem value={option} id={`pref-pacing-${option}`} />
                      <Label htmlFor={`pref-pacing-${option}`} className="font-normal text-sm">{option}</Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>
              <div className="space-y-2">
                <Label className="text-sm">明确雷点（可选，自由填写）</Label>
                <Input
                  value={dealbreakers}
                  onChange={(e) => setDealbreakers(e.target.value)}
                  placeholder="如：不要回忆杀开场、不要卖惨…"
                />
              </div>
            </div>
          ) : loaded ? (
            <MdEditor
              modelValue={value}
              onChange={setValue}
              theme={theme}
              language="zh-CN"
              toolbarsExclude={["github"]}
              style={{ height: "100%" }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              读取中…
            </div>
          )}
        </div>
        <DialogFooter className="items-center gap-2">
          <span
            className={`mr-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${
              isOverLimit ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"
            }`}
            title={`上限 ${AUTHOR_PREFERENCE_MAX_CHARS} 字符，超限无法保存`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {value.length}/{AUTHOR_PREFERENCE_MAX_CHARS}
          </span>
          {!aiOpen ? (
            <>
              <Button
                variant="outline"
                disabled={generating || !loaded}
                onClick={() => {
                  setGenres([]);
                  setAdaptDegree("");
                  setPacing("");
                  setDealbreakers("");
                  setAiOpen(true);
                }}
              >
                {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                AI 生成
              </Button>
              <Button variant="outline" onClick={() => props.onOpenChange(false)}>
                取消
              </Button>
              <Button disabled={!loaded || isOverLimit} onClick={() => void handleSave()}>
                保存
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setAiOpen(false)}>返回编辑器</Button>
              <Button variant="outline" disabled={generating} onClick={() => void runFill(false)}>
                跳过问题直接生成
              </Button>
              <Button disabled={generating} onClick={() => void runFill(true)}>
                {generating ? "生成中…" : "生成草稿"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
