import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useThemeStore } from "@/stores/app/theme-store";
import { SOURCE_BIBLE_MAX_CHARS } from "@/lib/studio/source-bible";
import { FileText } from "lucide-react";
import { MdEditor } from "md-editor-rt";
import "md-editor-rt/lib/style.css";

/** 原著圣经编辑器：全书设定卡，注入所有 AI 文本阶段；超上限禁保存（不静默截断）。 */
export function NovelBibleEditorDialog(props: {
  open: boolean;
  value: string;
  onOpenChange: (open: boolean) => void;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
  generating?: boolean;
  onGenerate?: () => void;
}) {
  const theme = useThemeStore((state) => state.theme);
  const charCount = props.value.length;
  const isOverLimit = charCount > SOURCE_BIBLE_MAX_CHARS;
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="flex h-[88vh] max-w-[92vw] flex-col gap-3 sm:max-w-[92vw]">
        <DialogHeader>
          <DialogTitle>原著圣经</DialogTitle>
          <p className="text-xs text-muted-foreground">
            全书设定卡，注入所有 AI 文本阶段（事件分析/剧本/资产提取/导演计划/分镜表）。
          </p>
        </DialogHeader>
        <div className="min-h-0 flex-1">
          <MdEditor
            modelValue={props.value}
            onChange={props.onChange}
            theme={theme}
            language="zh-CN"
            toolbarsExclude={["github"]}
            style={{ height: "100%" }}
          />
        </div>
        <DialogFooter className="items-center gap-2">
          <span
            className={`mr-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${
              isOverLimit
                ? "bg-red-500/10 text-red-500"
                : "bg-muted text-muted-foreground"
            }`}
            title={`上限 ${SOURCE_BIBLE_MAX_CHARS} 字符，超限无法保存`}
          >
            <FileText className="h-3.5 w-3.5" />
            {charCount}/{SOURCE_BIBLE_MAX_CHARS}
          </span>
          {props.onGenerate ? (
            <Button
              variant="outline"
              disabled={props.generating}
              onClick={props.onGenerate}
            >
              {props.generating ? "生成中…" : "AI 生成"}
            </Button>
          ) : null}
          <Button variant="outline" onClick={props.onCancel}>
            取消
          </Button>
          <Button disabled={isOverLimit} onClick={props.onSave}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 导入后的生成引导：仅当圣经为空时由 NovelTab 触发；确认后打开编辑器并自动生成草稿。 */
export function NovelBibleGuideDialog(props: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>创建原著圣经？</DialogTitle>
          <p className="text-sm text-muted-foreground">
            检测到本书还没有「原著圣经」（全书主线/人物/世界观设定卡）。
            AI 将按固定格式从章节采样生成草稿，你过目后手动保存；它会让后续事件分析与剧本改编带着全书视角。
          </p>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={props.onCancel}>
            暂不
          </Button>
          <Button onClick={props.onConfirm}>AI 生成草稿</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
