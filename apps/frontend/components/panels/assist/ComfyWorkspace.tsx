"use client";

// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// 09-10 全屏 ComfyUI 合一(用户裁定):freedom 视图=整屏 ComfyUI 画布,
// TTS 配音室=子态。09-10 终裁(悬浮球是 1 个):球与阶段/导航接线全部上提至
// Layout 应用层的 AppOrb(components/orbs/AppOrb.tsx),本组件只剩模式路由。

import { ComfyCanvasStudio } from "./comfy-canvas/ComfyCanvasStudio";
import { TtsStudio } from "./TtsStudio";
import { LocalModelStudio } from "./local-models/LocalModelStudio";
import { useFreedomStore } from "@/stores/assist/freedom-store";

export function ComfyWorkspace() {
  const activeStudio = useFreedomStore((state) => state.activeStudio);

  return (
    <div className="relative h-full w-full min-h-0 min-w-0 bg-background" data-comfy-workspace>
      {/* 09-11 模块分野裁定:漫影侧栏所有模块都在,内容按模块分工——
          本地模型模块默认落「本地模型」页签(09-14 正名,原「工作流」);09-12 模块分离裁定:该页签
          及原生树/会话三层均不再出现分镜产线内容(工作流模块的东西) */}
      {activeStudio === "tts" ? (
        <TtsStudio />
      ) : activeStudio === "generate" ? (
        <LocalModelStudio />
      ) : (
        <ComfyCanvasStudio myScope="models" />
      )}
    </div>
  );
}
