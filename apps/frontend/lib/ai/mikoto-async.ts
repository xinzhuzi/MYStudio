// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * mikoto 渠道专用异步生图适配器(渠道层,非任何面板私有)。
 *
 * ═══════════════ 架构定位 ═══════════════
 *
 *   lib/ai/            ← 渠道层:mikoto-async.ts 与 image-generator.ts 同层,
 *   │                     描述「怎么和某个供应商对话」,不关心谁在调用
 *   lib/assist/        ← 面板层:freedom-api.ts 等聚合多个渠道做兜底链,
 *   │                     按面板语义编排(自由面板/分镜批量/资产生成)
 *   components/…       ← 入口层:用户动作 → 选面板 API
 *
 * 本模块只做三件事,不做第四件:
 *   1. 协议:把「提示词+参考图」翻译成 mikoto 的异步任务(提交→轮询→取图)
 *   2. 付费纪律:任务被受理后的一切失败标记 ambiguousPaidRequest 上抛,
 *      由调用方(如 freedom 兜底链)决定停链;本模块不重试、不换家
 *   3. 落库回调:成图经 saveMedia 回调交还调用方,本模块不知道媒体库长什么样
 *   (不做):渠道选择、兜底顺序、provider 配置解析——那是面板层的事
 *
 * ═══════════════ 协议(实弹来源) ═══════════════
 *
 * 用户裁定 2026-08-28:mikoto 必须走异步,同步 images/chat 通道暂时关闭
 * (同步端点实证损坏:200 但响应非 JSON / 200 但响应无图,见当日诊断日志)。
 *
 * 带参考图(ma-imagegen 技能 mikoto_provider.py,工笔台账实弹):
 *   POST {base}/images/edits/async        multipart/form-data
 *     image=首图  reference=第2..N张  prompt=…  size=WxH  negative_prompt=…
 *   → 200 {"id": "…"}
 *   GET  {base}/images/tasks/{id}         (Bearer)
 *   → {"status":"completed","resultUrl":"https://…"}   status=failed 即终态
 *
 * 纯文生图(本仓 chapter_video 管线实弹):
 *   POST {base}/v1/images/generations/async  JSON {model,prompt,n,size,…}
 *   → 200 {"task_id": "…"}
 *   GET  {base}/images/tasks/{id}         (Bearer)
 *   → {"status":"completed","data":[{"url":"https://…"}]}
 *
 * 2026-08-28 深夜真 key 实弹定档(gpt-image-2,单图 125s):
 *   - 终态 status="success"(非 "completed"),中间态 "running";本实现
 *     靠「先提取结果 URL 再看失败态」的顺序兼容任意成功态措辞
 *   - 轮询地址 /images/tasks/{id} 与 /v1/images/tasks/{id} 服务端都收
 *   - 结果在 result.data[0].url;gpt-image-2 实际输出恒为 1672×941,
 *     与请求 size 无关(供应商固定档,角标按新阈值如实标 1K)
 *
 * 响应形态兼容:任务号取 id/task_id/taskId;结果取 resultUrl/result_url/
 * data[0].url/data[0].b64_json;部分实现提交即回图,直接采用。
 */

import { logEvent } from '@/lib/diagnostics/logger';
import { observedFetch } from '@/lib/diagnostics/network';
import {
  isAmbiguousPaidImageError,
  markAmbiguousPaidImageError,
} from '@/lib/ai/image-generation-errors';
import { GPT_IMAGE_SIZE_MAP, type ImageAspectRatio, type ImageResolution } from '@/lib/ai/image-size-presets';

/** 渠道入参:调用方(freedom 面板/资产链等)各自适配,结构兼容即可传入。 */
export interface MikotoAsyncParams {
  prompt: string;
  negativePrompt?: string;
  /** 画幅/分辨率档,如 "16:9"+"1K" → size "1280x720";缺省回落 1:1/1K */
  aspectRatio?: string;
  resolution?: string;
  /** data URL 形式的参考图;≥1 张走 edits/async,0 张走 generations/async */
  referenceImages?: string[];
  signal?: AbortSignal;
}

/** 渠道出参:与通用 GenerationResult 结构兼容(url 必有,任务号/媒体ID可选)。 */
export interface MikotoAsyncResult {
  url: string;
  taskId?: string;
  mediaId?: string;
}

const SUBMIT_TIMEOUT_MS = 120_000;
const POLL_REQUEST_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 3_000;
const POLL_MAX_ATTEMPTS = 100;

