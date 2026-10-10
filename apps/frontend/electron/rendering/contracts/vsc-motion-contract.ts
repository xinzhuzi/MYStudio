// vscMotion 效果契约校验器(10-10 批B,video-shotcraft 嫁接)。
//
// fail-closed 三闸(editing.effect.* 错误码风格,spec §3「Unknown or
// unsupported effects fail closed before Studio, Player session, or
// renderMedia starts」):
//   1. recipe id ∈ vsc-recipes 闭集(未知 id 拒渲染,不静默丢);
//   2. params 键域 ⊆ {recipe}(D4:首批配方参数烧死卡片默认值,效果通道
//      不携带任何可调参数,白名单外键=param_unknown);
//   3. 章级配额(dolly-zoom ≤1、crash-zoom ≤2,quota 真源 vsc-recipes)。
//
// 消费点:validateTimelineRenderPlan(渲染计划正门——render worker/preview/
// compile 链在此拒);决策侧 shot-fx-decisions 的配额守卫是第一闸(超配额
// 回落轮换而非报错),本校验器是防直写/手改数据的第二闸(报错拒渲染)。

import { isVscMotionId, vscRecipeQuota, type VscMotionId } from "@/lib/studio/remotion/vsc-recipes";

export interface VscMotionContractIssue {
  path: string;
  message: string;
  code:
    | "vsc.effect.recipe_unknown"
    | "vsc.effect.param_unknown"
    | "vsc.effect.recipe_missing"
    | "vsc.effect.quota_exceeded";
}

export type VscMotionContractResult =
  | { success: true }
  | { success: false; issues: VscMotionContractIssue[] };

interface VscEffectLike {
  effectId?: unknown;
  enabled?: unknown;
  params?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 校验计划里全部启用的 vscMotion 效果(id/params 闭集+章级配额)。
 * 输入只读 effects 数组(EditingEffect 形状的宽松子集),非 vscMotion 条目跳过。
 */
export function validateVscMotionEffects(
  effects: readonly VscEffectLike[] | undefined,
): VscMotionContractResult {
  const issues: VscMotionContractIssue[] = [];
  if (!Array.isArray(effects)) return { success: true };
  const usage = new Map<VscMotionId, number>();
  effects.forEach((effect, index) => {
    if (!isRecord(effect) || effect.effectId !== "vscMotion" || effect.enabled === false) return;
    const path = `$.effects[${index}]`;
    const params = isRecord(effect.params) ? effect.params : {};
    for (const key of Object.keys(params)) {
      if (key !== "recipe") {
        issues.push({
          path: `${path}.params.${key}`,
          message: `vscMotion 参数不在白名单(首批参数烧死卡片默认值,仅允许 recipe): ${key}`,
          code: "vsc.effect.param_unknown",
        });
      }
    }
    const recipe = params.recipe;
    if (typeof recipe !== "string" || recipe.length === 0) {
      issues.push({
        path: `${path}.params.recipe`,
        message: "vscMotion 缺少 recipe id",
        code: "vsc.effect.recipe_missing",
      });
      return;
    }
    if (!isVscMotionId(recipe)) {
      issues.push({
        path: `${path}.params.recipe`,
        message: `vscMotion recipe 不在 vsc:* 闭集: ${recipe}`,
        code: "vsc.effect.recipe_unknown",
      });
      return;
    }
    const quota = vscRecipeQuota(recipe);
    const used = (usage.get(recipe) ?? 0) + 1;
    usage.set(recipe, used);
    if (quota !== undefined && used > quota) {
      issues.push({
        path: `${path}.params.recipe`,
        message: `vscMotion recipe 超章级配额: ${recipe} 全章至多 ${quota} 次(实为第 ${used} 次)`,
        code: "vsc.effect.quota_exceeded",
      });
    }
  });
  return issues.length > 0 ? { success: false, issues } : { success: true };
}
