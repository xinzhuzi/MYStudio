/**
 * 资产提示词润色服务
 *
 * 接入点：
 * - getManualModuleText("visual", styleId, moduleKey) — 获取视觉手册模块
 * - aiManager.text(req) — 调用 LLM
 *
 * 参考：
 * - ToonFlow: src/routes/assetsGenerate/polishAssetsPrompt.ts
 * - 魔因漫创: src/lib/character/character-prompt-service.ts
 */

import { getManualModuleText as getBundledManualModuleText } from "@/lib/studio/manuals";
import { aiManager, type AIBinding, type AITextResult } from "@/lib/ai/ai-manager";
import { normalizeImagePromptForGeneration } from "@/lib/ai/ai-sdk-bridge";
import { getStudioVisualManualsBridge } from "@/lib/bridge/studio-visual-manuals";
import { createOperationId, logEvent } from "@/lib/diagnostics/logger";
import { EXTENDED_VISUAL_MANUAL_SEED_ID } from "@/lib/studio/visual-manual-classification";
import {
  buildDaojiePaletteSelectionCatalog,
  parseDaojiePaletteSelectionResponse,
  prefilterDaojiePaletteSchemes,
} from "@/lib/ai/daojie-palette";
import type { AIFeature } from "@/lib/ai/feature-definitions";
import type { CharacterIdentityAnchors } from "@/types/script";
import type { StudioVisualManualDetail } from "@/types/studio-visual-manual";

// ─── 类型定义 ───

export type AssetType = "character" | "scene" | "prop";

export interface PolishRequest {
  /** 资产类型 */
  assetType: AssetType;
  /** 资产名称 */
  name: string;
  /** 资产描述（来自实体提取的 note 或用户手写） */
  description: string;
  /** 是否衍生资产（影响模板选择） */
  isDerivative: boolean;
  /** 视觉手册 ID（如 "2d_shonen"、扩展手册种子 ID） */
  visualManualId: string;
  /** 角色6层身份锚点（仅角色类型需要） */
  identityAnchors?: CharacterIdentityAnchors;
  /** 现有负面提示词（可选追加） */
  negativePrompt?: string;
}

export interface PolishResult {
  /** 润色后的英文提示词 */
  prompt: string;
  /** 中文描述（可选） */
  promptZh?: string;
  /** 推荐的负面提示词 */
  negativePrompt: string;
  /** 提示词状态 */
  status: "success" | "failed";
  /** 失败原因 */
  error?: string;
  /**
   * 道劫 ma-gongbi-v1 合同标记:prompt 是题材正文(subject body),不是最终 provider 文本。
   * 自动层/长度门/Avoid 负面由 daojie-prompt-contract 编译器在生成前统一装配。
   * schemeId=AI 自动挑选的三轨配色方案(ma-gongbi-palette-v1);未挑选时缺省。
   */
  daojie?: { subjectBody: string; schemeId?: string };
}

export interface BatchPolishConfig {
  /** 并发数，默认 3 */
  concurrency?: number;
  /** 进度回调 */
  onProgress?: (done: number, total: number) => void;
  /** 取消检查 */
  onCancel?: (id: string) => boolean;
}

// ─── 核心函数：单条润色 ───

/**
 * 润色单个资产的提示词
 *
 * 流程：
 * 1. 根据 assetType + isDerivative 确定模块键名
 * 2. 从 art_skills 加载 prefix.md + 对应模板
 * 3. 构建 system prompt (prefix + template)
 * 4. 构建 user prompt (名称 + 描述 + 身份锚点)
 * 5. 调用 LLM 获取润色结果
 * 6. 解析输出
 */
