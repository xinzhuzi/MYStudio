// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

// 「本地模型」模块图标:取自 ComfyUI 前端模型库侧栏图标 comfy--ai-model
// (Comfy-Org/ComfyUI_frontend packages/design-system/src/icons/ai-model.svg,
// GPL-3.0;依本仓 AGPL 双许可裁定 GPL 可拷)。原样保留 16 视框与 1.3 描边设计,
// 封装成 LucideIcon 形状(currentColor)以混入 lucide 导航图标体系。

import { forwardRef } from "react";
import type { LucideProps } from "lucide-react";

const AI_MODEL_PATH =
  "m4.998 13.909.557-2.225a1.112 1.112 0 0 0-1.08-1.382H2.32c-.51 0-.955.347-1.079.842L.684 13.37a1.112 1.112 0 0 0 1.079 1.382h2.156c.51 0 .956-.347 1.08-.842ZM6.11 7.234l.557-2.224a1.112 1.112 0 0 0-1.08-1.383H3.433c-.51 0-.956.348-1.08.843l-.556 2.225a1.112 1.112 0 0 0 1.08 1.382h2.156c.51 0 .955-.347 1.079-.843ZM11.673 13.909l.556-2.225a1.112 1.112 0 0 0-1.08-1.382H8.994c-.51 0-.955.347-1.079.842l-.556 2.225a1.112 1.112 0 0 0 1.08 1.382h2.156c.51 0 .955-.347 1.079-.842ZM13.141 5.816l-.784 1.83a.334.334 0 0 1-.614 0l-.785-1.83a.333.333 0 0 0-.175-.176l-1.831-.784a.334.334 0 0 1 0-.614l1.831-.785a.333.333 0 0 0 .175-.175l.785-1.831a.334.334 0 0 1 .614 0l.784 1.831a.334.334 0 0 0 .176.175l1.83.785c.27.116.27.498 0 .614l-1.83.784a.334.334 0 0 0-.176.176Z";

export const LocalModelsIcon = forwardRef<SVGSVGElement, LucideProps>(
  function LocalModelsIcon({ size = 24, ...props }, ref) {
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        width={size}
        height={size}
        aria-hidden="true"
        {...props}
      >
        <g strokeLinecap="round" strokeWidth={1.3}>
          <path d={AI_MODEL_PATH} />
        </g>
      </svg>
    );
  },
);
