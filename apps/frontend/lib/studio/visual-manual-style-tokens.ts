/**
 * 视觉手册分镜帧风格锁 — 手册驱动加载器。
 *
 * 唯一真相源是所选视觉手册的 art_prompt/art_storyboard_video.md 标记块:
 *   <!-- storyboard-image-style-tokens:start --> ... <!-- storyboard-image-style-tokens:end -->（每行一个 token）
 *   <!-- storyboard-style-guide:start --> ... <!-- storyboard-style-guide:end -->（AI 系统提示词指南）
 * 代码不写死任何 token —— 与 depth-friendly-prompt.ts 同一模式:
 * 标记块缺失时不注入任何内容（fail-empty，不回退硬编码）。
 *
 * 当前仅道劫（daojie_ink_guofeng）手册提供标记块；其他风格原样返回。
 * 分镜帧提示词由无风格约束的 LLM 产出，可能携带 cinematic/景深虚化类词——
 * 道劫路径先过 sanitizeDaojiePrompt 再幂等追加 token，与资产润色链路口径一致。
 */

import { sanitizeDaojiePrompt } from "@/lib/ai/prompt-polisher";
import { DAOJIE_VISUAL_MANUAL_ID } from "@/lib/studio/visual-manual-classification";
import { useStudioStore } from "@/stores/studio/studio-store";

const manualModules = import.meta.glob(
  "../../assets/studio-manuals/art_skills/daojie_ink_guofeng/art_prompt/art_storyboard_video.md",
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

const manualContent = Object.values(manualModules)[0] ?? "";

function parseMarkerBlock(content: string, name: string): string {
  const match = content.match(
    new RegExp(`<!-- ${name}:start -->\\n?([\\s\\S]*?)<!-- ${name}:end -->`),
  );
  return match?.[1]?.trim() ?? "";
}

/** 手册解析出的分镜帧生图风格 token 列表（每行一个；标记块缺失时为空数组）。 */
export const DAOJIE_STORYBOARD_STYLE_TOKENS: readonly string[] = parseMarkerBlock(
  manualContent,
  "storyboard-image-style-tokens",
)
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.length > 0);

const DAOJIE_STORYBOARD_STYLE_TOKENS_SUFFIX = DAOJIE_STORYBOARD_STYLE_TOKENS.join(", ");

/** 道劫分镜帧风格指南（注入分镜提示词撰写 LLM 的 system；标记块缺失为空字符串 → 不注入）。 */
export function getDaojieStoryboardStyleGuide(): string {
  const guide = parseMarkerBlock(manualContent, "storyboard-style-guide");
  return guide ? `\n${guide}\n` : "";
}

export function isDaojieVisualManual(visualManualId: string | undefined | null): boolean {
  return visualManualId === DAOJIE_VISUAL_MANUAL_ID;
}

/**
 * 给分镜帧生图 prompt 施加所选视觉手册的风格锁。
 * 道劫：先 sanitize 再幂等追加风格 token；其他风格或未选择：原样返回。
 */
export function withVisualManualStoryboardStyleTokens(
  prompt: string,
  visualManualId: string | undefined | null,
): string {
  const base = prompt.trim();
  if (!base || !isDaojieVisualManual(visualManualId)) return base;
  if (!DAOJIE_STORYBOARD_STYLE_TOKENS_SUFFIX) return base;
  const sanitized = sanitizeDaojiePrompt(base);
  const firstToken = DAOJIE_STORYBOARD_STYLE_TOKENS[0];
  if (firstToken && sanitized.includes(firstToken)) return sanitized;
  return `${sanitized}, ${DAOJIE_STORYBOARD_STYLE_TOKENS_SUFFIX}`;
}

/** 同 withVisualManualStoryboardStyleTokens，visualManualId 取当前 studio 项目工作流配置（非 React 上下文使用）。 */
export function withActiveVisualManualStoryboardStyleTokens(prompt: string): string {
  const visualManualId = useStudioStore.getState().workflowConfig.visualManualId;
  return withVisualManualStoryboardStyleTokens(prompt, visualManualId);
}

/** 当前手册为道劫时返回分镜帧风格指南，否则返回空字符串。 */
export function getActiveVisualManualStoryboardStyleGuide(): string {
  const visualManualId = useStudioStore.getState().workflowConfig.visualManualId;
  return isDaojieVisualManual(visualManualId) ? getDaojieStoryboardStyleGuide() : "";
}
