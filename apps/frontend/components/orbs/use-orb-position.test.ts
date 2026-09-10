// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import {
  LOCAL_MODEL_ORB_POSITION_KEY,
  ORB_MARGIN,
  ORB_SIZE,
  WORKFLOW_ORB_POSITION_KEY,
  clampOrbPosition,
  useOrbPosition,
} from "./use-orb-position";

describe("clampOrbPosition", () => {
  it("合法位置原样保留", () => {
    expect(clampOrbPosition({ x: 100, y: 200 }, 1440, 900)).toEqual({
      x: 100,
      y: 200,
    });
  });

  it("越界位置钳回视口内(含 6px 贴边距)", () => {
    expect(clampOrbPosition({ x: 5000, y: -50 }, 1440, 900)).toEqual({
      x: 1440 - ORB_SIZE - ORB_MARGIN,
      y: ORB_MARGIN,
    });
  });

  it("脏数据(NaN/null/缺字段)回默认左下", () => {
    const fallback = clampOrbPosition(null, 1440, 900);
    expect(fallback.y).toBe(900 - ORB_SIZE - 24);
    expect(clampOrbPosition({ x: Number.NaN, y: 10 }, 1440, 900)).toEqual(fallback);
    expect(clampOrbPosition("junk", 1440, 900)).toEqual(fallback);
  });

  it("超小视口仍保证正坐标", () => {
    const tiny = clampOrbPosition({ x: 0, y: 0 }, 10, 10);
    expect(tiny.x).toBeGreaterThanOrEqual(ORB_MARGIN);
    expect(tiny.y).toBeGreaterThanOrEqual(ORB_MARGIN);
  });
});

describe("useOrbPosition", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("无历史时给默认左下锚位", () => {
    const { result } = renderHook(() => useOrbPosition());
    expect(result.current.position.x).toBe(ORB_MARGIN);
  });

  it("setPosition 持久化且越界写入被钳制", () => {
    const { result } = renderHook(() => useOrbPosition());
    act(() => result.current.setPosition({ x: 300, y: 400 }));
    const stored = JSON.parse(
      window.localStorage.getItem(WORKFLOW_ORB_POSITION_KEY) ?? "{}",
    );
    expect(stored).toEqual({ x: 300, y: 400 });
    act(() => result.current.setPosition({ x: 99999, y: 400 }));
    expect(result.current.position.x).toBeLessThanOrEqual(
      window.innerWidth - ORB_SIZE - ORB_MARGIN,
    );
  });

  it("载入即校验:历史脏数据被清洗为界内位置", () => {
    window.localStorage.setItem(
      WORKFLOW_ORB_POSITION_KEY,
      JSON.stringify({ x: 8888, y: -3 }),
    );
    const { result } = renderHook(() => useOrbPosition());
    expect(result.current.position.x).toBeLessThanOrEqual(
      window.innerWidth - ORB_SIZE - ORB_MARGIN,
    );
    expect(result.current.position.y).toBeGreaterThanOrEqual(ORB_MARGIN);
  });

  it("storageKey 参数化:本地模型球读写独立键,不碰工作流球键(09-10 拆双球)", () => {
    window.localStorage.setItem(
      WORKFLOW_ORB_POSITION_KEY,
      JSON.stringify({ x: 111, y: 222 }),
    );
    const { result } = renderHook(() =>
      useOrbPosition(LOCAL_MODEL_ORB_POSITION_KEY),
    );
    // 不读工作流球历史:独立键无历史 → 默认锚位
    expect(result.current.position.x).toBe(ORB_MARGIN);
    act(() => result.current.setPosition({ x: 60, y: 80 }));
    expect(
      JSON.parse(
        window.localStorage.getItem(LOCAL_MODEL_ORB_POSITION_KEY) ?? "null",
      ),
    ).toEqual({ x: 60, y: 80 });
    // 工作流球历史原封不动
    expect(
      JSON.parse(
        window.localStorage.getItem(WORKFLOW_ORB_POSITION_KEY) ?? "null",
      ),
    ).toEqual({ x: 111, y: 222 });
  });
});