export async function polishAssetPrompt(
  request: PolishRequest,
  binding?: AIBinding,
): Promise<PolishResult> {
  const { assetType, name, description, isDerivative, visualManualId, identityAnchors } = request;
  const isDaojieManual = visualManualId === EXTENDED_VISUAL_MANUAL_SEED_ID;

  try {
    // Step 1: 确定模块键名
    const moduleKey = getModuleKey(assetType, isDerivative);

    // Step 2: 加载视觉手册内容
    const runtimeManual = await readRuntimeVisualManual(visualManualId);
    const prefixContent = getVisualManualModuleText(visualManualId, "prefix", runtimeManual);
    const templateContent = getVisualManualModuleText(visualManualId, moduleKey, runtimeManual);

    if (!templateContent) {
      return {
        prompt: "",
        negativePrompt: "",
        status: "failed",
        error: `未找到视觉手册模块: ${visualManualId}/${moduleKey}`,
      };
    }

    // Step 3: 拼接 system prompt
    const systemPrompt = [prefixContent, templateContent].filter(Boolean).join("\n\n---\n\n");

    // Step 4: 构建 user prompt
    const userPrompt = buildUserPrompt(assetType, name, description, identityAnchors, isDerivative);

    // Step 5: 调用 LLM
    const result: AITextResult = await callPromptPolishModel({
      binding,
      systemPrompt,
      userPrompt,
    });

    if (!result.success || !result.text) {
      console.warn("[prompt-polisher] 文本模型不可用，使用视觉手册本地兜底提示词:", result.error);
      if (isDaojieManual) {
        // 道劫兜底:构造同合同的本地题材正文,不退化为英文逗号串;
        // 通用负面归编译器,这里只保留作业级负面。
        const subjectBody = buildDaojieLocalSubjectBody({ assetType, name, description, isDerivative });
        const prefiltered = prefilterDaojiePaletteSchemes({ runtimeTrack: assetType, name, description, subjectBody });
        return {
          prompt: subjectBody,
          promptZh: `${name}：${description.trim() || name}`,
          negativePrompt: request.negativePrompt?.trim() ?? "",
          daojie: { subjectBody, ...(prefiltered[0] ? { schemeId: prefiltered[0].scheme.schemeId } : {}) },
          status: "success",
        };
      }
      const fallback = buildLocalFallbackPolishResult({
        assetType,
        name,
        description,
        systemPrompt,
        visualManualId,
        negativePrompt: request.negativePrompt,
      });
      return {
        ...fallback,
        status: "success",
      };
    }

    // Step 6: 解析输出
    const parsed = parsePolishResult(result.text);
    if (isDaojieManual) {
      // 道劫:LLM 只拥有题材正文;不做通用 clean/denoise 追加,
      // 自动层、唯一 Avoid 与 300-800 长度门由 daojie-prompt-contract 在生成前统一编译。
      const subjectBody = sanitizeExtendedManualPrompt(parsed.prompt);
      // AI 自动选配三轨配色方案(42 色卡/每轨 8 方案);失败降级规则预筛,再降级 source-facts-only
      const schemeId = await selectDaojiePaletteSchemeForAsset({ assetType, name, description, subjectBody });
      return {
        ...parsed,
        prompt: subjectBody,
        negativePrompt: parsed.negativePrompt || request.negativePrompt || "",
        daojie: { subjectBody, ...(schemeId ? { schemeId } : {}) },
        status: "success",
      };
    }
    const normalizedPrompt = normalizeImagePromptForGeneration({
      prompt: parsed.prompt,
      negativePrompt: parsed.negativePrompt || request.negativePrompt,
    });

    return {
      ...parsed,
      prompt: normalizedPrompt.prompt,
      negativePrompt: normalizedPrompt.negativePrompt,
      status: "success",
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      prompt: "",
      negativePrompt: "",
      status: "failed",
      error: message,
    };
  }
}

const PROMPT_POLISH_FEATURES: AIFeature[] = ["script_analysis", "chat"];

