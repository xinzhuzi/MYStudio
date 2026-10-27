// H3 工作流注册表(PRD 10-27-storyboard-h3-dual-channel §4;用户令②:模板可选可切换,禁硬绑单一模板)
// 锚点契约驱动:批量可派发硬门=§4.3 三层(注入层锚字段全在 API 图/回收层 MyShot+五段前缀/引擎层 class_type 在 object_info)。
// C1 修正:apiTemplate?(仅 ready 件,批量可派发前提)与 uiTemplateRef?(仅登记/画布直开)二态;resolutionTiers 数组(一件可双档)。
// uiTemplateRef 路径基=apps/backend/comfyui/workflows/(repo 工作流库,分镜域零实体裁定不破)。
// 锚字段名以 object_info 实锚为准(1027 引擎 17001 实查):节点 14 的文本锚是 14.value
// (PrimitiveStringMultiline 的 INPUT_TYPES 键为 value,设计稿曾记 14.text,以实锚为准)。

export type H3WorkflowInputMode = "i2v" | "fl2v" | "r2v" | "t2v" | "multiseg";

export type H3RecipeStatus = "ready" | "needs-adaptation" | "needs-unfreeze" | "cloud-paid" | "unverified";

export type H3ResolutionTier = "480p" | "960p";

export interface H3WorkflowRecipe {
  /** 稳定标识 */
  id: string;
  /** UI 显示名 */
  label: string;
  /** 前端 bundle API 件路径——批量可派发的前提(仅 ready 件有) */
  apiTemplate?: string;
  /** repo 工作流库 UI 件相对路径(基=apps/backend/comfyui/workflows/)——仅登记/画布直开 */
  uiTemplateRef?: string;
  inputMode: H3WorkflowInputMode;
  /** 注入点(标量出厂直填 apiGraph;b64 图走 execute images 通道)。
   *  unverified/needs-adaptation 件未逐件校锚,锚待实锚后补(禁猜字段名)。 */
  anchors?: {
    /** 提示词文本锚(如 "14.value") */
    prompt: string;
    /** 秒数锚(如 "20.value");multiseg 无(时长在分段文本内) */
    seconds?: string;
    /** 首帧锚(如 "9.image");t2v/multiseg 无 */
    firstFrame?: string;
    /** 档位宽高字段对(如 ["16.width","16.height"];N11) */
    resolution?: string[];
    /** 五段式前缀锚(回收白名单依赖) */
    savePrefix: string;
    /** MyShot 节点号(批量回收必需;无=仅画布可开) */
    myShot?: string;
  };
  /** 支持档(C1:数组,一件可双档) */
  resolutionTiers: H3ResolutionTier[];
  status: H3RecipeStatus;
  notes?: string;
}

