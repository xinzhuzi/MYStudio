import { buildEndpoint } from '@/lib/ai/image-generator-helpers';
import { observedFetch } from '@/lib/diagnostics/network';
import { isRetryableHttpStatus, retryDelayMs, waitForRetry } from '@/lib/ai/retry-policy';

const TERMINAL_POLL_ERROR = Symbol('terminalPollError');
type TerminalPollError = Error & { [TERMINAL_POLL_ERROR]: true };

function markTerminalPollError(error: unknown): TerminalPollError {
  const marked = error instanceof Error ? error : new Error(String(error));
  Object.defineProperty(marked, TERMINAL_POLL_ERROR, { value: true });
  return marked as TerminalPollError;
}

function isTerminalPollError(error: unknown): error is TerminalPollError {
  return Boolean((error as Partial<Record<typeof TERMINAL_POLL_ERROR, unknown>> | undefined)?.[TERMINAL_POLL_ERROR]);
}

export async function pollTaskStatus(
  taskId: string,
  apiKey: string,
  baseUrl: string,
  onProgress?: (progress: number) => void,
  customPollUrl?: string,
  operationId?: string,
  signal?: AbortSignal,
): Promise<string> {
  const maxAttempts = 120;
  const pollInterval = 2000;
  let transientRetryAttempt = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal?.aborted) throw (signal.reason instanceof Error ? signal.reason : new Error('用户已取消'));
    const progress = Math.min(Math.floor((attempt / maxAttempts) * 100), 99);
    onProgress?.(progress);
    try {
      const rawUrl = customPollUrl || buildEndpoint(baseUrl, `images/generations/${taskId}`);
      const url = new URL(rawUrl);
      url.searchParams.set('_ts', Date.now().toString());
      const response = await observedFetch(url.toString(), {
        method: 'GET', headers: { 'Authorization': `Bearer ${apiKey}`, 'Cache-Control': 'no-cache' }, signal,
      }, { operationId, endpointFamily: 'images-generations-poll', taskId, pollAttempt: attempt + 1, maxRetries: maxAttempts });
      if (!response.ok) {
        if (response.status === 404) throw markTerminalPollError(new Error(`任务不存在或已过期(Task not found)·任务号 ${taskId}`));
        if (!isRetryableHttpStatus(response.status)) {
          throw markTerminalPollError(new Error(`查询任务状态失败(HTTP ${response.status})`));
        }
        throw new Error(`查询任务状态失败(HTTP ${response.status},将重试)`);
      }
      const data = await response.json();
      // new-api job 接口把任务对象包在 job 字段里: {"job": {"status": "...", "assets": [...]}}
      const job = (data.job ?? data.data?.job ?? data) as Record<string, unknown> | undefined;
      const status = (job?.status ?? data.status ?? data.data?.status ?? 'unknown').toString().toLowerCase();
      const statusMap: Record<string, string> = { pending: 'pending', submitted: 'pending', queued: 'pending', processing: 'processing', running: 'processing', in_progress: 'processing', completed: 'completed', succeeded: 'completed', success: 'completed', failed: 'failed', error: 'failed' };
      const mappedStatus = statusMap[status] || 'processing';
      if (mappedStatus === 'completed') {
        onProgress?.(100);
        const images = data.result?.images ?? data.data?.result?.images;
        let resultUrl: string | undefined;
        if (images?.[0]) { const urlField = images[0].url; resultUrl = Array.isArray(urlField) ? urlField[0] : urlField; }
        // job 接口完成态: assets[].proxy_url / assets[].url（CDN 短时效链接）
        const assets = Array.isArray(job?.assets) ? job.assets as Array<Record<string, unknown>> : undefined;
        const assetUrl = assets?.map((asset) => asset.proxy_url ?? asset.url).find((url): url is string => typeof url === 'string' && url.length > 0);
        resultUrl = resultUrl || assetUrl || data.output_url || data.result_url || data.url;
        if (!resultUrl) throw markTerminalPollError(new Error('任务已完成,但响应里没有图片地址'));
        return resultUrl;
      }
      if (mappedStatus === 'failed') {
        const rawError = job?.error ?? job?.message ?? data.error ?? data.error_message ?? data.data?.error;
        throw markTerminalPollError(new Error(rawError ? String(rawError) : '服务端返回任务失败,但未说明原因'));
      }
      transientRetryAttempt = 0;
      await waitForRetry(pollInterval, signal);
    } catch (error) {
      if (signal?.aborted) throw (signal.reason instanceof Error ? signal.reason : new Error('用户已取消'));
      if (isTerminalPollError(error)) throw error;
      console.error(`[ImageGenerator] Poll attempt ${attempt} failed:`, error);
      await waitForRetry(retryDelayMs(transientRetryAttempt++, pollInterval), signal);
    }
  }
  throw new Error(`图片生成超时(已轮询 ${maxAttempts} 次、约 ${Math.round(maxAttempts * pollInterval / 1000)} 秒仍未出图)`);
}
