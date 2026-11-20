import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useThemeStore } from "@/stores/app/theme-store";
import { MdEditor } from "md-editor-rt";
import "md-editor-rt/lib/style.css";

/** 设定 MD 编辑弹窗(1120 用户令:设定入口收成按钮,设定内容与 Markdown 渲染
 * 同框呈现;描述随前令并入设定域,一并在此编辑)。取消不回写,「应用」才落
 * 资产弹窗的 draft,随主弹窗「保存」生效——与主弹窗草稿语义一致,不直写 DB。 */
export function StudioAssetSettingDialog(props: {
  open: boolean;
  name: string;
  description: string;
  setting: string;
  onOpenChange: (open: boolean) => void;
  onApply: (next: { description: string; setting: string }) => void;
}) {
  const theme = useThemeStore((state) => state.theme);
  const [description, setDescription] = useState(props.description);
  const [setting, setSetting] = useState(props.setting);

  // 打开时以父级 draft 为初值(关闭期间外部变化的同步收口)
  useEffect(() => {
    if (props.open) {
      setDescription(props.description);
      setSetting(props.setting);
    }
  }, [props.open, props.description, props.setting]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="flex h-[88vh] max-w-[92vw] flex-col gap-3 sm:max-w-[92vw]">
        <DialogHeader>
          <DialogTitle className="truncate">设定 · {props.name}</DialogTitle>
        </DialogHeader>
        <section className="flex shrink-0 flex-col gap-1.5">
          <div className="shrink-0 text-xs font-medium text-muted-foreground">描述</div>
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="暂无描述"
            className="h-24 resize-none bg-muted/90 text-xs leading-5"
          />
        </section>
        <div className="flex min-h-0 flex-1 flex-col gap-1.5">
          <div className="shrink-0 text-xs font-medium text-muted-foreground">设定(Markdown)</div>
          <div className="min-h-0 flex-1">
            <MdEditor
              modelValue={setting}
              onChange={(value) => setSetting(value ?? "")}
              theme={theme}
              language="zh-CN"
              toolbarsExclude={["github"]}
              style={{ height: "100%" }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>取消</Button>
          <Button
            onClick={() => {
              props.onApply({ description, setting });
              props.onOpenChange(false);
            }}
          >
            应用
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
