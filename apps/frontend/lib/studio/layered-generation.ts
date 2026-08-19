/**
 * 原生分层生图(08-19 multilayer-composition Child3)。
 *
 * 方向裁定(parent D1):视差走「多层图片原生分层」而非单图深度估计——每镜
 * 产出「背景板(无人物)+人物(净底)」两张,人物抠底成 RGBA,渲染侧经
 * <projectRoot>/remotion/layers/<chapterId>/<clipId>/{background,subject}.png
 * 约定被 RemotionChapterRenderer 发现(Child1 接线,零特殊分支)。
 *
 * 提示词变体说明:变体是**结构约束**(「画面中不出现人物」「纯色底」),
 * 不是风格词汇——按 daojie-manual-code-contract-guide 的口径,风格锁走手册
 * 标记块,结构约束属于生成请求参数,落代码层(不触碰手册与 sanitize 链)。
 * 背景板走 generateSceneImage 入口、人物走 generateCharacterImage 入口
 * (image-generator.ts 分资产类型入口天然对口);角色一致性由既有资产圣经
 * 契约(image-workflow.ts buildReferenceContinuityContract)解决,调用方把
 * 同一角色资产 reference 连到人物节点即可,本模块不重复实现。
 */

/** 层产物目录约定(与 Child1 discoverChapterLayerAssets 配对)。 */
export function chapterLayerProductDir(projectRemotionRoot: string, chapterId: string, clipId: string): string {
  return `${projectRemotionRoot}/layers/${chapterId}/${clipId}`;
}

/**
 * 背景板提示词变体:保留场景/构图/风格,去掉人物主体。
 * basePrompt=该镜现成的画面提示词(手册风格词汇已在内),变体只做结构改写。
 */
export function buildBackgroundPlatePrompt(basePrompt: string): string {
  return [
    basePrompt.replace(/(人物|角色|少女|少年|女子|男子|他|她)[^,。;；]*[，,]?/g, "").trim() || basePrompt,
    "【背景板】纯场景空镜:画面中不出现任何人物、人影、人物剪影或人物遗留物",
    "保留原画面的场景构图、透视、光照方向与色调;人物原有站位区域保留为自然场景(地面/植被/水面),不得留白或畸变",
  ].join("。");
}

/** 背景板负向词锚:与 mergeReferenceNegativePrompt 合并使用。 */
export const BACKGROUND_PLATE_NEGATIVE_ANCHORS = ["人物", "人影", "人物剪影", "人形轮廓", "肖像"];

/**
 * 人物净底提示词变体:同角色姿态表情,纯色底便于色键抠底。
 * characterPrompt=角色资产描述(资产圣经锚点由 reference 契约注入,此处只写姿态与底)。
 */
export function buildSubjectCutoutPrompt(
  basePrompt: string,
  characterPrompt: string,
): string {
  return [
    characterPrompt,
    "【人物净底图】单一角色全身像,姿态/表情/服装与下述剧情一致,构图完整不裁四肢",
    "背景为纯净均匀的纯绿色幕(#00b140),无阴影投射到幕上,无场景元素,无道具背景",
    `剧情参照:${basePrompt}`,
  ].join("。");
}

/** 人物净底负向词锚。 */
export const SUBJECT_CUTOUT_NEGATIVE_ANCHORS = ["复杂背景", "场景", "环境", "投影", "渐变背景", "多人"];

/** 色键抠底的绿幕键色(#00b140)。 */
export const MATTE_KEY_COLOR: readonly [number, number, number] = [0x00, 0xb1, 0x40];

/**
 * 纯色底色键抠底(零新依赖,Child3 R2-a 路线):对净底人物图逐像素判键,
 * 键色邻域→透明,并做 1px 边缘半透过渡抑制锯齿。头发边缘质量依赖底色
 * 与容差;rembg 模型路线(设置页显式下载)留作后续增强,不进本期。
 *
 * 纯函数:输入输出均为 RGBA 像素数组(ImageData.data 同构),可单测。
 */
export function matteSolidBackground(
  pixels: Uint8ClampedArray,
  key: readonly [number, number, number] = MATTE_KEY_COLOR,
  tolerance = 96,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels.length);
  const toleranceSq = tolerance * tolerance;
  const edgeBand = toleranceSq * 2.2; // 键色邻域→半透过渡带
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]!;
    const g = pixels[i + 1]!;
    const b = pixels[i + 2]!;
    const a = pixels[i + 3]!;
    const dr = r - key[0];
    const dg = g - key[1];
    const db = b - key[2];
    const distSq = dr * dr + dg * dg + db * db;
    if (a === 0) {
      out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = 0;
      continue;
    }
    if (distSq <= toleranceSq) {
      // 键色:完全透明(保留原 RGB 供边缘插值,由消费端合成时按 alpha 取)
      out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = 0;
    } else if (distSq <= edgeBand) {
      // 过渡带:线性半透,抑制发丝边缘锯齿
      const t = (distSq - toleranceSq) / (edgeBand - toleranceSq);
      out[i] = r; out[i + 1] = g; out[i + 2] = b;
      out[i + 3] = Math.round(a * Math.min(1, t));
    } else {
      out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = a;
    }
  }
  return out;
}

/** 抠底结果粗评:不透明像素占比(净底人物图应在 0.05..0.7 健康带)。 */
export function opaqueRatio(pixels: Uint8ClampedArray): number {
  let opaque = 0;
  let total = 0;
  for (let i = 3; i < pixels.length; i += 4) {
    total += 1;
    if (pixels[i]! >= 128) opaque += 1;
  }
  return total === 0 ? 0 : opaque / total;
}
