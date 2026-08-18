// gl-transitions 收录白名单——TS 权威单一事实源（Trellis 08-18-gl-transitions B3/Step C）。
//
// 收录契约（PRD D4/D5）：
// - 只收录「已逐条核查许可 + 已验收」的条目；未知 gl: id 一律 fail-closed 拒渲染。
// - id 形如 `gl:<Name>`（Name 保持上游 PascalCase，便于与 gl-transitions.com 预览对照）。
// - 条目数据在 `gl-transition-shaders.generated.ts`（上游许可审计自动生成，123/125——
//   MIT 121 + BSD-2/3-Clause 各 1；排除 displacement/luma：sampler2D 外部纹理输入宿主不支持）。
// - 三处枚举镜像（timing.ts 派生自本表 / editing.ts / adapter.py）由
//   transition-enum-sync.test.ts 孪生对拍守护——扩条目必须三处同步。
// - 许可记录汇总：apps/frontend/assets/effects-shaders/LICENSES.md（随包入库）。
//
// shader 运行约定（gl-transitions 社区契约）：每个条目提供 `vec4 transition(vec2 uv)`，
// 宿主注入 uniform float progress / uniform float ratio 与 getFromColor/getToColor。
// shader 编译失败时 GLTransitionLayer 输出透明、DOM crossfade 兜底（里程碑出片实战验证）。

import { GL_TRANSITION_SHADERS } from "./gl-transition-shaders.generated";

export interface GlTransitionDefn {
  /** 枚举短名（不含 gl: 前缀），保持上游文件名 */
  readonly name: string;
  readonly author: string;
  readonly license: "MIT" | "BSD-2-Clause" | "BSD-3-Clause";
  readonly sourceUrl: string;
  /** shader 私有 uniform 默认值（progress/ratio/fromTex/toTex 由宿主注入，不在此列） */
  readonly defaultUniforms: Readonly<Record<string, readonly number[]>>;
  /** transition 函数 GLSL 源（含上游许可头注释，逐字保留） */
  readonly glsl: string;
}

export const GL_TRANSITIONS: readonly GlTransitionDefn[] = GL_TRANSITION_SHADERS;

export const GL_TRANSITION_IDS: readonly string[] = GL_TRANSITIONS.map(
  (defn) => `gl:${defn.name}`,
);

export function isGlTransitionEffect(effectId: string): boolean {
  return GL_TRANSITION_IDS.includes(effectId);
}

export function getGlTransition(effectId: string): GlTransitionDefn | undefined {
  if (!effectId.startsWith("gl:")) return undefined;
  return GL_TRANSITIONS.find((defn) => `gl:${defn.name}` === effectId);
}
