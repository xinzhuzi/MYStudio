// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

"use client";

import { useEffect, useState } from "react";
import { ImageStudioCanvas } from "./image-studio/ImageStudioCanvas";

/**
 * 图片工作室(辅助面板·第一 Tab)。
 *
 * 08-31 重做:三栏表单 → React Flow 无限画布工作流(文生图/图生图/成图链
 * 式精修)。多画布管理、节点生图编排全部在 ImageStudioCanvas;本文件只做
 * 壳,保持 FreedomView 的既有导入路径不变。表单时代的字段契约(imagePrompt
 * 种子、历史、eventBus image:generated)由画布侧保持。
 */
export function ImageStudio() {
  // 延迟一帧渲染画布重活(Tab 切换首帧减负);窗口被遮挡时 macOS 会把 rAF
  // 降频到零(装机 CDP 实证:后台窗口永远停在装载文案),1.5s 定时器兜底放行
  const [chromeReady, setChromeReady] = useState(false);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setChromeReady(true));
    const fallback = window.setTimeout(() => setChromeReady(true), 1500);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(fallback);
    };
  }, []);
  if (!chromeReady) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        正在打开图片工作室…
      </div>
    );
  }
  return <ImageStudioCanvas />;
}
