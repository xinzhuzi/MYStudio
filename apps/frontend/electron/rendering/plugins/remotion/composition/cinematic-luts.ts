// 成片调色 LUT 闭集——TS 权威单一事实源（Trellis 08-18-haldclut-grade）。
//
// 背景与许可（2026-08-18 核查）：交接文档建议源 cedeber/hald-clut 为 GPL-3.0 且
// 内含 Apple/Pixelmator 专有条款、G'MIC 系为 CECILL——均不过 D4 门槛。本集改为
// 程序化烘焙（apps/build/scripts/generate-luts.py，仓库自有代码），零许可风险；
// 命名 film-* 为胶片风灵感（非型号仿真）。许可清单：frontend/assets/luts/LICENSES.md。
//
// 架构口径：grade 为 chapter 合成层效果（plan.effects effectId="grade"，经
// renderer-router → build-composition-props 投影 → clip.grade → GLGradeMedia）。
// Python 侧不建镜像（grade 不经 EDL/video-use，建镜像=孤儿死代码——cinematic_grades.py
// 前车之鉴）；闭集由 composition-props-validation fail-closed 守护。
// LUT 文件经 media bridge 以 URL 进 props（lutSrc），打包走 extraResources。

export interface CinematicLutDefn {
  readonly lutId: string;
  readonly file: string;
  readonly description: string;
}

export const CINEMATIC_LUTS: readonly CinematicLutDefn[] = [
  { lutId: "film-teal-orange", file: "film-teal-orange.png", description: "经典电影橙青对比（暗部青、亮部暖橙）" },
  { lutId: "film-fuji-cool", file: "film-fuji-cool.png", description: "富士冷调（青蓝阴影、柔和高光）" },
  { lutId: "film-kodak-warm", file: "film-kodak-warm.png", description: "柯达暖调（琥珀高光、暖褐阴影）" },
  { lutId: "film-bleach-bypass", file: "film-bleach-bypass.png", description: "漂白旁路（低饱和高对比）" },
  { lutId: "film-sepia-ink", file: "film-sepia-ink.png", description: "旧纸墨棕（宣纸陈色，道劫向）" },
  { lutId: "film-cyan-mist", file: "film-cyan-mist.png", description: "青雾（低对比冷雾感）" },
  { lutId: "film-mute-sage", file: "film-mute-sage.png", description: "灰绿低饱和（水墨淡彩向）" },
  { lutId: "film-noir-contrast", file: "film-noir-contrast.png", description: "黑白高对比" },
];

export const CINEMATIC_LUT_IDS: readonly string[] = CINEMATIC_LUTS.map((l) => l.lutId);

export function isCinematicLutId(lutId: string): boolean {
  return CINEMATIC_LUT_IDS.includes(lutId);
}

export function getCinematicLut(lutId: string): CinematicLutDefn | undefined {
  return CINEMATIC_LUTS.find((l) => l.lutId === lutId);
}
