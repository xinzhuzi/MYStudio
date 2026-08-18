// gl-transitions 收录白名单——TS 权威单一事实源（Trellis 08-18-gl-transitions B3）。
//
// 收录契约（PRD D4/D5）：
// - 只收录「已逐条核查许可 + 已验收」的条目；未知 gl: id 一律 fail-closed 拒渲染。
// - id 形如 `gl:<Name>`（Name 保持上游 PascalCase，便于与 gl-transitions.com 预览对照）。
// - 三处枚举镜像（timing.ts 派生自本表 / editing.ts / adapter.py）由
//   transition-enum-sync.test.ts 孪生对拍守护——扩条目必须三处同步。
// - shader 源逐字保留上游作者/许可头注释；许可记录汇总于
//   apps/frontend/assets/effects-shaders/LICENSES.md（随包入库）。
//
// shader 运行约定（gl-transitions 社区契约）：每个条目提供 `vec4 transition(vec2 uv)`，
// 宿主注入 uniform float progress / uniform float ratio 与 getFromColor/getToColor。

export interface GlTransitionDefn {
  /** 枚举短名（不含 gl: 前缀），保持上游文件名 */
  readonly name: string;
  readonly author: string;
  readonly license: "MIT";
  readonly sourceUrl: string;
  /** shader 私有 uniform 默认值（progress/ratio/fromTex/toTex 由宿主注入，不在此列） */
  readonly defaultUniforms: Readonly<Record<string, readonly number[]>>;
  /** transition 函数 GLSL 源（含上游许可头注释，逐字保留） */
  readonly glsl: string;
}

export const GL_TRANSITIONS = [
  {
    name: "Directional",
    author: "Gaëtan Renaudeau",
    license: "MIT",
    sourceUrl: "https://github.com/gl-transitions/gl-transitions/blob/master/transitions/Directional.glsl",
    defaultUniforms: { direction: [0.0, 1.0] },
    glsl: `// Author: Gaëtan Renaudeau
// License: MIT

uniform vec2 direction; // = vec2(0.0, 1.0)

vec4 transition (vec2 uv) {
  vec2 p = uv + progress * sign(direction);
  vec2 f = fract(p);
  return mix(
    getToColor(f),
    getFromColor(f),
    step(0.0, p.y) * step(p.y, 1.0) * step(0.0, p.x) * step(p.x, 1.0)
  );
}`,
  },
  {
    name: "LeftRight",
    author: "zhmy",
    license: "MIT",
    sourceUrl: "https://github.com/gl-transitions/gl-transitions/blob/master/transitions/LeftRight.glsl",
    defaultUniforms: {},
    glsl: `// Author: zhmy
// License: MIT

const vec4 black = vec4(0.0, 0.0, 0.0, 1.0);
const vec2 boundMin = vec2(0.0, 0.0);
const vec2 boundMax = vec2(1.0, 1.0);

bool inBounds (vec2 p) {
    return all(lessThan(boundMin, p)) && all(lessThan(p, boundMax));
}

vec4 transition (vec2 uv) {
    vec2 spfr,spto = vec2(-1.);

    float size = mix(1.0, 3.0, progress*0.2);
    spto = (uv + vec2(-0.5,-0.5))*vec2(size,size)+vec2(0.5,0.5);
    spfr = (uv - vec2(1.-progress, 0.0));
    if(inBounds(spfr)){
        return getToColor(spfr);
    }else if(inBounds(spto)){
        return getFromColor(spto) * (1.0 - progress);
    } else{
        return black;
    }
}`,
  },
  {
    name: "CircleCrop",
    author: "fkuteken",
    license: "MIT",
    sourceUrl: "https://github.com/gl-transitions/gl-transitions/blob/master/transitions/CircleCrop.glsl",
    defaultUniforms: { bgcolor: [0.0, 0.0, 0.0, 1.0] },
    glsl: `// License: MIT
// Author: fkuteken
// ported by gre from https://gist.github.com/fkuteken/f63e3009c1143950dee9063c3b83fb88

uniform vec4 bgcolor; // = vec4(0.0, 0.0, 0.0, 1.0)

vec2 ratio2 = vec2(1.0, 1.0 / ratio);
float s = pow(2.0 * abs(progress - 0.5), 3.0);

vec4 transition(vec2 p) {
  float dist = length((vec2(p) - 0.5) * ratio2);
  return mix(
    progress < 0.5 ? getFromColor(p) : getToColor(p),
    bgcolor,
    step(s, dist)
  );
}`,
  },
] as const satisfies readonly GlTransitionDefn[];

export const GL_TRANSITION_IDS: readonly string[] = GL_TRANSITIONS.map(
  (defn) => `gl:${defn.name}`,
);

export type GlTransitionEffectId = (typeof GL_TRANSITIONS)[number]["name"] extends infer N
  ? `gl:${N & string}`
  : never;

export function glTransitionEffectId(defn: GlTransitionDefn): string {
  return `gl:${defn.name}`;
}

export function isGlTransitionEffect(effectId: string): boolean {
  return GL_TRANSITION_IDS.includes(effectId);
}

export function getGlTransition(effectId: string): GlTransitionDefn | undefined {
  if (!effectId.startsWith("gl:")) return undefined;
  return GL_TRANSITIONS.find((defn) => `gl:${defn.name}` === effectId);
}
