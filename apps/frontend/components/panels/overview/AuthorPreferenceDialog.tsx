import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useThemeStore } from "@/stores/app/theme-store";
import { getFileStorageBridge } from "@/lib/bridge/file-storage";
import {
  AUTHOR_PREFERENCE_MAX_CHARS,
  AUTHOR_PREFERENCE_STORAGE_KEY,
  AUTHOR_PREFERENCE_TEMPLATE,
  readAuthorPreference,
} from "@/lib/studio/author-preference";
import { SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { MdEditor } from "md-editor-rt";
import "md-editor-rt/lib/style.css";

/** 作者偏好编辑器：应用级改编口味卡，注入全部文本管线；超上限禁保存（不静默截断）。
 *  与原著圣经成对：偏好管「我怎么改编」（跨项目），圣经管「这本书的事实」（项目级）。 */
export function AuthorPreferenceDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const theme = useThemeStore((state) => state.theme);
  const bridge = getFileStorageBridge();
  const [value, setValue] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!props.open) return;
    setLoaded(false);
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
          {loaded ? (
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
              isOverLimit ? "bg-red-500/10 text-red-500" : "bg-muted text-muted-foreground"
            }`}
            title={`上限 ${AUTHOR_PREFERENCE_MAX_CHARS} 字符，超限无法保存`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {value.length}/{AUTHOR_PREFERENCE_MAX_CHARS}
          </span>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={!loaded || isOverLimit} onClick={() => void handleSave()}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
