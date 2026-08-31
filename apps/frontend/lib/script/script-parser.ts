import { detectInputType } from "./input-type-detector";
import { CREATIVE_SCRIPT_BASE_PROMPT, STORYBOARD_STRUCTURE_PROMPT } from "./script-parser-prompts";

export interface ScriptGenerationOptions {
  apiKey: string;
  provider: string;
  baseUrl: string;
  model: string;
  language?: string;
  targetDuration?: string;
  sceneCount?: number;
  shotCount?: number;
  styleId?: string;
}

/**
 * Generate screenplay from creative input
 * Returns script text in import-compatible format
 */
export async function generateScriptFromIdea(
  idea: string,
  options: ScriptGenerationOptions
): Promise<string> {
  const { language = '中文', targetDuration = '60s', sceneCount, shotCount, styleId } = options;
  
  // 根据时长生成参考范围（不是硬限制，是给 AI 的参考）
  const durationSeconds = targetDuration === 'auto' ? 0 : (parseInt(targetDuration) || 60);
  let durationGuidance = '';
  if (durationSeconds > 0 && !sceneCount && !shotCount) {
    // 参考：每个镜头约2-5秒
    const minShots = Math.max(2, Math.ceil(durationSeconds / 5));
    const maxShots = Math.max(3, Math.ceil(durationSeconds / 2));
    durationGuidance = `\n- 时长参考：${durationSeconds}秒视频通常包含 ${minShots}-${maxShots} 个分镜，请根据内容需要自行把握节奏`;
  }

  // 检测输入类型
  const inputType = detectInputType(idea);
  
  // 统计原始输入中的镜头/场景数量
  // 支持多种格式：【镜头1】、**【镜头1：...】**、镜头1、场景1 等
  const shotMatches = idea.match(/\*?\*?[\[\u3010]\s*镜头\s*\d+/g) || [];
  const sceneMatches = idea.match(/场景\s*\d+/g) || [];
  const originalShotCount = Math.max(shotMatches.length, sceneMatches.length);
  
  
  // 如果检测到已有分镜结构，强调保留
  const preserveStructureNote = originalShotCount > 0 
    ? `\n\n**★★★ 特别注意 ★★★**
用户输入包含 ${originalShotCount} 个镜头/场景，你的输出必须有对应的 ${originalShotCount} 个场景（**1-1** 到 **1-${originalShotCount}**）。

重要：每个场景内只能有一个 △ 动作行！将该镜头的所有画面、对白、音效压缩成一句话。
禁止分别列出多行对白或音效，否则会生成多个分镜！`
    : '';
  
  const userPrompt = `请根据以下创意输入生成完整剧本：

[输入类型] ${inputType}

[创意内容]
${idea}

[要求]
- 语言：${language}
- 目标时长：${targetDuration === 'auto' ? '根据内容自行决定' : `约 ${targetDuration}`}${durationGuidance}
${originalShotCount > 0 ? `- 场景数量：必须有 ${originalShotCount} 个（与原始镜头一一对应）` : sceneCount ? `- 场景数量：约 ${sceneCount} 个` : '- 场景数量：根据内容和时长自行决定'}
${originalShotCount > 0 ? '' : shotCount ? `- 分镜数量：约 ${shotCount} 个` : '- 分镜数量：根据内容和时长自行决定'}
${styleId ? `- 视觉风格：${styleId}` : ''}

请生成符合标准格式的完整剧本，包含：
1. 剧本标题
2. 大纲（简述主题/故事）
3. 人物小传（每个角色的基本信息）
4. 完整的场景和对白${preserveStructureNote}`;

  
  // 根据是否有分镜结构选择不同的 system prompt
  // - 有分镜结构：使用基础 + 分镜结构特殊指令（每个场景只能有一个动作行）
  // - 无分镜结构：使用基础 prompt（允许正常展开多个动作/对白）
  const systemPrompt = originalShotCount > 0
    ? CREATIVE_SCRIPT_BASE_PROMPT + STORYBOARD_STRUCTURE_PROMPT
    : CREATIVE_SCRIPT_BASE_PROMPT;
  
  
  // 对于详细分镜脚本，需要更高的 max_tokens
  const extendedOptions = {
    ...options,
    maxTokens: originalShotCount > 5 ? 8192 : 4096, // 多镜头时增加输出长度
  };
  
  const response = await callChatAPI(systemPrompt, userPrompt, extendedOptions);
  
  
  return response;
}



export { CREATIVE_SCRIPT_BASE_PROMPT, PARSE_SYSTEM_PROMPT, SHOT_GENERATION_SYSTEM_PROMPT, STORYBOARD_STRUCTURE_PROMPT } from "./script-parser-prompts";
export { callChatAPI, parseScript } from "./script-parser-api";
export type { ParseOptions, ShotGenerationOptions } from "./script-parser-api";
export { generateShotList } from "./script-parser-shots";
