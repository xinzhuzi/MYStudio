"use client";

import { useEffect, useState } from "react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { json as jsonLang } from "@codemirror/lang-json";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getStudioSkillsBridge,
} from "@/lib/bridge/studio-skills";
import {
  loadCharacterJsonText,
  restoreCharacterJsonText,
  saveCharacterJsonText,
  type CharacterJsonLoad,
} from "@/lib/studio/asset-character-json";
import { useThemeStore } from "@/stores/app/theme-store";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";

// 与 artifact-detail/json-viewer.tsx 共用同一套 CodeMirror 滚动/等宽字型主题
const editorScrollTheme = EditorView.theme({
  ".cm-scroller": { overflowY: "auto" },
  ".cm-content": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
});

/**
 * 角色真源 JSON 弹窗(10-26 用户令):角色弹窗内完整展示 + 可编辑该角色的真源
 * JSON(art_skills/<包>/json/<角色名>.json,如 晏燎.json)。CodeMirror JSON 高亮可
 * 编辑;保存前 JSON.parse 校验;写桌面技能存储(用户编辑保护/种子更新传播同手册
 * 编辑体系)。无桥环境(测试/网页)回内置种子只读展示。
 */
export function StudioAssetCharacterJsonDialog({
  open,
  characterName,
  onOpenChange,
}: {
  open: boolean;
  characterName: string;
  onOpenChange: (open: boolean) => void;
}) {
  const theme = useThemeStore((state) => state.theme);
  const [load, setLoad] = useState<CharacterJsonLoad | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"save" | "restore" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editable, setEditable] = useState(true);

  useEffect(() => {
    if (!open || !characterName) return;
    let cancelled = false;
    setLoad(null);
    setText("");
    setError(null);
    setEditable(Boolean(getStudioSkillsBridge()?.writeText));
    loadCharacterJsonText(characterName).then((result) => {
      if (cancelled) return;
      setLoad(result);
      if (result.status === "ready") setText(result.text);
    });
    return () => {
      cancelled = true;
    };
  }, [open, characterName]);

  const reload = () => {
    loadCharacterJsonText(characterName).then((result) => {
      setLoad(result);
      if (result.status === "ready") setText(result.text);
      setError(null);
    });
  };

  const handleSave = async () => {
    if (!characterName) return;
    setBusy("save");
    setError(null);
    const result = await saveCharacterJsonText(characterName, text);
    setBusy(null);
    if (result.ok) {
      toast.success("角色真源 JSON 已保存");
      reload();
      return;
    }
    setError(result.error);
    toast.error(result.error);
  };

  const handleRestore = async () => {
    if (!characterName) return;
    setBusy("restore");
    setError(null);
    const result = await restoreCharacterJsonText(characterName);
    setBusy(null);
    if (result.ok) {
      toast.success("已恢复内置种子版本");
      reload();
      return;
    }
    setError(result.error);
    toast.error(result.error);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[860px]! max-w-[860px]! flex-col overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="text-base">角色真源 JSON:{characterName}</DialogTitle>
          <DialogDescription className="sr-only">
            查看并编辑该角色的真源 JSON(主体词、每境指令等),保存到桌面端技能存储。
          </DialogDescription>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
            <span className="truncate" title={load?.status === "ready" ? load.relativePath : ""}>
              {load?.status === "ready" ? load.relativePath : "…"}
            </span>
            {load?.status === "ready" ? (
              <span className="shrink-0 rounded border border-border px-1.5 py-0.5">
                {load.source === "storage" ? "存储副本" : "内置种子"}
              </span>
            ) : null}
            {!editable ? <span className="shrink-0">当前环境只读,请在桌面版中编辑</span> : null}
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden px-5 py-3">
          {load === null ? (
            <div className="flex h-64 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 载入中…
            </div>
          ) : load.status === "missing" ? (
            <div className="flex h-64 items-center justify-center text-muted-foreground">
              该角色没有真源 JSON
            </div>
          ) : (
            <div className="h-[55vh] overflow-hidden rounded-md border border-border bg-muted/40">
              <CodeMirror
                className="h-full w-full"
                value={text}
                onChange={setText}
                height="55vh"
                theme={theme === "dark" ? "dark" : "light"}
                extensions={[jsonLang(), EditorView.lineWrapping, editorScrollTheme]}
                editable={editable}
                readOnly={!editable}
                basicSetup={{ lineNumbers: true, foldGutter: true }}
              />
            </div>
          )}
        </div>
        {error ? (
          <div className="border-t border-destructive/30 bg-destructive/5 px-5 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}
        <DialogFooter className="border-t border-border px-5 py-3">
          <Button
            variant="outline"
            onClick={handleRestore}
            disabled={!editable || busy !== null || load?.status !== "ready"}
            title="丢弃对该 JSON 的所有修改,恢复为应用内置版本"
          >
            {busy === "restore" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
            恢复内置版本
          </Button>
          <div className="flex-1" />
          <Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
          <Button onClick={handleSave} disabled={!editable || busy !== null || load?.status !== "ready"}>
            {busy === "save" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