export const H3_WORKFLOW_RECIPES: H3WorkflowRecipe[] = [
  {
    id: "my-h3-i2v-31",
    label: "漫影单镜 I2V(31 节点单段直出)",
    apiTemplate: "./h3-shot-template.api.json",
    inputMode: "i2v",
    anchors: {
      prompt: "14.value",
      seconds: "20.value",
      firstFrame: "9.image",
      resolution: ["16.width", "16.height"],
      savePrefix: "4.filename_prefix",
      myShot: "100",
    },
    resolutionTiers: ["480p", "960p"],
    status: "ready",
    notes: "唯一批量首发件(D3);组装器=buildShotH3ApiWorkflow,档位宽高 960p=1344×768/480p=608×352 直填 16.width/height。",
  },
  {
    id: "my-h3-multiseg",
    label: "漫影分段视频(multiseg)",
    uiTemplateRef: "2_视频/H3视频/1_漫影自研/1_分段视频/h3-autocontext-multiseg.json",
    inputMode: "multiseg",
    resolutionTiers: ["960p"],
    status: "needs-adaptation",
    notes: "12 节点无 MyShot 锚/无首帧槽/前缀 video/H3/分段视频 非五段式,批量派发不可用,仅画布直开(Q1);适配(加 MyShot+五段前缀+分段提示词组装器)二期。",
  },
  {
    id: "guding-480p-direct",
    label: "固定线:480P 生成 SolAttn 加速直出",
    uiTemplateRef: "2_视频/H3视频/2_固定线/社区-480P生成-SolAttn加速-480P直出.json",
    inputMode: "i2v",
    resolutionTiers: ["480p"],
    status: "unverified",
    notes: "登记;逐件校锚后升级。",
  },
  {
    id: "guding-960p-refine",
    label: "固定线:480P 生成 960P 精修直出",
    uiTemplateRef: "2_视频/H3视频/2_固定线/社区-480P生成-960P精修-SolAttn加速-960P直出.json",
    inputMode: "i2v",
    resolutionTiers: ["960p"],
    status: "unverified",
    notes: "登记;逐件校锚后升级。",
  },
  {
    id: "official-i2v-480p",
    label: "官方本地:I2V 480P",
    uiTemplateRef: "2_视频/H3视频/4_官方本地模板/官方本地-I2V-480P.json",
    inputMode: "i2v",
    resolutionTiers: ["480p"],
    status: "unverified",
  },
  {
    id: "official-fl2v-motion-480p",
    label: "官方本地:首尾帧运镜版",
    uiTemplateRef: "2_视频/H3视频/4_官方本地模板/H3-首尾帧运镜版.json",
    inputMode: "fl2v",
    resolutionTiers: ["480p"],
    status: "unverified",
  },
  {
    id: "official-t2v-480p",
    label: "官方本地:文生视频 480P",
    uiTemplateRef: "2_视频/H3视频/4_官方本地模板/H3-文生视频-480p.json",
    inputMode: "t2v",
    resolutionTiers: ["480p"],
    status: "unverified",
  },
  {
    id: "official-t2v-480p-alt",
    label: "官方本地:T2V 480P(另一版)",
    uiTemplateRef: "2_视频/H3视频/4_官方本地模板/官方本地-T2V-480P.json",
    inputMode: "t2v",
    resolutionTiers: ["480p"],
    status: "unverified",
  },
  {
    id: "official-r2v-480p",
    label: "官方本地:R2V 480P(需解冻 ref2va)",
    uiTemplateRef: "2_视频/H3视频/4_官方本地模板/官方本地-R2V-480P-需解冻ref2va.json",
    inputMode: "r2v",
    resolutionTiers: ["480p"],
    status: "needs-unfreeze",
    notes: "ref2va 权重已删不可实弹;解冻后逐件校锚再升级。",
  },
  {
    id: "api-flf2v-480p",
    label: "官方 API:FLF2V 480P(云端收费)",
    uiTemplateRef: "2_视频/H3视频/5_云端API/官方API-FLF2V-480P.json",
    inputMode: "fl2v",
    resolutionTiers: ["480p"],
    status: "cloud-paid",
    notes: "只登记;云端收费+外发,UI 默认隐藏须显式开启。",
  },
  {
    id: "api-r2v-480p",
    label: "官方 API:R2V 480P(云端收费)",
    uiTemplateRef: "2_视频/H3视频/5_云端API/官方API-R2V-480P.json",
    inputMode: "r2v",
    resolutionTiers: ["480p"],
    status: "cloud-paid",
    notes: "只登记;云端收费+外发,UI 默认隐藏须显式开启。",
  },
  {
    id: "api-t2v-480p",
    label: "官方 API:T2V 480P(云端收费)",
    uiTemplateRef: "2_视频/H3视频/5_云端API/官方API-T2V-480P.json",
    inputMode: "t2v",
    resolutionTiers: ["480p"],
    status: "cloud-paid",
    notes: "只登记;云端收费+外发,UI 默认隐藏须显式开启。",
  },
];

/** 批量可派发集合(§4.3 三层硬门全过=ready 件才入;needs-adaptation/unverified/cloud-paid 一律不入)。 */
export function batchDispatchableH3Recipes(): H3WorkflowRecipe[] {
  return H3_WORKFLOW_RECIPES.filter((recipe) => recipe.status === "ready");
}
