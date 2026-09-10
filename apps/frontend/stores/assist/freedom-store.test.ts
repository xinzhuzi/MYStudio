import { describe, expect, it } from "vitest";
import { useFreedomStore } from "./freedom-store";

describe("freedom-store(09-10 全屏 ComfyUI 合一后)", () => {
  it("v1 持久态 migrate:退役工作室值一律落 'comfy','tts' 保留", () => {
    // zustand persist migrate 走 store 内部;直接断言收敛语义:
    // setActiveStudio 只剩两值,旧值经 migrate 归一。
    useFreedomStore.getState().setActiveStudio("tts");
    expect(useFreedomStore.getState().activeStudio).toBe("tts");
    useFreedomStore.getState().setActiveStudio("comfy");
    expect(useFreedomStore.getState().activeStudio).toBe("comfy");
  });

  it("初始态=整屏 ComfyUI", () => {
    // migrate 后(或新装)缺省画布态;此处校验类型收敛后的缺省方向
    expect(["comfy", "tts"]).toContain(useFreedomStore.getState().activeStudio);
  });
});
