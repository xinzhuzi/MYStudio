import type { ModelTestProtocol } from "@/lib/api-manager/model-test";

/** 连接测试在开启深度思考时使用的输出预算：必须远高于普通 32，否则推理 token 会耗尽导致空回复。 */
export const THINKING_TEST_MAX_TOKENS = 2048;

type ThinkingProtocol = ModelTestProtocol;

export interface BuildThinkingParamsInput {
  model: string;
  protocol: ThinkingProtocol;
  /** 当前请求的 max_tokens / maxOutputTokens，用于给 Anthropic 思考预算留出回答空间。 */
  maxTokens: number;
  /**
   * 显式开关：用户在设置里为该模型配置的「思考模式」。
   * 传入时直接生效（true 强制开、false 强制关），优先于按名字的启发式判断。
   * 省略时回退到 supportsThinking(model) 的名字推断。
   */
  enabled?: boolean;
}

function normalize(model: string): string {
  return model.trim().toLowerCase();
}

const OPENAI_REASONING = /(^|[^a-z])o[1-9](-|$)|gpt-5/;
const ANTHROPIC_REASONING = /claude.*(3[._-]7|sonnet-4|opus-4|-4-)/;
const GEMINI_REASONING = /gemini-2\.5/;
const ZHIPU_REASONING = /glm-(4\.[5-9]|[5-9])|glm-z1/;
const QWEN_REASONING = /qwen3|qwq/;
const DEEPSEEK_REASONING = /deepseek-(r1|reasoner)/;
const GENERIC_REASONING = /(^|[^a-z])(r1|reasoner|reasoning|reason|thinking|think)([^a-z]|$)/;

/** 宽松匹配：模型名命中任一已知推理族或通用关键词即视为支持深度思考。 */
export function supportsThinking(model: string | undefined | null): boolean {
  if (!model) return false;
  const name = normalize(model);
  return (
    OPENAI_REASONING.test(name) ||
    ANTHROPIC_REASONING.test(name) ||
    GEMINI_REASONING.test(name) ||
    ZHIPU_REASONING.test(name) ||
    QWEN_REASONING.test(name) ||
    DEEPSEEK_REASONING.test(name) ||
    GENERIC_REASONING.test(name)
  );
}

/**
 * 解析某模型最终是否开启深度思考：显式配置（override）优先，省略时回退到按名字推断。
 * 单一事实源——测试连接与业务调用都应经此函数决定开关。
 */
export function resolveThinkingEnabled(
  model: string | undefined | null,
  override?: boolean,
): boolean {
  if (typeof override === "boolean") return override;
  return supportsThinking(model);
}

/**
 * 返回「开启最高深度思考」需要合并进请求体的参数补丁。
 * 不开启思考的模型返回 {}（等同默认不开）。
 * 同一 OpenAI 兼容端点上不同模型族使用不同字段，故按模型名再分流。
 * 当显式传入 enabled 时以其为准（用户在设置里手动标记的「思考模式」），否则按模型名推断。
 */
export function buildThinkingParams(input: BuildThinkingParamsInput): Record<string, unknown> {
  const { model, protocol, maxTokens, enabled } = input;
  const effectiveEnabled = resolveThinkingEnabled(model, enabled);
  if (!effectiveEnabled) return {};
  const name = normalize(model);
  const forced = enabled === true;

  if (protocol === "gemini-compatible") {
    // Gemini 2.5：thinkingBudget = -1 表示模型动态使用最大思考预算。
    return { generationConfig: { thinkingConfig: { thinkingBudget: -1 } } };
  }

  if (protocol === "anthropic-compatible" || ANTHROPIC_REASONING.test(name)) {
    // Anthropic：budget_tokens 必须小于 max_tokens，给回答留空间。
    const budget = Math.max(1024, Math.floor((maxTokens || THINKING_TEST_MAX_TOKENS) / 2));
    const safeBudget = Math.min(budget, Math.max(1024, (maxTokens || THINKING_TEST_MAX_TOKENS) - 512));
    return { thinking: { type: "enabled", budget_tokens: safeBudget } };
  }

  // openai-compatible 端点：按模型族分流
  if (OPENAI_REASONING.test(name)) {
    return { reasoning_effort: "high" };
  }
  if (ZHIPU_REASONING.test(name)) {
    return { thinking: { type: "enabled" } };
  }
  if (QWEN_REASONING.test(name)) {
    return { enable_thinking: true };
  }
  // 用户显式强制开启但模型族未知：用最通用的 GLM 式 thinking 开关（OpenAI 兼容中转站支持最广）。
  if (forced) {
    return { thinking: { type: "enabled" } };
  }
  // DeepSeek-R1 等（按名字推断命中）：思考为模型固有行为，无需显式参数。
  return {};
}
