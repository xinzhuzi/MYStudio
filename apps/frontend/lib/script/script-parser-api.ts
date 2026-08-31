import { normalizeScriptData } from "./script-data-normalizer";
import { getLanguageModel } from "@/lib/ai/ai-sdk-bridge";
import { ApiKeyManager } from "@/lib/ai/core";
import { cacheDiscoveredLimits, estimateTokens, getModelLimits, parseModelLimitsFromError } from "@/lib/ai/model-registry";
import { buildThinkingParams, buildThinkingProviderOptions, resolveThinkingEnabled } from "@/lib/ai/thinking-mode";
import { corsFetch } from "@/lib/network/cors-fetch";
import { cleanJsonString } from "@/lib/utils/json-cleaner";
import { retryOperation } from "@/lib/utils/retry";
import type { ScriptData } from "@/types/script";
import { generateText } from "ai";
import { PARSE_SYSTEM_PROMPT } from "./script-parser-prompts";

/**
 * 剧本解析 API——chat 通道/parseScript 结构化解析。file-size-reduction P2 拆出,体逐字保留。
 */
export interface ParseOptions {
  apiKey: string; // Supports comma-separated multiple keys
  provider: string;
  baseUrl: string;
  model: string;
  language?: string;
  sceneCount?: number; // 限制场景数量（用于预告片等）
  shotCount?: number; // 每场景分镜数提示（传递给后续 shot generation）
  keyManager?: ApiKeyManager; // Optional: use existing key manager for rotation
  temperature?: number; // 自定义温度，默认 0.7
  maxTokens?: number; // 自定义最大输出 token 数，默认 4096
  /** 关闭推理模型深度思考（智谱 GLM-4.7/4.5 等），避免 reasoning 耗尽 token */
  disableThinking?: boolean;
  /**
   * 用户在设置里为该模型显式配置的「思考模式」开关。
   * true 强制开、false 强制关；省略则按模型名自动判断。优先级低于 disableThinking。
   */
  thinkingEnabled?: boolean;
}

export interface ShotGenerationOptions extends ParseOptions {
  targetDuration: string;
  styleId: string;
  characterDescriptions?: Record<string, string>;
  shotCount?: number; // 限制总分镜数量（用于预告片等）
  concurrency?: number; // 并行处理场景数（默认1，多 key 时可设置更高）
}

// Use imported cleanJsonString from json-cleaner.ts

/**
 * Call chat API (Zhipu or OpenAI compatible) with multi-key rotation support
 */
