import { buildEndpoint } from '@/lib/ai/image-generator-helpers';
import { observedFetch } from '@/lib/diagnostics/network';

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
        if (response.status === 404) throw markTerminalPollError(new Error('Task not found'));
        throw new Error(`Failed to check task status: ${response.status}`);
      }
      const data = await response.json();
      console.log(`[ImageGenerator] Task ${taskId} status:`, data);
      const status = (data.status ?? data.data?.status ?? 'unknown').toString().toLowerCase();
      const statusMap: Record<string, string> = { pending: 'pending', submitted: 'pending', queued: 'pending', processing: 'processing', running: 'processing', in_progress: 'processing', completed: 'completed', succeeded: 'completed', success: 'completed', failed: 'failed', error: 'failed' };
      const mappedStatus = statusMap[status] || 'processing';
      if (mappedStatus === 'completed') {
        onProgress?.(100);
        const images = data.result?.images ?? data.data?.result?.images;
        let resultUrl: string | undefined;
        if (images?.[0]) { const urlField = images[0].url; resultUrl = Array.isArray(urlField) ? urlField[0] : urlField; }
        resultUrl = resultUrl || data.output_url || data.result_url || data.url;
        if (!resultUrl) throw markTerminalPollError(new Error('Task completed but no URL in result'));
        return resultUrl;
      }
      if (mappedStatus === 'failed') {
        const rawError = data.error || data.error_message || data.data?.error;
        throw markTerminalPollError(new Error(rawError ? String(rawError) : 'Task failed'));
      }
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    } catch (error) {
      if (signal?.aborted) throw (signal.reason instanceof Error ? signal.reason : new Error('用户已取消'));
      if (isTerminalPollError(error)) throw error;
      console.error(`[ImageGenerator] Poll attempt ${attempt} failed:`, error);
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }
  throw new Error('图片生成超时');
}
