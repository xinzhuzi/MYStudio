// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { useCallback, useEffect, useRef, useState } from "react";

/** 悬浮球默认锚位:左下 bottom-6 left-6(避 ComfyUI webview 右下控件与 sonner toast)。 */
export const ORB_SIZE = 48;
export const ORB_MARGIN = 6;
/** 工作流球位置键(历史单键,保持字面量=存量用户零迁移)。 */
export const WORKFLOW_ORB_POSITION_KEY = "mystudio.workflow-orb.position";
/** 本地模型球位置键(09-10 拆双球:各记各的贴边位,互不顶替)。 */
export const LOCAL_MODEL_ORB_POSITION_KEY = "mystudio.local-model-orb.position";

export interface OrbPosition {
  x: number;
  y: number;
}

function defaultPosition(): OrbPosition {
  if (typeof window === "undefined") return { x: ORB_MARGIN, y: ORB_MARGIN };
  return {
    x: ORB_MARGIN,
    y: window.innerHeight - ORB_SIZE - 24,
  };
}

/** 把位置钳制进当前视口(含 6px 贴边距);NaN/负值等脏数据回默认。 */
export function clampOrbPosition(
  raw: unknown,
  viewportWidth: number,
  viewportHeight: number,
): OrbPosition {
  const fallback = { x: ORB_MARGIN, y: Math.max(ORB_MARGIN, viewportHeight - ORB_SIZE - 24) };
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

function loadPosition(storageKey: string): OrbPosition {
  if (typeof window === "undefined") return defaultPosition();
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return defaultPosition();
    return clampOrbPosition(JSON.parse(raw), window.innerWidth, window.innerHeight);
  } catch {
    return defaultPosition();
  }
}

/** 悬浮球位置:localStorage 按键持久化,载入即校验,窗口 resize 重钳。
 * storageKey 由业务球指定(工作流球=旧键零迁移;本地模型球=独立键)。 */
export function useOrbPosition(storageKey: string = WORKFLOW_ORB_POSITION_KEY) {
  const [position, setPositionState] = useState<OrbPosition>(() =>
    loadPosition(storageKey),
  );
  const latestRef = useRef(position);

  const clampToViewport = useCallback(() => {
    if (typeof window === "undefined") return;
    const clamped = clampOrbPosition(
      latestRef.current,
      window.innerWidth,
      window.innerHeight,
    );
    if (clamped.x !== latestRef.current.x || clamped.y !== latestRef.current.y) {
      latestRef.current = clamped;
      setPositionState(clamped);
    }
  }, []);

  useEffect(() => {
    window.addEventListener("resize", clampToViewport);
    return () => window.removeEventListener("resize", clampToViewport);
  }, [clampToViewport]);

  const setPosition = useCallback(
    (next: OrbPosition) => {
      const clamped =
        typeof window === "undefined"
          ? next
          : clampOrbPosition(next, window.innerWidth, window.innerHeight);
      latestRef.current = clamped;
      setPositionState(clamped);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(clamped));
      } catch {
        // 存储不可用(隐私模式等)时仅内存保持,不影响交互
      }
    },
    [storageKey],
  );

  return { position, setPosition };
}
