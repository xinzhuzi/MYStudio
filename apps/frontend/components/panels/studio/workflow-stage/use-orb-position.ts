import { useCallback, useEffect, useRef, useState } from "react";

/** 悬浮球默认锚位:左下 bottom-6 left-6(避 ComfyUI webview 右下控件与 sonner toast)。 */
export const ORB_SIZE = 48;
export const ORB_MARGIN = 6;
const STORAGE_KEY = "mystudio.workflow-orb.position";

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

function loadPosition(): OrbPosition {
  if (typeof window === "undefined") return defaultPosition();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPosition();
    return clampOrbPosition(JSON.parse(raw), window.innerWidth, window.innerHeight);
  } catch {
    return defaultPosition();
  }
}

/** 悬浮球位置:localStorage 单键持久化,载入即校验,窗口 resize 重钳。 */
export function useOrbPosition() {
  const [position, setPositionState] = useState<OrbPosition>(loadPosition);
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

  const setPosition = useCallback((next: OrbPosition) => {
    const clamped =
      typeof window === "undefined"
        ? next
        : clampOrbPosition(next, window.innerWidth, window.innerHeight);
    latestRef.current = clamped;
    setPositionState(clamped);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(clamped));
    } catch {
      // 存储不可用(隐私模式等)时仅内存保持,不影响交互
    }
  }, []);

  return { position, setPosition };
}
