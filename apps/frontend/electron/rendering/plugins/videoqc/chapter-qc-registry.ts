/**
 * 维度注册表(1102 骨干①/④)——三态验收板的唯一真源。
 *
 * 对标上游 `Vchitect/VBench`: `vbench/VBench_full_info.json`(946 条)与
 * `VBench-2.0/vbench2/VBench2_full_info.json`(1230 条)先用 `{prompt, dimension[]}`
 * 把「要回答什么问题」钉死,`vbench/<dim>.py` 才去配评价器。我们此前是反过来的——
 * 一行存在是因为恰好造出了那个检测器,所以 15 行里 10 行恒 unverified。
 *
 * 本表把行的**声明数据**(类别/依赖层/证据由谁产/是否需标定/权重)集中一处,
 * 判定逻辑住在 `chapter-qc-verdicts.ts` 的 assessor 里,按 requirementId 挂接:
 * 加一行=加一条注册项(+ 只在需要新证据时加一个 assessor),不再改判定顺序。
 *
 * `evaluator` 是**委托边界**(骨干④):`upstream-vbench*` 只是声明的委托位。
 * 上游栈只能住隔离 venv(`vbench` 要 numpy<2.0 + opencv-python,与托管 Python 的
 * opencv-contrib-python-headless 抢同一个 `cv2`,再加 decord/clip/pyiqa/timm),
 * 未获供应批准不得安装;缺位时对应行落 unverified 并指名委托对象,
 * 不许拿近似自研信号冒充它。
 *
 * 权重(合计恰 100)是**本仓自定初值**,不是上游 `scripts/constant.py` 的人类偏好拟合值——
 * 那套权重是在 VBench 自己的 prompt suite 与几十万人类投票上拟合的,口径不同不可继承。
 * 等 `qc/calibration/` 的打标集与人工放行记录攒够,再按本产线的偏好重新拟合替换本表初值。
 */

import type {
  ChapterQcDimensionCategory,
  ChapterQcDimensionSpecV1,
  ChapterQcEvaluatorKind,
} from "./chapter-qc-types";

export const CHAPTER_QC_DIMENSIONS: readonly ChapterQcDimensionSpecV1[] = [
  {
    requirementId: "supply-integrity",
    label: "供给完整性(先证物料与口径,再谈结论)",
    category: "supply",
    layer: "structural",
    evaluator: "deterministic-signal",
    requiresCalibration: false,
    weight: 5,
  },
  {
    requirementId: "duration-in-plan",
    label: "成片时长与计划对齐",
    category: "timeline",
    layer: "structural",
    evaluator: "deterministic-signal",
    requiresCalibration: false,
    weight: 5,
  },
  {
    requirementId: "subtitle-text-consistent",
    label: "字幕文本与台词稿一致且覆盖到位",
    category: "text",
    layer: "structural",
    evaluator: "deterministic-signal",
    requiresCalibration: false,
    weight: 5,
  },
  {
    requirementId: "no-blackout",
    label: "无异常黑场",
    category: "visual-quality",
    layer: "ffmpegScan",
    evaluator: "deterministic-signal",
    upstreamDimension: "temporal_flickering",
    requiresCalibration: false,
    weight: 5,
  },
  {
    requirementId: "no-freeze",
    label: "无画面冻结",
    category: "motion",
    layer: "ffmpegScan",
    evaluator: "deterministic-signal",
    upstreamDimension: "motion_smoothness",
    requiresCalibration: false,
    weight: 5,
  },
  {
    requirementId: "audio-loudness",
    label: "整体响度在 sanity 窗内",
    category: "audio",
    layer: "ffmpegScan",
    evaluator: "deterministic-signal",
    requiresCalibration: false,
    weight: 5,
  },
  {
    requirementId: "speech-integrity",
    label: "台词未被挤压/音画同步",
    category: "audio",
    layer: "ffmpegScan",
    evaluator: "managed-python-sidecar",
    requiresCalibration: true,
    calibrationSignals: ["speech.coverageRatio"],
    weight: 8,
  },
  {
    requirementId: "real-motion",
    label: "画面有真动态(全片伪动态门)",
    category: "motion",
    layer: "ffmpegScan",
    // 证据由自研 TI 信号产(siti/blurdetect 逐帧统计),所以 evaluator 记 deterministic-signal;
    // 上游 dynamic_degree 只是**未供的委托位**,写在判定件的 missing 文案里,不占 evaluator——
    // 这一栏回答「谁产的证」,答成 upstream-vbench 等于把自研数字挂到别人名下。
    evaluator: "deterministic-signal",
    upstreamDimension: "dynamic_degree",
    requiresCalibration: true,
    calibrationSignals: ["motion.tiMean", "motion.staticFrameRatio"],
    weight: 5,
  },
  {
    requirementId: "motion-plan-consistent",
    label: "该动的镜真动了(逐镜期望对照)",
    category: "motion",
    layer: "ffmpegScan",
    evaluator: "deterministic-signal",
    upstreamDimension: "dynamic_degree",
    requiresCalibration: true,
    // 逐镜判定必须吃逐镜口径的样本(本章最差镜);拿全片均值画出来的带去判单镜,
    // 单位不对——全片静止占比天然远低于离群镜,带一攒够就成片误判。
    calibrationSignals: ["shot.motion.staticFrameRatio"],
    weight: 8,
  },
  {
    requirementId: "aesthetic-in-baseline",
    label: "观感分在系列基线内",
    category: "visual-quality",
    layer: "aesthetic",
    evaluator: "managed-python-sidecar",
    upstreamDimension: "aesthetic_quality / imaging_quality",
    requiresCalibration: true,
    calibrationSignals: ["aesthetic.fused"],
    minCalibrationSamples: 2,
    weight: 8,
  },
  {
    requirementId: "semantic-reviewed",
    label: "逐镜语义与画面一致",
    category: "coherence",
    layer: "semantic",
    evaluator: "multimodal-model",
    requiresCalibration: false,
    weight: 5,
  },
  {
    requirementId: "vision-reviewed",
    label: "转场密度与画面装配预审",
    category: "visual-quality",
    layer: "vision",
    evaluator: "multimodal-model",
    requiresCalibration: false,
    weight: 5,
  },
  {
    requirementId: "character-integrity",
    label: "角色形体成立(五官/手/姿势/口型无崩坏)",
    category: "character",
    layer: "vision",
    evaluator: "multimodal-model",
    upstreamDimension: "human_anatomy / human_identity",
    requiresCalibration: false,
    weight: 8,
  },
  {
    requirementId: "text-integrity",
    label: "画面内文字成立(无伪字/乱码)",
    category: "text",
    layer: "vision",
    evaluator: "multimodal-model",
    requiresCalibration: false,
    weight: 3,
  },
  {
    requirementId: "cross-shot-coherence",
    label: "跨镜一致(同角色不漂移、画风同属一片)",
    category: "coherence",
    layer: "vision",
    evaluator: "multimodal-model",
    upstreamDimension: "multi_view_consistency / instance_preservation",
    requiresCalibration: false,
    weight: 6,
  },
  {
    requirementId: "face-readability",
    label: "人脸可自动判读(五官/手指维的证据前提)",
    category: "character",
    layer: "vision",
    evaluator: "managed-python-sidecar",
    upstreamDimension: "human_anatomy",
    requiresCalibration: false,
    weight: 4,
  },
  {
    requirementId: "human-full-watch",
    label: "人眼全速看全片 + 人耳听全轨",
    category: "human",
    evaluator: "human-review",
    requiresCalibration: false,
    weight: 10,
  },
] as const;

