import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MdEditor } from "md-editor-rt";

export function ScriptEditorDialog(props: {
  open: boolean;
  title: string;
  value: string;
  onOpenChange: (open: boolean) => void;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="flex h-[88vh] max-w-[92vw] flex-col gap-3 sm:max-w-[92vw]">
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1">
          <MdEditor
            modelValue={props.value}
            onChange={props.onChange}
            theme="dark"
            language="zh-CN"
            toolbarsExclude={["github"]}
            style={{ height: "100%" }}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={props.onCancel}>
            取消
          </Button>
          <Button onClick={props.onSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