type TaskStatusPayload = {
  id?: unknown;
  task_id?: unknown;
  taskId?: unknown;
  status?: unknown;
  state?: unknown;
  resultUrl?: unknown;
  result_url?: unknown;
  data?: Array<{ url?: unknown; b64_json?: unknown }>;
};

function extractTaskId(data: TaskStatusPayload): string | null {
  for (const key of ['id', 'task_id', 'taskId'] as const) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function extractResultUrl(data: TaskStatusPayload): string | null {
  for (const key of ['resultUrl', 'result_url'] as const) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  const first = data.data?.[0];
  if (first && typeof first.url === 'string' && first.url.trim()) return first.url.trim();
  if (first && typeof first.b64_json === 'string' && first.b64_json) {
    return `data:image/png;base64,${first.b64_json}`;
  }
  return null;
}

function isTerminalFailureStatus(data: TaskStatusPayload): boolean {
  const status = String(data.status ?? data.state ?? '').toLowerCase();
  return ['failed', 'error', 'canceled', 'cancelled'].includes(status);
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  const mime = match[1] || 'image/png';
  try {
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
}

async function observedRequest(
  url: string,
  init: RequestInit,
  operationId: string | undefined,
  model: string,
  timeoutMs: number,
): Promise<Response> {
  return observedFetch(url, init, {
    operationId,
    endpointFamily: 'mikoto-async',
    model,
    timeoutMs,
  });
}

/**
 * 真实超时控制:observedFetch 的 timeoutMs 只是日志元数据,不掐请求。
 * 这里用 AbortController 兜住单请求时长,同时联动调用方的取消信号;
 * cancel() 由调用方在 finally 里释放定时器。
 */
function withRequestTimeout(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException('mikoto 异步请求超时', 'TimeoutError')),
    timeoutMs,
  );
  const onAbort = () => controller.abort(signal?.reason ?? new DOMException('用户已取消', 'AbortError'));
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

async function parseJsonResponse(response: Response, url: string): Promise<TaskStatusPayload> {
  const text = await response.text();
  try {
    return JSON.parse(text) as TaskStatusPayload;
  } catch {
    // 请求已发出但响应不可解析:是否已受理/计费无法证明 → 按付费纪律上抛
    throw markAmbiguousPaidImageError(
      new Error(`mikoto 异步响应非 JSON: ${url} ${text.slice(0, 120)}`),
    );
  }
}

/**
 * mikoto 异步生图入口。提交→轮询→回图;提交被受理(拿到任务号)之后的一切
 * 失败(任务 failed/轮询断链/超时)都标记 ambiguousPaidRequest——可能已计费,
 * 由调用方停链,本模块绝不自动重试。仅提交层 4xx 可证明未受理,按普通错误
 * 上抛,调用方可继续兜底链。
 */
export async function generateMikotoImageViaAsync(
  params: MikotoAsyncParams,
  model: string,
  apiKey: string,
  baseUrl: string,
  saveMedia: (url: string, prompt: string) => string | undefined,
  operationId?: string,
): Promise<MikotoAsyncResult> {
  const base = baseUrl.replace(/\/+$/, '');
  const size = GPT_IMAGE_SIZE_MAP[(params.aspectRatio || '1:1') as ImageAspectRatio]?.[(params.resolution || '1K') as ImageResolution];
  const references = params.referenceImages ?? [];
  const startedAt = Date.now();

  // ── 1. 提交:带参考图走 multipart edits/async,纯文生图走 JSON generations/async
  let submitUrl: string;
  let init: RequestInit;
  if (references.length > 0) {
    const form = new FormData();
    const untransferable: string[] = [];
    references.forEach((reference, index) => {
      const blob = dataUrlToBlob(reference);
      if (!blob) {
        untransferable.push(`#${index + 1}`);
        return;
      }
      form.append(index === 0 ? 'image' : 'reference', blob, index === 0 ? 'source.png' : `reference-${index}.png`);
    });
    if (untransferable.length > 0) {
      // 请求未发出,零计费风险:普通错误,调用方可走兜底链
      throw new Error(`参考图[${untransferable.join('、')}]不是可传输的 data URL,无法进入 mikoto 异步通道`);
    }
    form.append('prompt', params.prompt);
    if (size) form.append('size', size);
    if (params.negativePrompt) form.append('negative_prompt', params.negativePrompt);
    submitUrl = `${base}/images/edits/async`;
    init = { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: params.signal };
  } else {
    submitUrl = `${base}/v1/images/generations/async`;
    init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        prompt: params.prompt,
        n: 1,
        ...(size ? { size } : {}),
        ...(params.negativePrompt ? { negative_prompt: params.negativePrompt } : {}),
      }),
      signal: params.signal,
    };
  }

  // 提交请求:真实超时控制(120s);传输层失败/超时都无法证明服务端未受理
  const submitTimeout = withRequestTimeout(params.signal, SUBMIT_TIMEOUT_MS);
  let submitResponse: Response;
  try {
    submitResponse = await observedRequest(submitUrl, { ...init, signal: submitTimeout.signal }, operationId, model, SUBMIT_TIMEOUT_MS);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw markAmbiguousPaidImageError(error instanceof Error ? error : new Error(String(error)));
  } finally {
    submitTimeout.cancel();
  }
  if (!submitResponse.ok) {
    const errorText = await submitResponse.text().catch(() => '');
    if (submitResponse.status >= 500) {
      // 5xx:网关侧拒绝,但上游是否已受理无法证明 → 结果不确定
      throw markAmbiguousPaidImageError(
        new Error(`mikoto 异步提交失败: ${submitResponse.status} ${errorText.slice(0, 120)}`),
      );
    }
    // 4xx:确定性拒绝(鉴权/参数),可证明未计费
    throw new Error(`mikoto 异步提交失败: ${submitResponse.status} ${errorText.slice(0, 160)}`);
  }
  const submitted = await parseJsonResponse(submitResponse, submitUrl);

  // 部分实现提交即同步回图
  const directUrl = extractResultUrl(submitted);
  if (directUrl) {
    void logEvent({
      level: 'info',
      category: 'ai',
      operationId,
      message: 'mikoto async submit returned image directly',
      context: { model, references: references.length, baseUrl: base, durationMs: Date.now() - startedAt },
    });
    return { url: directUrl, mediaId: saveMedia(directUrl, params.prompt) };
  }
  const taskId = extractTaskId(submitted);
  if (!taskId) {
    throw markAmbiguousPaidImageError(
      new Error(`mikoto 异步提交响应缺少任务 ID: ${JSON.stringify(submitted).slice(0, 200)}`),
    );
  }
  void logEvent({
    level: 'info',
    category: 'ai',
    operationId,
    message: 'mikoto async task accepted',
    context: { model, taskId, references: references.length, submitMs: Date.now() - startedAt },
  });

  // ── 2. 轮询:任务已被受理,此后失败一律 ambiguous(可能已计费)
  const pollUrl = `${base}/images/tasks/${encodeURIComponent(taskId)}`;
  const pollDeadlineMs = POLL_INTERVAL_MS * POLL_MAX_ATTEMPTS;
  try {
    for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      // 单次轮询失败不杀任务(任务仍在服务端跑),下一轮再查;用户取消例外
      const pollTimeout = withRequestTimeout(params.signal, POLL_REQUEST_TIMEOUT_MS);
      let pollResponse: Response | null = null;
      try {
        pollResponse = await observedRequest(pollUrl, {
          method: 'GET',
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: pollTimeout.signal,
        }, operationId, model, POLL_REQUEST_TIMEOUT_MS);
      } catch (error) {
        if (params.signal?.aborted) throw error;
        continue;
      } finally {
        pollTimeout.cancel();
      }
      if (!pollResponse.ok) continue;
      const payload = await parseJsonResponse(pollResponse, pollUrl);
      if (isTerminalFailureStatus(payload)) {
        void logEvent({
          level: 'warn',
          category: 'ai',
          operationId,
          message: 'mikoto async task failed',
          context: { model, taskId, attempt, payload: JSON.stringify(payload).slice(0, 200) },
        });
        throw new Error(`mikoto 异步任务失败: ${JSON.stringify(payload).slice(0, 200)}`);
      }
      const resultUrl = extractResultUrl(payload);
      if (resultUrl) {
        void logEvent({
          level: 'info',
          category: 'ai',
          operationId,
          message: 'mikoto async task completed',
          context: { model, taskId, attempt, durationMs: Date.now() - startedAt },
        });
        return { url: resultUrl, taskId, mediaId: saveMedia(resultUrl, params.prompt) };
      }
    }
    void logEvent({
      level: 'warn',
      category: 'ai',
      operationId,
      message: 'mikoto async task timeout',
      context: { model, taskId, pollDeadlineMs },
    });
    throw markAmbiguousPaidImageError(
      new Error(`mikoto 异步任务超时(${Math.round(pollDeadlineMs / 1000)}s): ${taskId}`),
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    if (isAmbiguousPaidImageError(error)) throw error;
    throw markAmbiguousPaidImageError(error instanceof Error ? error : new Error(String(error)));
  }
}
