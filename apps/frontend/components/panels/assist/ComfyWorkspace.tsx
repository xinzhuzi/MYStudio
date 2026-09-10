"use client";

// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// 09-10 全屏 ComfyUI 合一(用户裁定):freedom 视图=整屏 ComfyUI 画布,
// TTS 配音室=本地模型球可达子态;沉浸视图无应用 chrome,本地模型球=唯一出入。
// 09-10 拆双球裁定:工作流球/阶段内容撤出本视图(去工作流=「前往→工作流」两步,
// 直达阶段跳转随拆分退役);导航归 LocalModelOrb,本组件只管模式路由。

import { ComfyCanvasStudio } from "./comfy-canvas/ComfyCanvasStudio";
import { TtsStudio } from "./TtsStudio";
import { LocalModelOrb } from "./LocalModelOrb";
import { useFreedomStore } from "@/stores/assist/freedom-store";

export function ComfyWorkspace() {
  const activeStudio = useFreedomStore((state) => state.activeStudio);
  const setActiveStudio = useFreedomStore((state) => state.setActiveStudio);

  return (
    <div className="relative h-full w-full min-h-0 min-w-0 bg-background" data-comfy-workspace>
      {activeStudio === "tts" ? <TtsStudio /> : <ComfyCanvasStudio />}
      <LocalModelOrb mode={activeStudio} onModeChange={setActiveStudio} />
    </div>
  );
}