async function callPromptPolishModel(input: {
  binding?: AIBinding;
  systemPrompt: string;
  userPrompt: string;
}): Promise<AITextResult> {
  const messages = [
    { role: "system" as const, content: input.systemPrompt },
    { role: "user" as const, content: input.userPrompt },
  ];

  if (input.binding) {
    return aiManager.text({
      binding: input.binding,
      messages,
      temperature: 0.7,
      maxTokens: 2048,
      fallbackToUniversal: false,
    });
  }

  const featureErrors: string[] = [];
  for (const feature of PROMPT_POLISH_FEATURES) {
    try {
      const text = await aiManager.featureText(feature, input.systemPrompt, input.userPrompt, {
        temperature: 0.7,
        maxTokens: 2048,
        disableThinking: true,
      });
      if (text.trim()) {
        return { success: true, text };
      }
      featureErrors.push(`${feature}: 空响应`);
    } catch (error) {
      featureErrors.push(`${feature}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const fallback = await aiManager.text({
    binding: { agent: "universalAi" },
    messages,
    temperature: 0.7,
    maxTokens: 2048,
    fallbackToUniversal: false,
  });

  if (!fallback.success && featureErrors.length > 0) {
    return {
      success: false,
      error: [...featureErrors, fallback.error ? `universalAi: ${fallback.error}` : ""].filter(Boolean).join("；"),
    };
  }

  return fallback;
}

// ─── 批量润色 ───

/**
 * 批量润色多个资产的提示词
 * 分轮执行，每轮 concurrency 个并发
 */
export async function batchPolishAssetPrompts(
  requests: PolishRequest[],
  binding?: AIBinding,
  config?: BatchPolishConfig,
): Promise<Map<string, PolishResult>> {
  const results = new Map<string, PolishResult>();
  const concurrency = config?.concurrency ?? 3;

  for (let i = 0; i < requests.length; i += concurrency) {
    const batch = requests.slice(i, i + concurrency);

    const batchResults = await Promise.all(
      batch.map(async (req) => {
        const key = `${req.assetType}:${req.name}`;

        // 取消检查
        if (config?.onCancel?.(key)) {
          const skipped: PolishResult = {
            prompt: "",
            negativePrompt: "",
            status: "failed",
            error: "已取消",
          };
          return { key, result: skipped };
        }

        const result = await polishAssetPrompt(req, binding);
        return { key, result };
      }),
    );

    // 收集结果
    for (const { key, result } of batchResults) {
      results.set(key, result);
    }

    // 进度回调
    const done = Math.min(i + concurrency, requests.length);
    config?.onProgress?.(done, requests.length);
  }

  return results;
}

// ─── 辅助函数 ───

/**
 * 根据资产类型和衍生标记确定模块键名
 * 对齐 manuals.ts 的 visualModuleKeys
 */
function getModuleKey(assetType: AssetType, isDerivative: boolean): string {
  const keyMap: Record<AssetType, { base: string; derivative: string }> = {
    character: { base: "art_character", derivative: "art_character_derivative" },
    scene: { base: "art_scene", derivative: "art_scene_derivative" },
    prop: { base: "art_prop", derivative: "art_prop_derivative" },
  };
  const map = keyMap[assetType];
  return isDerivative ? map.derivative : map.base;
}

async function readRuntimeVisualManual(visualManualId: string): Promise<StudioVisualManualDetail | null> {
  const studioVisualManuals = getStudioVisualManualsBridge();
  if (!studioVisualManuals?.read) return null;
  try {
    const result = await studioVisualManuals.read(visualManualId);
    return result.success && result.manual ? result.manual : null;
  } catch {
    return null;
  }
}

function getVisualManualModuleText(
  visualManualId: string,
  moduleKey: string,
  runtimeManual: StudioVisualManualDetail | null,
) {
  const runtimeContent = runtimeManual?.modules.find((module) => module.value === moduleKey)?.content ?? "";
  return runtimeContent || getBundledManualModuleText("visual", visualManualId, moduleKey);
}

/**
 * 构建 User Prompt
 * 融合 ToonFlow 格式 + 魔因身份锚点
 */
function buildUserPrompt(
  assetType: AssetType,
  name: string,
  description: string,
  identityAnchors?: CharacterIdentityAnchors,
  isDerivative?: boolean,
): string {
  const labelMap: Record<AssetType, string> = {
    character: "角色",
    scene: "场景",
    prop: "道具",
  };
  const label = labelMap[assetType];

  let prompt = `**基础参数：**\n**${label}设定：**\n-${label}名称:${name}\n-${label}描述:${description}`;

  // 注入身份锚点（仅角色，对齐 CharacterIdentityAnchors 六层结构）
  if (assetType === "character" && identityAnchors) {
    prompt += "\n\n**一致性锚点：**";

    // ① 骨相层
    if (identityAnchors.faceShape) prompt += `\n- 脸型: ${identityAnchors.faceShape}`;
    if (identityAnchors.jawline) prompt += `\n- 下颌线: ${identityAnchors.jawline}`;
    if (identityAnchors.cheekbones) prompt += `\n- 颧骨: ${identityAnchors.cheekbones}`;

    // ② 五官层
    if (identityAnchors.eyeShape) prompt += `\n- 眼型: ${identityAnchors.eyeShape}`;
    if (identityAnchors.eyeDetails) prompt += `\n- 眼部细节: ${identityAnchors.eyeDetails}`;
    if (identityAnchors.noseShape) prompt += `\n- 鼻型: ${identityAnchors.noseShape}`;
    if (identityAnchors.lipShape) prompt += `\n- 唇型: ${identityAnchors.lipShape}`;

    // ③ 辨识标记层
    if (identityAnchors.uniqueMarks?.length) {
      prompt += `\n- 独特标记: ${identityAnchors.uniqueMarks.join("、")}`;
    }

    // ④ 色彩锚点层
    if (identityAnchors.colorAnchors) {
      const ca = identityAnchors.colorAnchors;
      const parts: string[] = [];
      if (ca.iris) parts.push(`虹膜:${ca.iris}`);
      if (ca.hair) parts.push(`发色:${ca.hair}`);
      if (ca.skin) parts.push(`肤色:${ca.skin}`);
      if (ca.lips) parts.push(`唇色:${ca.lips}`);
      if (parts.length) prompt += `\n- 色彩锚点: ${parts.join(", ")}`;
    }

    // ⑤ 皮肤纹理层
    if (identityAnchors.skinTexture) prompt += `\n- 肤质: ${identityAnchors.skinTexture}`;

    // ⑥ 发型锚点层
    if (identityAnchors.hairStyle) prompt += `\n- 发型: ${identityAnchors.hairStyle}`;
    if (identityAnchors.hairlineDetails) prompt += `\n- 发际线: ${identityAnchors.hairlineDetails}`;

    prompt += "\n（若风格手册与上述一致性锚点冲突，以一致性锚点优先，风格手册在该项上退让；锚点属性在画面各视图中保持一致）";
  }

  // 衍生资产追加指令
  if (isDerivative) {
    prompt += "\n\n**注意：这是衍生资产，请在保持基础形象不变的前提下进行变体设计。叠加层级：妆容→发型→中衣→外衣→配饰。**";
  }

  return prompt;
}

/**
 * 解析 LLM 润色结果
 *
 * 从 AI 输出中提取：
 * 1. 负面提示词（Negative Prompt 标记后）
 * 2. 中文描述（可选）
 * 3. 英文提示词（剩余文本）
 */
function parsePolishResult(
  rawText: string,
): { prompt: string; promptZh?: string; negativePrompt: string } {
  let text = rawText;
  let negativePrompt = "";
  let promptZh = "";

  // 提取负面提示词
  const negPatterns = [
    /(?:Negative[_ ]?Prompt|反向提示词?|负面提示词?|Avoid|严禁)[：:]\s*([\s\S]*?)(?=\n\n|\n#|$)/i,
  ];
  for (const pat of negPatterns) {
    const match = text.match(pat);
    if (match) {
      negativePrompt = match[1].trim();
      text = text.replace(match[0], "");
      break;
    }
  }

  // 提取中文描述
  const zhPatterns = [
    /(?:中文描述|Chinese Description|描述)[：:]\s*([\s\S]*?)(?=\n\n|\n#|\n(?:英文|English|Prompt)|$)/i,
  ];
  for (const pat of zhPatterns) {
    const match = text.match(pat);
    if (match) {
      promptZh = match[1].trim();
      text = text.replace(match[0], "");
      break;
    }
  }

  // 剩余文本作为英文提示词
  const prompt = text.trim();

  return {
    prompt: prompt || rawText.trim(),
    promptZh: promptZh || undefined,
    negativePrompt,
  };
}

/**
 * AI 自动选配三轨配色方案(ma-gongbi-palette-v1):
 * LLM 从当前轨 8 个方案中按资产气质挑选,输出严格 JSON;失败降级规则预筛,再降级 null(source-facts-only)。
 */
export async function selectDaojiePaletteSchemeForAsset(input: {
  assetType: AssetType;
  name: string;
  description: string;
  /** 润色产出的题材正文:其色彩段是五职责色相的权威信号,防止正文与配方同框打架。 */
  subjectBody: string;
}): Promise<string | null> {
  const maTrack = input.assetType === "character" ? "person" : input.assetType;
  const trackLabel: Record<AssetType, string> = { character: "人物", scene: "场景", prop: "道具" };
  const systemPrompt = [
    "你是道劫工笔生图的配色导演。42 色卡体系为每个轨道提供配色方案(五职责矿物色配方:底色/墨线/主色/辅色/点睛色)。",
    "给定资产信息与已写好的题材正文,从候选方案中选一个。",
    "防冲突规则(按优先级):",
    "1. 题材正文色彩段若已写明五职责色相(主色/辅色/点睛等),只允许选与之一致的方案;无一致方案必须输出 null(色相服从正文事实,不得让配方与正文同框打架)。",
    "2. 正文未写明职责色相时,按资产气质/用途匹配 suitable,规避 forbidden。",
    "3. 绝不编造候选之外的 id。",
    '只输出一个 JSON 对象:{"schemeId":"<候选id>"} 或 {"schemeId":null}',
  ].join("\n");
  const userPrompt = `资产类型:${trackLabel[input.assetType]}\n名称:${input.name}\n描述:${input.description}\n题材正文:\n${input.subjectBody}\n\n候选方案:\n${buildDaojiePaletteSelectionCatalog(maTrack)}`;
  const operationId = createOperationId("daojie-palette-select");
  const logDecision = (schemeId: string | null, tier: "llm" | "prefilter" | "none") => {
    void logEvent({
      level: "info",
      category: "ai",
      operationId,
      message: "Daojie palette scheme decision",
      context: { maTrack, schemeId, tier, assetName: input.name },
    });
  };
  for (const feature of PROMPT_POLISH_FEATURES) {
    try {
      const text = await aiManager.featureText(feature, systemPrompt, userPrompt, {
        temperature: 0,
        maxTokens: 256,
        disableThinking: true,
      });
      const decision = parseDaojiePaletteSelectionResponse(text, maTrack);
      // 合法决策(含显式 null)即停;格式坏才换下一通道
      if (decision !== undefined) {
        logDecision(decision, "llm");
        return decision;
      }
    } catch {
      // 尝试下一 feature;全部失败走预筛兜底
    }
  }
  const prefiltered = prefilterDaojiePaletteSchemes({
    runtimeTrack: input.assetType,
    name: input.name,
    description: input.description,
    subjectBody: input.subjectBody,
  });
  const fallback = prefiltered[0]?.scheme.schemeId ?? null;
  logDecision(fallback, fallback ? "prefilter" : "none");
  return fallback;
}

/**
 * 道劫 LLM 失败兜底:按对应轨道职责构造最小题材正文(七段公式的紧凑本地形态)。
 * 只写题材事实与轨道职责;风格底座/轨道锁/成片锁/通用负面归 daojie-prompt-contract 编译器。
 */
function buildDaojieLocalSubjectBody(input: {
  assetType: AssetType;
  name: string;
  description: string;
  isDerivative: boolean;
}): string {
  const description = input.description.trim() || input.name;
  const trackDuty: Record<AssetType, string> = {
    character: "面部、发式、手势、服饰与身份标识清晰可读；构图主体明确，背景次要",
    scene: "建筑、地形与空间层次结构清楚，主体纯度高，结构线稳定",
    prop: "单体器物为唯一主角，材质、轮廓与工艺边缘清晰",
  };
  const label: Record<AssetType, string> = { character: "人物", scene: "场景", prop: "道具" };
  const parts = [
    `${label[input.assetType]}设定：${input.name}。${description}。`,
    `呈现职责：${trackDuty[input.assetType]}。`,
  ];
  if (input.isDerivative) {
    parts.push("衍生变体：保持基础形象不变，仅叠加妆容、发型、服饰或配饰层级。");
  }
  return parts.join("");
}

function buildLocalFallbackPolishResult(input: {
  assetType: AssetType;
  name: string;
  description: string;
  systemPrompt: string;
  visualManualId: string;
  negativePrompt?: string;
}): { prompt: string; promptZh?: string; negativePrompt: string } {
  const styleAnchor = extractVisualStyleAnchor(input.systemPrompt);
  const typeInstruction: Record<AssetType, string> = {
    character: "single character concept art, clear face, full-body readable silhouette, costume and identity details",
    scene:
      input.visualManualId === EXTENDED_VISUAL_MANUAL_SEED_ID
        ? "environment concept art, clear spatial layout, even flat diffuse illumination, pale ink atmospheric perspective"
        : "environment concept art, clear spatial layout, cinematic lighting, atmospheric depth",
    prop: "single prop concept art, isolated object, readable material, no hands, no characters",
  };
  const zhLabel: Record<AssetType, string> = {
    character: "角色",
    scene: "场景",
    prop: "道具",
  };
  const description = input.description.trim() || input.name;
  const prompt = [
    styleAnchor,
    typeInstruction[input.assetType],
    `${zhLabel[input.assetType]}名称: ${input.name}`,
    `${zhLabel[input.assetType]}描述: ${description}`,
    "high detail, sharp focus, polished composition, no text in image",
  ].filter(Boolean).join(", ");

  const normalizedPrompt = normalizeImagePromptForGeneration({
    prompt:
      input.visualManualId === EXTENDED_VISUAL_MANUAL_SEED_ID
        ? sanitizeExtendedManualPrompt(prompt)
        : prompt,
    negativePrompt: input.negativePrompt?.trim()
      || "low quality, blurry, watermark, logo, text, subtitle, extra limbs, distorted face, cropped subject",
  });

  return {
    prompt: normalizedPrompt.prompt,
    promptZh: `${zhLabel[input.assetType]}「${input.name}」：${description}`,
    negativePrompt: normalizedPrompt.negativePrompt,
  };
}

function extractVisualStyleAnchor(systemPrompt: string) {
  const backtickMatches = [...systemPrompt.matchAll(/`([^`]{20,400})`/g)]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value));
  const englishAnchor = backtickMatches.find((value) => /[a-zA-Z]/.test(value));
  if (englishAnchor) return englishAnchor;

  const compactLine = systemPrompt
    .split(/\n+/)
    .map((line) => line.replace(/[|#>*`]/g, " ").trim())
    .find((line) => /[a-zA-Z]/.test(line) && line.length >= 20);
  return compactLine || "";
}

const EXTENDED_MANUAL_PROMPT_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bcinematic\s+lighting\b/gi, "even flat diffuse illumination"],
  [/\bcinematic\s+composition\b/gi, "clear layered ink-wash composition"],
  [/\bcinematic\s+(?:quality|atmosphere|motion)\b/gi, "clean finished gongbi quality"],
  [/\bvolumetric\s+fog\b/gi, "layered pale ink mist"],
  [/\bvolumetric\s+light\b/gi, "paper-scattered light"],
  [/\bshallow\s+depth\s+of\s+field\b/gi, "clear layered ink-wash depth"],
  [/\bdepth\s+of\s+field\s+blur\b/gi, "ink-wash atmospheric perspective"],
  [/\bdepth\s+of\s+field\b/gi, "ink-wash atmospheric perspective"],
  [/\bfilm\s+grain\b/gi, "smooth matte finish"],
  [/\b(?:muted|low[- ]saturation)\s+cyan[- ]green\s+palette\b/gi, "muted yet visible mineral-color palette with soft cyan-green and vermilion accents"],
  // 08-28 无色根修:存量旧提示词节点内嵌旧压色 token,发送前升级为新彩色口径
  // (各规则幂等:替换产物不再命中自身);与手册 storyboard-image-style-tokens 同步演化。
  [/\brestrained\s+mineral-color\s+palette\b/gi, "muted yet visible mineral-color palette with soft cyan-green and vermilion accents"],
  [/墨色层次丰富(?!，青绿朱砂赭石淡彩点缀)/g, "墨色层次丰富，青绿朱砂赭石淡彩点缀"],
  [/\bclear\s+layered\s+ink-wash\s+composition\b/gi, "clear layered colored ink-wash composition with visible mineral pigments"],
  [/\bHDR\s+highlights?\b/gi, "soft paper-scattered light"],
  [/\bmirror(?:ed)?\s+wet\s+reflections?\b/gi, "controlled matte material"],
  [/\b(?:rice|xuan)[- ]paper\s+texture\b/gi, "smooth pale matte flat-wash ground"],
  [/宣纸质感/g, "浅净平涂底"],
  [/宣纸肌理/g, "浅净平涂底"],
  [/电影级(?:光影|布光|构图|质感|氛围)/g, "均匀平光与清楚分层"],
  [/电影质感/g, "干净工笔成片质感"],
  [/电影构图/g, "清楚前中远景构图"],
  [/电影级体积雾/g, "淡墨雾层"],
  [/体积雾/g, "淡墨雾层"],
  [/浅景深(?:虚化)?/g, "淡墨空气透视"],
  [/景深虚化/g, "淡墨空气透视"],
  [/胶片颗粒/g, "平滑细腻成片"],
];

/** Remove legacy cinematic/noise directives before an extended-manual prompt reaches an image provider. */
export function sanitizeExtendedManualPrompt(prompt: string): string {
  let sanitized = prompt.trim();
  for (const [pattern, replacement] of EXTENDED_MANUAL_PROMPT_REPLACEMENTS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized.replace(/\(([^()]{1,200}):\s*\d+(?:\.\d+)?\)/g, "$1");
}
