import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MdEditor } from "md-editor-rt";
import "md-editor-rt/lib/style.css";

export function WorkflowNodeEditDialog({
  open,
  title,
  value,
  writable,
  onValueChange,
  onClose,
  onSave,
  onEnterStage,
}: {
  open: boolean;
  title: string;
  value: string;
  writable: boolean;
  onValueChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
  onEnterStage: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent className="flex h-[88vh] max-w-[92vw] flex-col gap-3 border-white/10 bg-[#171817] text-zinc-100 sm:max-w-[92vw]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-zinc-500">
            {writable
              ? "编辑当前节点 FlowData Markdown，保存后会回写工作流数据。"
              : "该节点由结构化数据生成，可查看 Markdown 摘要；请进入对应阶段编辑明细。"}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-white/10">
          <MdEditor
            modelValue={value}
            onChange={onValueChange}
            theme="dark"
            language="zh-CN"
            toolbarsExclude={["github"]}
            readOnly={!writable}
            style={{ height: "100%" }}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          {writable ? (
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
