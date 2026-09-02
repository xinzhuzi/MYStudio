// Copyright © 2025 hotfxlow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { useLayoutEffect, useRef } from "react";

/**
 * 画布右键菜单工艺(apple-design §7/§12):fixed 定位 + 视口实测钳制
 * (useLayoutEffect 量真实尺寸后平移回屏内——估高不可靠,右/下缘右键
 * 曾溢出 19px)+ 光标角 transform-origin 的 120ms 纯缩放到达(不伴
 * 透明度帧——文字任何时刻满对比度,同「下拉菜单去淡入」裁定)。
 */
export function useContextMenuClamp(initial: { x: number; y: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const margin = 8;
    const q = el.getBoundingClientRect();
    let dx = 0;
    let dy = 0;
    if (q.right > window.innerWidth - margin) dx = window.innerWidth - margin - q.right;
    if (q.bottom > window.innerHeight - margin) dy = window.innerHeight - margin - q.bottom;
    if (q.left + dx < margin) dx = margin - q.left;
    if (q.top + dy < margin) dy = margin - q.top;
    if (dx || dy) el.style.translate = `${Math.round(dx)}px ${Math.round(dy)}px`;
  }, [initial.x, initial.y]);
  return ref;
}

export const CONTEXT_MENU_ARRIVAL_CLASS =
  "animate-in zoom-in-95 duration-100 origin-top-left motion-reduce:animate-none";
