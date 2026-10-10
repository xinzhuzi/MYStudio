// vsc-recipes 注册表接线测试(10-10 批B)——camera-dictionary 死代码前车之鉴:
// 注册表每一条都必须有消费点,本文件守护四路接线(决策层/指南/效果注册表/渲染端)
// 与注册表自身的不变量(闭集唯一/quota/params 档案)。

import { describe, expect, it } from "vitest";
import {
  VSC_DOLLY_ZOOM_ID,
  VSC_MOTION_IDS,
  VSC_PARALLAX_GLIDE_ID,
  VSC_RECIPES,
  isVscMotionId,
  vscRecipeQuota,
} from "./vsc-recipes";
import { SHOT_FX_MOTION_PRESETS } from "./shot-fx-decisions";
import { MOTION_GUIDE } from "./shot-fx-ai";
import { getEditingEffectDefinition } from "@/lib/studio/editing/effect-registry";
import {
  VSC_CRASH_ZOOM_PUNCH_ID,
} from "@/electron/rendering/plugins/remotion/composition/recipes/crash-zoom-punch";
import {
  VSC_CAMERA_RECIPE_IDS,
} from "@/electron/rendering/plugins/remotion/composition/recipes/vsc-camera-recipes";

describe("VSC_RECIPES 注册表不变量", () => {
  it("首批 7 档闭集,id 唯一且全带 vsc: 前缀", () => {
    expect(VSC_MOTION_IDS).toHaveLength(7);
    expect(new Set(VSC_MOTION_IDS).size).toBe(7);
    for (const id of VSC_MOTION_IDS) {
      expect(id.startsWith("vsc:")).toBe(true);
      expect(VSC_RECIPES[id].id).toBe(id);
    }
  });

  it("配额真源:dolly-zoom 全章 ≤1,crash-zoom ≤2,其余不限", () => {
    expect(vscRecipeQuota(VSC_DOLLY_ZOOM_ID)).toBe(1);
    expect(vscRecipeQuota(VSC_CRASH_ZOOM_PUNCH_ID)).toBe(2);
    expect(vscRecipeQuota(VSC_PARALLAX_GLIDE_ID)).toBeUndefined();
  });

  it("camera 五卡 impl 指向 recipes/ 组件文件,depth 两卡指向层系数通道", () => {
    for (const id of VSC_MOTION_IDS) {
      const recipe = VSC_RECIPES[id];
      if (recipe.render === "component") {
        expect(recipe.impl).toMatch(/composition\/recipes\/[\w-]+\.tsx$/);
      } else {
        expect(recipe.render).toBe("layeredDepth");
        expect(recipe.impl).toContain("LayeredVisualClip");
      }
    }
  });

  it("每配方 params 闭集档案非空(D4 卡片默认值转写,即 motionParams 预留键域)", () => {
    for (const id of VSC_MOTION_IDS) {
      expect(Object.keys(VSC_RECIPES[id].params).length).toBeGreaterThan(0);
    }
    // 卡片默认值抽查(ATTRIBUTION-vsc.md 改造 4 的烧死值)
    expect(VSC_RECIPES[VSC_CRASH_ZOOM_PUNCH_ID].params.toScale).toBe(2.6);
    expect(VSC_RECIPES[VSC_DOLLY_ZOOM_ID].params.driveToScale).toBe(2.25);
  });

  it("isVscMotionId 闭集判定", () => {
    expect(isVscMotionId("vsc:dolly-zoom")).toBe(true);
    expect(isVscMotionId("vsc:bogus")).toBe(false);
    expect(isVscMotionId("push-in")).toBe(false);
  });
});

describe("注册表消费点接线(防 camera-dictionary 死代码复辙)", () => {
  it("决策层:SHOT_FX_MOTION_PRESETS 含全部 7 个 vsc 条目(同 id 同域)", () => {
    for (const id of VSC_MOTION_IDS) {
      expect(SHOT_FX_MOTION_PRESETS[id]).toBeDefined();
      expect(SHOT_FX_MOTION_PRESETS[id].vsc?.render).toBe(VSC_RECIPES[id].render);
    }
  });

  it("AI 指南:MOTION_GUIDE 含全部 7 个 vsc 条目(同 id 一名)", () => {
    const guideIds = new Set(MOTION_GUIDE.map((entry) => entry.id));
    for (const id of VSC_MOTION_IDS) {
      expect(guideIds.has(id)).toBe(true);
    }
  });

  it("效果注册表:vscMotion 的 recipe 枚举=注册表闭集(单源同步)", () => {
    const definition = getEditingEffectDefinition("vscMotion");
    expect(definition).not.toBeNull();
    const recipeParam = definition?.parameters.find((parameter) => parameter.name === "recipe");
    expect(recipeParam?.kind).toBe("enum");
    expect(recipeParam && "values" in recipeParam ? recipeParam.values : []).toEqual([...VSC_MOTION_IDS]);
  });

  it("渲染端:camera 五卡闭集=注册表 render=component 的五卡(id 常量真源=组件文件)", () => {
    const componentIds = VSC_MOTION_IDS.filter((id) => VSC_RECIPES[id].render === "component");
    expect([...VSC_CAMERA_RECIPE_IDS].sort()).toEqual([...componentIds].sort());
  });
});
