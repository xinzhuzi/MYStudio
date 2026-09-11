// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { useCallback, useEffect, useRef, useState } from "react";

/** 悬浮球几何常量:48px 球+6px 贴边距。 */
export const ORB_SIZE = 48;
export const ORB_MARGIN = 6;
/** 工作流球位置键(历史单键,保持字面量=存量用户零迁移)。 */
export const WORKFLOW_ORB_POSITION_KEY = "mystudio.workflow-orb.position";
/** 旧双球时代键(09-11 归一单球后已无消费方;保留字面量=记录存量 localStorage 键名便于考古)。 */
export const LOCAL_MODEL_ORB_POSITION_KEY = "mystudio.local-model-orb.position";

export interface OrbPosition {
  x: number;
  y: number;
}

/** 默认锚位角:左下(沉浸视图,无侧栏)或右下(工作流视图,左下会被侧栏轨道
 * 盖住帮助/设置按钮——09-10 实弹修复:球默认压在导航上=「切不了模块」)。 */
export type OrbAnchor = "bottom-left" | "bottom-right";

function defaultPosition(anchor: OrbAnchor): OrbPosition {
  if (typeof window === "undefined") return { x: ORB_MARGIN, y: ORB_MARGIN };
  const y = window.innerHeight - ORB_SIZE - 24;
  if (anchor === "bottom-right") {
    return { x: window.innerWidth - ORB_SIZE - 24, y };
  }
  return { x: ORB_MARGIN, y };
}

/** 把位置钳制进当前视口(含 6px 贴边距);NaN/负值等脏数据回默认锚位。 */
export function clampOrbPosition(
  raw: unknown,
  viewportWidth: number,
  viewportHeight: number,
  anchor: OrbAnchor = "bottom-left",
): OrbPosition {
  const fallback = defaultPositionFor(anchor, viewportWidth, viewportHeight);
  if (
    typeof raw !== "object" ||
    raw === null ||
    !Number.isFinite((raw as OrbPosition).x) ||
    !Number.isFinite((raw as OrbPosition).y)
  ) {
    return fallback;
  }
  const maxX = Math.max(ORB_MARGIN, viewportWidth - ORB_SIZE - ORB_MARGIN);
  const maxY = Math.max(ORB_MARGIN, viewportHeight - ORB_SIZE - ORB_MARGIN);
  return {
    x: Math.min(Math.max((raw as OrbPosition).x, ORB_MARGIN), maxX),
    y: Math.min(Math.max((raw as OrbPosition).y, ORB_MARGIN), maxY),
  };
}

function defaultPositionFor(
  anchor: OrbAnchor,
  viewportWidth: number,
  viewportHeight: number,
): OrbPosition {
  const y = Math.max(ORB_MARGIN, viewportHeight - ORB_SIZE - 24);
  if (anchor === "bottom-right") {
    return { x: Math.max(ORB_MARGIN, viewportWidth - ORB_SIZE - 24), y };
  }
  return { x: ORB_MARGIN, y };
}

/** 松手吸附:到最近边(留 6px 边距,整球完整可见)。 */
export function snapToNearestEdge(
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
) {
  const clampY = (value: number) =>
    Math.min(
      Math.max(value, ORB_MARGIN),
      Math.max(ORB_MARGIN, viewportHeight - ORB_SIZE - ORB_MARGIN),
    );
  const clampX = (value: number) =>
    Math.min(
      Math.max(value, ORB_MARGIN),
      Math.max(ORB_MARGIN, viewportWidth - ORB_SIZE - ORB_MARGIN),
    );
  const candidates = [
    { x: ORB_MARGIN, y: clampY(y) },
    { x: viewportWidth - ORB_SIZE - ORB_MARGIN, y: clampY(y) },
    { x: clampX(x), y: ORB_MARGIN },
    { x: clampX(x), y: viewportHeight - ORB_SIZE - ORB_MARGIN },
  ];
  let best = candidates[0]!;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const dist = (candidate.x - x) ** 2 + (candidate.y - y) ** 2;
    if (dist < bestDist) {
      best = candidate;
      bestDist = dist;
    }
  }
  return best;
}

function loadPosition(storageKey: string, anchor: OrbAnchor): OrbPosition {
  if (typeof window === "undefined") return defaultPosition(anchor);
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return defaultPosition(anchor);
    return clampOrbPosition(
      JSON.parse(raw),
      window.innerWidth,
      window.innerHeight,
      anchor,
    );
  } catch {
    return defaultPosition(anchor);
  }
}

/** 悬浮球位置:localStorage 按键持久化,载入即校验,窗口 resize 重钳。
 * storageKey 由业务球指定(现役唯一球=WORKFLOW_ORB_POSITION_KEY);
 * anchor=无存档时的默认锚位角(现役=右下,避左侧栏轨道盖住帮助/设置——09-10 实弹修复)。 */
export function useOrbPosition(
  storageKey: string = WORKFLOW_ORB_POSITION_KEY,
  anchor: OrbAnchor = "bottom-left",
) {
  const [position, setPositionState] = useState<OrbPosition>(() =>
    loadPosition(storageKey, anchor),
  );
  const latestRef = useRef(position);

  const clampToViewport = useCallback(() => {
    if (typeof window === "undefined") return;
    const clamped = clampOrbPosition(
      latestRef.current,
      window.innerWidth,
      window.innerHeight,
      anchor,
    );
    if (clamped.x !== latestRef.current.x || clamped.y !== latestRef.current.y) {
      latestRef.current = clamped;
      setPositionState(clamped);
    }
  }, [anchor]);

  useEffect(() => {
    window.addEventListener("resize", clampToViewport);
    return () => window.removeEventListener("resize", clampToViewport);
  }, [clampToViewport]);

  const setPosition = useCallback(
    (next: OrbPosition) => {
      const clamped =
        typeof window === "undefined"
          ? next
          : clampOrbPosition(next, window.innerWidth, window.innerHeight, anchor);
      latestRef.current = clamped;
      setPositionState(clamped);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(clamped));
      } catch {
        // 存储不可用(隐私模式等)时仅内存保持,不影响交互
      }
    },
    [storageKey, anchor],
  );

  return { position, setPosition };
}