export const CHAPTER_QC_WEIGHT_TOTAL = CHAPTER_QC_DIMENSIONS.reduce(
  (sum, spec) => sum + spec.weight,
  0,
);

const SPEC_BY_ID = new Map(CHAPTER_QC_DIMENSIONS.map((spec) => [spec.requirementId, spec]));

export function dimensionSpec(requirementId: string): ChapterQcDimensionSpecV1 | undefined {
  return SPEC_BY_ID.get(requirementId);
}

/** 类别显示名(UI 分组标题用;顺序即注册表里首次出现的顺序)。 */
export const CHAPTER_QC_CATEGORY_LABELS: Record<ChapterQcDimensionCategory, string> = {
  supply: "供给",
  timeline: "时间轴",
  audio: "音频",
  motion: "动态",
  "visual-quality": "画面质量",
  character: "角色",
  text: "文字",
  coherence: "一致性",
  human: "人证",
};

export const CHAPTER_QC_EVALUATOR_LABELS: Record<ChapterQcEvaluatorKind, string> = {
  "deterministic-signal": "自研确定性信号",
  "managed-python-sidecar": "托管 Python 侧车",
  "multimodal-model": "多模态模型判读",
  "upstream-vbench": "上游 VBench(待供)",
  "upstream-vbench2": "上游 VBench-2.0(待供)",
  "human-review": "人证回写",
};

/** 按注册表顺序归组,组内保持注册表顺序。 */
export function groupDimensionsByCategory(
  specs: readonly ChapterQcDimensionSpecV1[] = CHAPTER_QC_DIMENSIONS,
): Array<{ category: ChapterQcDimensionCategory; label: string; weight: number; specs: ChapterQcDimensionSpecV1[] }> {
  const order: ChapterQcDimensionCategory[] = [];
  const buckets = new Map<ChapterQcDimensionCategory, ChapterQcDimensionSpecV1[]>();
  for (const spec of specs) {
    if (!buckets.has(spec.category)) {
      buckets.set(spec.category, []);
      order.push(spec.category);
    }
    buckets.get(spec.category)!.push(spec);
  }
  return order.map((category) => {
    const group = buckets.get(category)!;
    return {
      category,
      label: CHAPTER_QC_CATEGORY_LABELS[category],
      weight: group.reduce((sum, spec) => sum + spec.weight, 0),
      specs: group,
    };
  });
}
