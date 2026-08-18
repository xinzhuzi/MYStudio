# 效果 Shader 许可清单（Effect Shader Licenses）

> 收录契约：Trellis 08-18-effect-upgrade PRD D4/D5——只收「已逐条核查许可 + 已验收」条目，
> TS 权威白名单=`apps/frontend/electron/rendering/plugins/remotion/composition/gl-transition-registry.ts`，
> 本清单与其同步维护（扩条目两处必须一起改）。

## gl-transitions 收录条目

| 枚举 id | 上游名 | 许可 | 作者 | 来源 |
|---|---|---|---|---|
| `gl:Directional` | Directional | MIT | Gaëtan Renaudeau | https://github.com/gl-transitions/gl-transitions/blob/master/transitions/Directional.glsl |
| `gl:LeftRight` | LeftRight | MIT | zhmy | https://github.com/gl-transitions/gl-transitions/blob/master/transitions/LeftRight.glsl |
| `gl:CircleCrop` | CircleCrop | MIT | fkuteken（gre 移植） | https://github.com/gl-transitions/gl-transitions/blob/master/transitions/CircleCrop.glsl |

MIT 许可要求保留版权与许可声明——各 shader 源内的作者/许可头注释已在 registry 中逐字保留。

## 待收录（许可核查中，未进白名单）

- gl-transitions 仓库其余 ~87 个转场：逐条核查许可（多为 MIT，存在例外）后分批收录。
