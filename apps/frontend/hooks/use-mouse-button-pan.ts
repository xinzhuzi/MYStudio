// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

import { useRef } from "react";

/**
 * 鼠标右键/中键拖拽平移(09-03 用户裁定:所有画布左键不得拖拽画布)。
 *
 * 背景:React Flow 上游 d3 过滤器 `!event.button || button <= 1` 令左键永远
 * 放行——`panOnDrag={[2]}` 挡不住左键平移(实测视口随左键拖拽移动)。props
 * 无法表达「仅右键平移」,故应用层自建:画布 ReactFlow 设 panOnDrag={false}
 * (d3 全禁拖拽平移,左键交还框选),本钩子接管右键/中键拖拽 → onPanDelta。
 *
 * 语义:
 * - 左键:不处理(框选/节点交互)
 * - 右键/中键按住拖动:每次 pointermove 派发屏幕像素增量
 * - 移动超过 3px 判定为「拖拽」:紧随其后的 contextmenu 被吞(右键点=菜单,
 *   右键拖=平移,二者互斥);未移动的右键点击不受影响
 */

export interface MouseButtonPanHandlers {
  onPointerDown: React.PointerEventHandler<HTMLElement>;
  onPointerMove: React.PointerEventHandler<HTMLElement>;
  onPointerUp: React.PointerEventHandler<HTMLElement>;
  onPointerCancel: React.PointerEventHandler<HTMLElement>;
  /** 在 contextmenu 处理器首行调用:返回 true = 刚发生拖拽,应吞掉本次菜单 */
  consumeContextMenu: () => boolean;
}

const INTERACTIVE_SELECTOR =
  'button,input,textarea,select,a,[role="menu"],[role="menuitem"],[contenteditable="true"]';

export function useMouseButtonPan(onPanDelta: (dxScreen: number, dyScreen: number) => void): MouseButtonPanHandlers {
  const drag = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(null);
  const suppressContextMenu = useRef(false);

  const endDrag = () => {
    drag.current = null;
  };

  return {
    onPointerDown: (event) => {
      if (event.button !== 1 && event.button !== 2) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest(INTERACTIVE_SELECTOR)) return;
      // 中键 preventDefault 防浏览器滚动穿透;右键绝不拦截——setPointerCapture
      // 会把后续 contextmenu 重定向到捕获元素(实测吞掉画布右键菜单),
      // preventDefault 也可能扰动菜单链。右键平移只按 pointerId 跟踪。
      if (event.button === 1) event.preventDefault();
      drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    },
    onPointerMove: (event) => {
      const state = drag.current;
      if (!state || event.pointerId !== state.pointerId) return;
      const dx = event.clientX - state.x;
      const dy = event.clientY - state.y;
      if (!state.moved && Math.hypot(dx, dy) > 3) {
        state.moved = true;
        suppressContextMenu.current = true;
        // 兜底自清:contextmenu 在 pointerup 之后同步到达,正常会被消费;
        // 极端序列(系统吞事件)下 250ms 后自动恢复右键菜单
        window.setTimeout(() => { suppressContextMenu.current = false; }, 250);
      }
      if (!state.moved) return;
      state.x = event.clientX;
      state.y = event.clientY;
      onPanDelta(dx, dy);
    },
    onPointerUp: (event) => {
      if (drag.current?.pointerId !== event.pointerId) return;
      endDrag();
    },
    onPointerCancel: (event) => {
      if (drag.current?.pointerId !== event.pointerId) return;
      endDrag();
    },
    consumeContextMenu: () => {
      if (suppressContextMenu.current) {
        suppressContextMenu.current = false;
        return true;
      }
      return false;
    },
  };
}
