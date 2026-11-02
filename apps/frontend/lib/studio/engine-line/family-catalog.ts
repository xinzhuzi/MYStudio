// 族↔工作流库域映射(11-02-engine-model-workflow-hub R3):控制中心工作流段按
// 当前族拉漫影工作流库对应域前缀(list_workflows prefix 过滤,light 防海量件雷)。
// 1102 实锚:库内 1_图片/ 下现域=Q2-1图像(qi21)/K2图像/Flux3图像/MOSS图像;
// 其余本地族(flux2/编辑/z_image)无库内域——工作流段显示占位(引擎内置模板)。
import { LOCAL_ENGINE_FAMILIES, STOPPED_ENGINE_FAMILIES, type EngineFamilyOption } from "./engine-options";

export interface EngineFamilyMeta extends EngineFamilyOption {
  /** 工作流库域前缀(list_workflows prefix);null=库内无域,R3 显示占位。 */
  workflowPrefix: string | null;
}

const FAMILY_META: EngineFamilyMeta[] = [
  ...LOCAL_ENGINE_FAMILIES.map((family) => ({
    ...family,
    workflowPrefix: family.value === "qwen-image-2-1" ? "1_图片/Q2-1图像" : null,
  })),
  ...STOPPED_ENGINE_FAMILIES.map((family) => ({ ...family, workflowPrefix: null })),
];

/** 当前族元数据(含工作流域前缀);未知值(含 ""=自动)回落 qi21 域。 */
export function engineFamilyMeta(defaultImageModel: string): EngineFamilyMeta {
  const hit = FAMILY_META.find((family) => family.value === defaultImageModel);
  if (hit) return hit;
  // ""(自动)与未知值:本地 provider 首位恒 qi21(default-image-model 链回落语义)
  const qi21 = FAMILY_META.find((family) => family.value === "qwen-image-2-1");
  if (!qi21) throw new Error("engine family catalog missing qwen-image-2-1");
  return { ...qi21, label: `${qi21.label}(自动)`, hint: "跟随渠道链,本地即此族" };
}
