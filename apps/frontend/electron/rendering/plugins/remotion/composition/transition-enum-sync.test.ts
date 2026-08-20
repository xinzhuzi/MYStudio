import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { VIDEO_WORKFLOW_TRANSITION_EFFECT_IDS } from "@rendering/contracts/video-workflow";
import { COMPOSITION_TRANSITION_EFFECTS } from "./timing";

// TS↔Python 转场枚举孪生对拍（Trellis 08-18-gl-transitions R1）。
// 转场枚举镜像于三处，此前唯一「同步」是 timing.ts 的注释——本测试把三处
// 拉进同一断言：任何一侧增删 id 而其他侧未跟，这里立刻红。
//   1. composition/timing.ts   COMPOSITION_TRANSITION_EFFECTS（运行时值，直接 import）
//   2. types/editing.ts        EditingTransition.effectId 的 Extract union（类型层，读源文本）
//   3. backend/video_use/adapter.py  _TRANSITION_EFFECT_IDS（读源文本）
// 注意：renderer-router.ts 的 REMOTION_SUPPORTED_EFFECT_IDS 是逐镜 fx 枚举
// （panZoom/shake/...），与转场无关，刻意不纳入对拍（复审 M1）。

const appsDir = process.cwd(); // vitest 从 apps/ 运行
const adapterPySource = readFileSync(
  path.join(appsDir, "backend", "video_use", "adapter.py"),
  "utf8",
);
const editingTsSource = readFileSync(
  path.join(appsDir, "frontend", "types", "editing.ts"),
  "utf8",
);

function extractPythonSetIds(source: string, varName: string): Set<string> {
  const match = source.match(new RegExp(`${varName}\\s*=\\s*\\{([^}]*)\\}`));
  expect(match, `adapter.py 中未找到 ${varName} 集合定义`).toBeDefined();
  const ids = [...match![1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
  expect(ids.length, `${varName} 解析结果为空`).toBeGreaterThan(0);
  return new Set(ids);
}

function extractEditingTransitionUnionIds(source: string): Set<string> {
  const match = source.match(/effectId:\s*Extract<\s*EditingEffectId,\s*([^>]+)>/);
  expect(match, "editing.ts 中未找到 EditingTransition.effectId 的 Extract union").toBeDefined();
  const ids = [...match![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  expect(ids.length, "Extract union 解析结果为空").toBeGreaterThan(0);
  return new Set(ids);
}

describe("转场枚举三处镜像孪生对拍", () => {
  const timingIds = new Set<string>(COMPOSITION_TRANSITION_EFFECTS);
  const adapterIds = extractPythonSetIds(adapterPySource, "_TRANSITION_EFFECT_IDS");
  const editingIds = extractEditingTransitionUnionIds(editingTsSource);

  it("timing.ts ↔ adapter.py 闭集一致", () => {
    expect([...timingIds].sort()).toEqual([...adapterIds].sort());
  });

  it("timing.ts ↔ editing.ts Extract union 一致", () => {
    expect([...timingIds].sort()).toEqual([...editingIds].sort());
  });

  it("timing.ts ↔ video-workflow runtime validator 闭集一致", () => {
    expect([...timingIds].sort()).toEqual([...VIDEO_WORKFLOW_TRANSITION_EFFECT_IDS].sort());
  });

  it("基线 5 种转场在位（扩展枚举只允许增，不允许破坏旧闭集）", () => {
    for (const base of ["cut", "fade", "crossfade", "flash", "blackout"]) {
      expect(timingIds.has(base), `基线转场 ${base} 缺失`).toBe(true);
      expect(adapterIds.has(base), `adapter.py 缺基线转场 ${base}`).toBe(true);
      expect(editingIds.has(base), `editing.ts 缺基线转场 ${base}`).toBe(true);
    }
  });

  it("gl: 命名空间 id 若出现，三处必须同进同出（前缀约定守护）", () => {
    const glInTiming = [...timingIds].filter((id) => id.startsWith("gl:"));
    const glInAdapter = [...adapterIds].filter((id) => id.startsWith("gl:"));
    const glInEditing = [...editingIds].filter((id) => id.startsWith("gl:"));
    expect([...new Set(glInTiming)].sort(), "gl: 枚举三处必须同步扩展").toEqual(
      [...new Set(glInAdapter)].sort(),
    );
    expect([...new Set(glInTiming)].sort(), "gl: 枚举三处必须同步扩展").toEqual(
      [...new Set(glInEditing)].sort(),
    );
  });
});
