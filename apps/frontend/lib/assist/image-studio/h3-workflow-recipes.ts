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
    /** 秒数锚(如 "20.value");multiseg 无(时长在分段文本标签行内,§14.1.3) */
    seconds?: string;
    /** 首帧锚(如 "9.image");t2v 无;multiseg 适配后有(§14.1.1 针2:9→101.first_frame 潜空间锚,提示词仍不带 FIXED_I2V 行) */
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
    // Windows FastH3 主线(10-27 windows-fasth3-mainline 接线;计划稿 id my-fasth3-i2v-31 按实数
    // 节点计数改 27——计划 §四 W2 明载「以实际计,若实做后非 28 以实数回写」)。
    id: "my-fasth3-i2v-27",
    label: "漫影单镜 FastH3 I2V(27 节点,Windows 主线)",
    apiTemplate: "./fasth3-shot-template.api.json",
    uiTemplateRef: "2_视频/H3视频/1_漫影自研/0_单镜视频/fasth3-单镜视频-i2v.json",
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
    status: "unverified",
    notes: "Windows FastH3 主线(8 步蒸馏 DiT R1+VSA 稀疏注意力+kitchen INT8 注意力;模型件=三对齐表 R1-R4,仅 Windows 引擎在册,派发须 env MYSTUDIO_COMFYUI_BRIDGE_URL 指向隧道)。status=unverified:三层硬门(注入锚/回收/引擎层)待实弹验收(计划 §五 B)后升 ready,升前批量派发须显式带 recipeId。超时沿用档位表 480p=900s/960p=2700s(FastH3 N 卡秒级~分钟级,execute 链 MAX_EXECUTE_TIMEOUT_S=2700s 上罩余量足)。前端模板对=fasth3-shot-template{,.api}.json,UI 真源=repo 库 fasth3-单镜视频-i2v.json(契约测试钉同步)。",
  },
  {
    id: "my-fasth3-t2v-26",
    label: "漫影单镜 FastH3 T2V 基础版(26 节点,画布直开)",
    uiTemplateRef: "2_视频/H3视频/1_漫影自研/0_单镜视频/fasth3-单镜视频-t2v.json",
    inputMode: "t2v",
    resolutionTiers: ["480p"],
    status: "unverified",
    notes: "无首帧纯文生(官方 t2v 同形);无 9.image 首帧锚,分镜批量线不适用,仅画布直开。",
  },
  {
    id: "my-h3-multiseg",
    label: "漫影分段视频(multiseg)",
    apiTemplate: "./h3-multiseg-template.api.json",
    uiTemplateRef: "2_视频/H3视频/1_漫影自研/1_分段视频/h3-autocontext-multiseg.json",
    inputMode: "multiseg",
    anchors: {
      prompt: "100.long_prompt",
      firstFrame: "9.image",
      resolution: ["100.width", "100.height"],
      savePrefix: "4.filename_prefix",
      myShot: "103",
    },
    resolutionTiers: ["960p"],
    status: "ready",
    notes: "二期适配完成(§14.1,四针=MyShot 锚 103/首帧潜空间锚 9→101.first_frame/五段前缀/双旁路出厂):适配 UI 件=h3-multiseg-template.json(前端 bundle,repo 原件零改);组装器=buildShotH3MultisegApiWorkflow(分段提示词 buildShotH3MultisegPrompt,无 seconds 锚——时长在分段文本标签行内);档位恒 960×544 模板原厂(M5:与 768p turbo LoRA 失配属画质议题,实弹判读后候令对齐);超时=resolveH3ShotTimeoutS(600+秒×300,clamp 14400);40s 硬顶拒派(M1)。",
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
