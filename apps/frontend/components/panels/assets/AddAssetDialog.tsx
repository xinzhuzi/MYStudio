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
import type { StudioAssetKind } from "@/types/studio-assets";
import { ImageIcon, Plus } from "lucide-react";
import { toast } from "sonner";

const TYPE_LABEL = {
  role: "角色",
  scene: "场景",
  tool: "道具",
  clip: "素材",
  audio: "音频",
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
  const [imagePath, setImagePath] = useState("");
  const [imagePreview, setImagePreview] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const settingRef = useRef<HTMLTextAreaElement>(null);
  const [saving, setSaving] = useState(false);

  const handleSelectImage = async () => {
    if (!window.studioAssets?.selectImageFile) return;
    const filePath = await window.studioAssets.selectImageFile();
    if (filePath) {
      setImagePath(filePath);
      setImagePreview(`file://${filePath}`);
    }
  };

  const handleSave = async () => {
    const name = nameRef.current?.value?.trim();
    if (!name) {
      toast.error("请填写名称");
      return;
    }
    if (!window.studioAssets?.add) {
      toast.error("当前环境不支持添加");
      return;
    }
    setSaving(true);
    try {
      const result = await window.studioAssets.add({
        type,
        name,
        sourceFilePath: imagePath || "",
        description: descRef.current?.value || "",
        prompt: promptRef.current?.value || "",
        setting: settingRef.current?.value || "",
      });
      if (result) {
        toast.success(`已添加「${name}」`);
        // 重置表单
        setImagePath("");
        setImagePreview("");
        onOpenChange(false);
      } else {
        toast.error("添加失败");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
                className="flex h-40 cursor-pointer items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 hover:border-primary/50"
                onClick={handleSelectImage}
              >
                {imagePreview ? (
                  <img src={imagePreview} alt="预览" className="h-full w-full rounded-lg object-contain" />
                ) : (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <ImageIcon className="h-8 w-8" />
                    <span className="text-xs">点击选择图片</span>
                  </div>
                )}
              </div>
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSave} disabled={saving}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {saving ? "添加中..." : "添加"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
