// 引擎·模型族共享选项源(11-02-engine-model-workflow-hub G1 裁定:控制中心族下拉
// 与图片规格页「生图引擎」按钮组共消费单源;qi21 补位——09-12 建表早于 qi21 产线,
// 现役主力曾缺席选项表)。
// 状态标三档(1102 实锚):ready=可切即用 / blocked=可选但诚实标因(缺件·缺模板)
// / stopped=停用裁定可看不可选(1101 K2/Flux3 树内保留不调用)。

export type EngineFamilyStatus = "ready" | "blocked" | "stopped";

export interface EngineFamilyOption {
  /** defaultImageModel 真源值;与 pipeline IMAGE_MODELS 键同源。 */
  value: string;
  label: string;
  hint: string;
  /** 状态档:ready 可选;blocked 展示+禁选(带原因);stopped 停用族灰显。 */
  status: EngineFamilyStatus;
  /** blocked/stopped 的原因短语(展示用)。 */
  blockedReason?: string;
}

/** 本地引擎族(控制中心族下拉主体;与图片规格页本地段同源)。 */
export const LOCAL_ENGINE_FAMILIES: EngineFamilyOption[] = [
  {
    value: "qwen-image-2-1",
    label: "Qwen-Image-2.1",
    hint: "现役产线 · 道劫",
    status: "ready",
  },
  {
    value: "qwen-image-edit-2511",
    label: "Qwen 图像编辑",
    hint: "本地 · 免费",
    status: "ready",
  },
  {
    value: "flux2-klein-9b",
    label: "FLUX.2 Klein 9B",
    hint: "本地 · 免费",
    status: "ready",
  },
  {
    // 10-19 实弹定谳:K2 三模型自引擎装机以来全缺——诚实标缺件,不放开选择
    value: "krea2-turbo",
    label: "Krea2 Turbo",
    hint: "模型缺件",
    status: "blocked",
    blockedReason: "引擎侧模型未装(10-19 实弹定谳全缺)",
  },
  {
    // E6:z_image 引擎无模板件——模型链在但工作流段待建
    value: "z-image-turbo",
    label: "Z-Image Turbo",
    hint: "模板待建",
    status: "blocked",
    blockedReason: "引擎模板待建(模型链在)",
  },
];

/** 停用族(1101 用户裁定:K2/Flux3 图像线先不用;树内保留不调用;仅展示家底)。 */
export const STOPPED_ENGINE_FAMILIES: EngineFamilyOption[] = [
  {
    value: "k2-image",
    label: "K2 图像",
    hint: "停用",
    status: "stopped",
    blockedReason: "1101 停用裁定",
  },
  {
    value: "flux3-image",
    label: "Flux3 图像",
    hint: "停用",
    status: "stopped",
    blockedReason: "1101 停用裁定",
  },
];

/** 控制中心族下拉全集(本地族在前,停用族垫底灰显)。 */
export const ALL_ENGINE_FAMILIES: EngineFamilyOption[] = [
  ...LOCAL_ENGINE_FAMILIES,
  ...STOPPED_ENGINE_FAMILIES,
];

/** value→条目速查(图片规格页高亮比对用)。 */
export function findEngineFamily(value: string): EngineFamilyOption | undefined {
  return ALL_ENGINE_FAMILIES.find((option) => option.value === value);
}
