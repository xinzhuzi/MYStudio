import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useThemeStore } from "@/stores/app/theme-store";
import { formatJsonDocument } from "@/lib/studio/storyboard-json";
import { MdEditor } from "md-editor-rt";
import "md-editor-rt/lib/style.css";
import { EditorView } from "@codemirror/view";
import { json } from "@codemirror/lang-json";
import CodeMirror from "@uiw/react-codemirror";
import { toast } from "sonner";

const jsonEditorScrollTheme = EditorView.theme({
  ".cm-scroller": {
    overflowY: "auto",
  },
});

export function WorkflowNodeEditDialog({
  open,
  title,
  value,
  writable,
  onValueChange,
  onClose,
  onSave,
  onEnterStage,
  jsonMode = false,
  readOnlyJson = false,
}: {
  open: boolean;
  title: string;
  value: string;
  writable: boolean;
  onValueChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
  onEnterStage: () => void;
  jsonMode?: boolean;
  readOnlyJson?: boolean;
}) {
  const theme = useThemeStore((state) => state.theme);
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent className="flex h-[88vh] max-w-[92vw] flex-col gap-3 border-border bg-card text-card-foreground sm:max-w-[92vw]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {readOnlyJson
              ? "只读查看当前章节 Remotion 分镜清单；它由 canonical 分镜 JSON 派生，不会独立写回。"
              : writable && jsonMode
                ? "编辑当前章节供 Remotion 视频生产使用的 canonical 分镜源数据。保存前会校验章节、镜头序号、素材引用和渲染状态；生成图片等 mediaRef 会保留。"
                : writable
              ? "编辑当前节点 FlowData Markdown，保存后会回写工作流数据。"
              : "该节点由结构化数据生成，可查看 Markdown 摘要；请进入对应阶段编辑明细。"}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
          {jsonMode ? <CodeMirror
            className="h-full"
            value={value}
            height="100%"
            theme={theme === "dark" ? "dark" : "light"}
            extensions={[json(), EditorView.lineWrapping, jsonEditorScrollTheme]}
            onChange={onValueChange}
            readOnly={!writable}
          /> : <MdEditor
            modelValue={value}
            onChange={onValueChange}
            theme={theme}
            language="zh-CN"
            toolbarsExclude={["github"]}
            readOnly={!writable}
            style={{ height: "100%" }}
          />}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          {jsonMode && writable ? (
            <Button
              variant="outline"
              onClick={() => {
                const formatted = formatJsonDocument(value);
                if (formatted.value) onValueChange(formatted.value);
                else toast.error(formatted.error ?? "JSON 格式化失败");
              }}
            >
              格式化
            </Button>
          ) : null}
          {readOnlyJson ? null : writable ? (
            <Button onClick={onSave}>保存</Button>
          ) : (
            <Button type="button" onClick={onEnterStage}>
              进入阶段
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
