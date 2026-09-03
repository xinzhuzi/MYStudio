// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { eventBus } from "@/lib/events/event-bus";
import {
  IMAGE_GENERATION_FAILED_EVENT,
  type GenerationFailedSurface,
  type ImageGenerationFailedPayload,
} from "@/lib/events/image-generation-events";

/**
 * 生图失败弹窗(09-03 用户裁定):失败提示不放在生图节点卡上——生成
 * 按钮自身已承载状态展示;失败详情由画布生成编排层经 eventBus 广播,
 * 本组件统一弹窗呈现(错误原文可选中复制)。
 * surface 区分画布:图片工作室与分镜画布视图可能同时挂载,各弹各的。
 */

export function GenerationFailedDialog({ surface }: { surface: GenerationFailedSurface }) {
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    return eventBus.on(IMAGE_GENERATION_FAILED_EVENT, (payload) => {
      const detail = payload as ImageGenerationFailedPayload | undefined;
      if (detail?.surface !== surface) return;
      setReason(detail.reason || "生成失败");
    });
  }, [surface]);

  return (
    <AlertDialog
      open={reason !== null}
      onOpenChange={(open) => {
        if (!open) setReason(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>生成失败</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <p className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap break-words text-left font-mono text-xs leading-5 select-text">
              {reason ?? ""}
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction
            onClick={() => {
              setReason(null);
            }}
          >
            知道了
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
