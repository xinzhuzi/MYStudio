// workflowConfig → plan.renderSettings 注水（单一事实源）。
// main.ts 章节投影与 apps/build/scripts/render-chapter-standalone.ts 的
// store 重放共用本函数——两条渲染链对同一组「导演定调」字段必须同源生效。
//
// 08-20 修复背景：subtitleFont 曾只有注释承诺（「创建时注入
// renderSettings.subtitleFont」）而无实现代码，设置页写进的
// workflowConfig.subtitleFont 从不进 plan，渲染恒用 editing 工程创建期
// 冻结的旧值（道劫实发：工程冻结 ma-shan-zheng，设置页选什么都渲毛笔楷书）。
// 抽公共函数 + 回归测试（workflow-config-projection.test.ts）锁死。
//
// 语义：非法/缺失字段一律跳过（fail-open 到 plan 原值），与
// remotion-contract-field-validation.ts 的白名单校验同判定。

import { isKnownSubtitleFontId } from "./subtitle-fonts";
import type { EditingRenderSettings } from "@/types/editing";

/** workflowConfig 的宽松读取形状（store 盘上无 schema 保证）。 */
export interface WorkflowConfigProjectionInput {
  chapterGrade?: { lutId?: unknown; blend?: unknown };
  subtitleSfxEnabled?: unknown;
  atmosphereMode?: unknown;
  subtitleFont?: unknown;
}

/** 把 workflowConfig 的渲染定调字段注水进 renderSettings，返回新对象。
 * config 缺省/全非法时原样返回（引用不变，便于幂等判断）。 */
export function applyWorkflowConfigToRenderSettings<T extends EditingRenderSettings>(
  renderSettings: T,
  workflowConfig: WorkflowConfigProjectionInput | undefined,
): T {
  if (!workflowConfig) return renderSettings;
  let next = renderSettings;
  if (workflowConfig.chapterGrade && typeof workflowConfig.chapterGrade.lutId === "string") {
    const blendRaw = Number(workflowConfig.chapterGrade.blend ?? 0.5);
    next = {
      ...next,
      chapterGrade: {
        lutId: workflowConfig.chapterGrade.lutId,
        blend: Number.isFinite(blendRaw) ? Math.min(1, Math.max(0, blendRaw)) : 0.5,
      },
    };
  }
  if (typeof workflowConfig.subtitleSfxEnabled === "boolean") {
    next = { ...next, subtitleSfxEnabled: workflowConfig.subtitleSfxEnabled };
  }
  if (workflowConfig.atmosphereMode === "off" || workflowConfig.atmosphereMode === "ai") {
    next = { ...next, atmosphereMode: workflowConfig.atmosphereMode };
  }
  if (typeof workflowConfig.subtitleFont === "string" && isKnownSubtitleFontId(workflowConfig.subtitleFont)) {
    next = { ...next, subtitleFont: workflowConfig.subtitleFont };
  }
  return next;
}