export async function callChatAPI(
  systemPrompt: string,
  userPrompt: string,
  options: ParseOptions
): Promise<string> {
  const { apiKey, provider, baseUrl, model } = options;
  
  
  if (!apiKey) {
    console.error('[callChatAPI] ❌ API Key 为空！');
    throw new Error('API Key 未配置');
  }
  
  // Create or use existing key manager for rotation
  const keyManager = options.keyManager || new ApiKeyManager(apiKey);
  
  const totalKeys = keyManager.getTotalKeyCount();

  if (!baseUrl) {
    throw new Error('Base URL 未配置');
  }
  if (!model) {
    throw new Error('模型未配置');
  }
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  const url = /\/v\d+$/.test(normalizedBaseUrl)
    ? `${normalizedBaseUrl}/chat/completions`
    : `${normalizedBaseUrl}/v1/chat/completions`;
  
  // 从 Model Registry 查询模型限制（三层查找：缓存→静态→default）
  const modelLimits = getModelLimits(model);
  const requestedMaxTokens = options.maxTokens ?? 4096;
  const effectiveMaxTokens = Math.min(requestedMaxTokens, modelLimits.maxOutput);
  if (effectiveMaxTokens < requestedMaxTokens) {
  }
  
  // === Token Budget Calculator ===
  const inputTokens = estimateTokens(systemPrompt + userPrompt);
  const safetyMargin = Math.ceil(modelLimits.contextWindow * 0.1);
  const availableForOutput = modelLimits.contextWindow - inputTokens - safetyMargin;
 
  Math.round((inputTokens / modelLimits.contextWindow) * 100);
  
  
  // 输入已超过 context window 的 90% → 抛出错误（不发请求，省钱）
  if (inputTokens > modelLimits.contextWindow * 0.9) {
    const err = Object.assign(
      new Error(
        `[TokenBudget] 输入 token (≈${inputTokens}) 超出 ${model} 的 context window ` +
        `(${modelLimits.contextWindow}) 的 90%，请缩减输入或使用更大上下文的模型`
      ),
      {
        code: 'TOKEN_BUDGET_EXCEEDED' as const,
        inputTokens,
        contextWindow: modelLimits.contextWindow },
    );
    throw err;
  }
  
  // 输出空间不到请求的 50% → 打印 warning
  if (availableForOutput < requestedMaxTokens * 0.5) {
    console.warn(
      `[Dispatch] ⚠️ ${model}: 输出空间紧张！可用≈${availableForOutput} tokens，` +
      `请求=${requestedMaxTokens}，可能导致输出被截断`
    );
  }
  

  let thinkingParams: Record<string, unknown> = {};
  if (options.disableThinking) {
    thinkingParams = { thinking: { type: 'disabled' } };
  } else if (resolveThinkingEnabled(model, options.thinkingEnabled)) {
    thinkingParams = buildThinkingParams({
      model,
      protocol: 'openai-compatible',
      maxTokens: effectiveMaxTokens,
      enabled: options.thinkingEnabled });
  }

  // 优先使用 Vercel AI SDK（简化调用，跳过复杂的手写 HTTP 逻辑）
  try {
    const currentKey = keyManager.getCurrentKey();
    if (currentKey) {
      const platform = provider === 'openai' ? 'openai-compatible' : (provider || 'openai-compatible');
      const sdkModel = getLanguageModel(
        { baseUrl: normalizedBaseUrl, apiKey: currentKey, platform, name: provider || 'default' },
        model,
      );
      const result = await generateText({
        model: sdkModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: effectiveMaxTokens,
        providerOptions: buildThinkingProviderOptions('openai-compatible', model, thinkingParams) });
      if (result.text) {
        if (totalKeys > 1) keyManager.rotateKey();
        return result.text;
      }
    }
  } catch (_e) {
    // AI SDK 失败，回退到手写 HTTP（保留 token 预算、thinking、错误发现等高级逻辑）
  }

  // Use retryOperation with key rotation on rate limit
  return await retryOperation(async () => {
    // Get current key from rotation
    const currentKey = keyManager.getCurrentKey();
    if (!currentKey) {
      throw new Error('No API keys available');
    }
    

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${currentKey}` };
    
    // 模型选择逻辑：必须使用配置 model
    const modelName = model;
    
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: Record<string, any> = {
      model: modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: options.temperature ?? 0.7,
      max_tokens: effectiveMaxTokens };

    // 深度思考：显式 disableThinking 时强制关闭；否则按「显式 thinkingEnabled 配置 → 模型名自动判断」决定。
    if (options.disableThinking) {
      Object.assign(body, thinkingParams);
    } else if (Object.keys(thinkingParams).length > 0) {
      Object.assign(body, thinkingParams);
    }

    const response = await corsFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body) });

    if (!response.ok) {
      const errorText = await response.text();
      
      // Handle rate limit or auth error with key rotation
      if (keyManager.handleError(response.status, errorText)) {
      }
      
      // === Error-driven Discovery: 400 错误自动发现模型限制并重试 ===
      if (response.status === 400) {
        const discovered = parseModelLimitsFromError(errorText);
        if (discovered) {
          cacheDiscoveredLimits(model, discovered);
          
          // 如果发现了 maxOutput 限制且当前请求超出，立即用正确值重试
          if (discovered.maxOutput && effectiveMaxTokens > discovered.maxOutput) {
            const correctedMaxTokens = Math.min(requestedMaxTokens, discovered.maxOutput);
            console.warn(
              `[callChatAPI] 🧠 发现 ${model} maxOutput=${discovered.maxOutput}，` +
              `以 max_tokens=${correctedMaxTokens} 自动重试...`
            );
            const retryBody = { ...body, max_tokens: correctedMaxTokens };
            const retryResp = await corsFetch(url, {
              method: 'POST',
              headers,
              body: JSON.stringify(retryBody) });
            if (retryResp.ok) {
              const retryData = await retryResp.json();
              const retryContent = retryData.choices?.[0]?.message?.content;
              if (retryContent) {
                if (totalKeys > 1) keyManager.rotateKey();
                return retryContent;
              }
            } else {
              console.warn('[callChatAPI] 发现重试仍失败:', retryResp.status);
            }
          }
        }
      }
      
      const error = Object.assign(
        new Error(`API request failed: ${response.status} - ${errorText}`),
        { status: response.status },
      );
      throw error;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      // 诊断日志：记录 API 实际返回的结构
      const finishReason = data.choices?.[0]?.finish_reason;
      const usage = data.usage;
      const reasoningContent = data.choices?.[0]?.message?.reasoning_content;
      console.error('[callChatAPI] ⚠️ API 返回空内容！诊断信息:');
      console.error('[callChatAPI]   finish_reason:', finishReason);
      console.error('[callChatAPI]   usage:', JSON.stringify(usage));
      console.error('[callChatAPI]   choices length:', data.choices?.length);
      console.error('[callChatAPI]   message keys:', data.choices?.[0]?.message ? Object.keys(data.choices[0].message) : 'N/A');
      console.error('[callChatAPI]   reasoning_content 长度:', reasoningContent?.length || 0);
      console.error('[callChatAPI]   raw response (前500字):', JSON.stringify(data).slice(0, 500));
      
      // 智谱 API 的 sensitive 过滤：尝试轮换 key 重试
      if (finishReason === 'sensitive' || finishReason === 'content_filter') {
        if (keyManager.handleError(403)) {
          console.warn(`[callChatAPI] 内容被安全过滤(${finishReason})，轮换 key 重试`);
        }
        throw new Error(`内容被安全过滤(finish_reason: ${finishReason})`);
      }
      
      // 推理模型回退：如果有 reasoning_content 但 content 为空，说明模型耗尽 token 在思考上
      if (finishReason === 'length' && reasoningContent) {
        // 先尝试从 reasoning_content 提取 JSON（少数情况下思考中已包含结果）
        const jsonMatch = reasoningContent.match(/```json\s*([\s\S]*?)```/) ||
                          reasoningContent.match(/(\{[\s\S]*"characters"[\s\S]*\})/);
        if (jsonMatch) {
          return jsonMatch[1] || jsonMatch[0];
        }
        
        // 检测推理 token 占比 — 如果 reasoning 占了 >80% 的 completion tokens，
        // 说明模型在「思考」上花了太多预算，以双倍 max_tokens 自动重试一次
        const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens || 0;
        const completionTokens = usage?.completion_tokens || 0;
        const currentMaxTokens = body.max_tokens;
        const newMaxTokens = Math.min(currentMaxTokens * 2, modelLimits.maxOutput);
        
        if (reasoningTokens > 0 && completionTokens > 0 &&
            reasoningTokens / completionTokens > 0.8 &&
            newMaxTokens > currentMaxTokens) {
          console.warn(
            `[callChatAPI] 推理模型 token 耗尽 (reasoning: ${reasoningTokens}/${completionTokens})，` +
            `以 max_tokens=${newMaxTokens} 自动重试...`
          );
          
          const retryBody = { ...body, max_tokens: newMaxTokens };
          const retryResp = await corsFetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(retryBody) });
          
          if (retryResp.ok) {
            const retryData = await retryResp.json();
            const retryContent = retryData.choices?.[0]?.message?.content;
 
            if (retryContent) {
              if (totalKeys > 1) keyManager.rotateKey();
              return retryContent;
            }
          } else {
            console.warn('[callChatAPI] 重试请求失败:', retryResp.status);
          }
        } else {
          console.warn(
            `[callChatAPI] 推理模型 token 耗尽：reasoning ${reasoningContent.length} 字，content 为空。` +
            `(reasoning_tokens=${reasoningTokens}, completion_tokens=${completionTokens}, max_tokens=${currentMaxTokens})`
          );
        }
      }
      
      throw new Error(`Empty response from API (finish_reason: ${finishReason || 'unknown'})`);
    }

    // Rotate key after successful request to distribute load
    if (totalKeys > 1) {
      keyManager.rotateKey();
    }

    return content;
  }, { maxRetries: 3, baseDelay: 2000 });
}

/**
 * Parse screenplay text into structured data
 */
export async function parseScript(
  rawScript: string,
  options: ParseOptions
): Promise<ScriptData> {
  // 构建场景数量限制提示
  const sceneCountHint = options.sceneCount 
    ? `\n\n【重要】请仅提取最重要的 ${options.sceneCount} 个场景，挑选剧情中最具代表性和视觉冲击力的场景。`
    : '';

  const userPrompt = `请分析以下剧本/故事内容：

${rawScript}

语言：${options.language || '中文'}${sceneCountHint}`;

  const response = await callChatAPI(PARSE_SYSTEM_PROMPT, userPrompt, options);
  const cleaned = cleanJsonString(response);

  try {
    const parsed = JSON.parse(cleaned);

    return normalizeScriptData(parsed, options.language || '中文');
  } catch (e) {
    console.error('[parseScript] Failed to parse JSON:', cleaned);
    throw new Error('无法解析AI返回的剧本数据');
  }
}
