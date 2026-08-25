"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";
import type { StudioAssetKind } from "@/types/studio-assets";
import { ImageIcon, Music2, Plus } from "lucide-react";
import { toast } from "sonner";
import { ResolutionBadge } from "@/components/ui/image-resolution-badge";

const TYPE_LABEL = {
  role: "角色",
  scene: "场景",
  tool: "道具",
  clip: "素材",
  audio: "配音",
} as const;

export function AddAssetDialog({
  type,
  open,
  onOpenChange,
}: {
  type: StudioAssetKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [sourceFilePath, setSourceFilePath] = useState("");
  const [imagePreview, setImagePreview] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const settingRef = useRef<HTMLTextAreaElement>(null);
  const [saving, setSaving] = useState(false);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSourceFilePath("");
      setImagePreview("");
    }
    onOpenChange(nextOpen);
  };

  const handleSelectImage = async () => {
    const studioAssets = getStudioAssetsBridge();
    if (!studioAssets?.selectImageFile) return;
    const filePath = await studioAssets.selectImageFile();
    if (filePath) {
      setSourceFilePath(filePath);
      setImagePreview(`file://${filePath}`);
    }
  };

  const handleSelectAudio = async () => {
    const studioAssets = getStudioAssetsBridge();
    if (!studioAssets?.selectAudioFile) return;
    const filePath = await studioAssets.selectAudioFile();
    if (filePath) setSourceFilePath(filePath);
  };

  const handleSave = async () => {
    const name = nameRef.current?.value?.trim();
    if (!name) {
      toast.error("请填写名称");
      return;
    }
    if (type === "audio" && !sourceFilePath.trim()) {
      toast.error("请选择音频文件");
      return;
    }
    const studioAssets = getStudioAssetsBridge();
    if (!studioAssets?.add) {
      toast.error("当前环境不支持添加");
      return;
    }
    setSaving(true);
    try {
      const result = await studioAssets.add({
        type,
        name,
        sourceFilePath: sourceFilePath || "",
        description: descRef.current?.value || "",
        prompt: promptRef.current?.value || "",
        setting: settingRef.current?.value || "",
      });
      if (result) {
        toast.success(`已添加「${name}」`);
        handleOpenChange(false);
      } else {
        toast.error("添加失败");
      }
    } catch {
      toast.error(type === "audio" ? "添加失败，请确认音频文件仍可读取" : "添加失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[min(600px,90vw)] max-w-none">
        <DialogHeader>
          <DialogTitle>添加{TYPE_LABEL[type]}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* 图片选择 */}
          {type !== "audio" && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">图片</div>
              <div
                className="relative flex h-40 cursor-pointer items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 hover:border-primary/50"
                onClick={handleSelectImage}
              >
                {imagePreview ? (
                  <>
                    <img src={imagePreview} alt="预览" className="h-full w-full rounded-lg object-contain" />
                    <ResolutionBadge src={imagePreview} />
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <ImageIcon className="h-8 w-8" />
                    <span className="text-xs">点击选择图片</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {type === "audio" && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">音频文件 *</div>
              <button
                type="button"
                className="flex min-h-16 w-full items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-4 text-left hover:border-primary/50"
                onClick={handleSelectAudio}
              >
                <Music2 className="h-7 w-7 shrink-0 text-primary" />
                <span className="min-w-0 truncate text-xs text-muted-foreground" title={sourceFilePath}>
                  {sourceFilePath || "点击选择音频文件（mp3、wav、m4a 等）"}
                </span>
              </button>
            </div>
          )}

          {/* 名称 */}
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">名称 *</div>
            <input
              ref={nameRef}
              className="w-full rounded-md border border-border bg-muted/20 px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              placeholder={`输入${TYPE_LABEL[type]}名称，如：主名字;副名字1;副名字2`}
            />
            <div className="text-[11px] text-muted-foreground">
              第一个名字作为主名字，后续名字作为副名字，用英文分号 ; 分开。
            </div>
          </div>

          {/* 描述 */}
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">描述</div>
            <Textarea
              ref={descRef}
              placeholder="外貌/特征描述"
              className="min-h-[60px] resize-none bg-muted/20 text-xs"
            />
          </div>

          {/* 出图提示词 */}
          {type !== "audio" && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">出图提示词</div>
              <Textarea
                ref={promptRef}
                placeholder="用于 AI 生成图片的提示词"
                className="min-h-[60px] resize-none bg-muted/20 text-xs"
              />
            </div>
          )}

          {/* 设定 */}
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">设定</div>
            <Textarea
              ref={settingRef}
              placeholder="角色/场景/道具的详细设定"
              className="min-h-[80px] resize-none bg-muted/20 text-xs"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>取消</Button>
          <Button onClick={handleSave} disabled={saving}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {saving ? "添加中..." : "添加"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
