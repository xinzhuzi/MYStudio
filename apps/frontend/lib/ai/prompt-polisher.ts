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
  /** 视觉手册 ID（如 "2d_shonen"、"daojie_ink_guofeng"） */
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
    const resolvedBinding = binding ?? { agent: "universalAi" as const };
    const result: AITextResult = await aiManager.text({
      binding: resolvedBinding,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      maxTokens: 2048,
    });

    if (!result.success || !result.text) {
      return {
        prompt: "",
        negativePrompt: "",
        status: "failed",
        error: result.error ?? "AI 调用失败",
      };
    }

    // Step 6: 解析输出
    const parsed = parsePolishResult(result.text);

    return {
      ...parsed,
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
  if (typeof window === "undefined" || !window.studioVisualManuals?.read) return null;
  try {
    const result = await window.studioVisualManuals.read(visualManualId);
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
  }

  // 衍生资产追加指令
  if (isDerivative) {
    prompt += "\n\n**注意：这是衍生资产，请在保持基础形象不变的前提下进行变体设计。叠加层级：妆容→发型→中衣→外衣→鞋履→配饰。**";
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
