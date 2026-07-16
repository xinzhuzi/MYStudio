import type { GenerationConfig } from '@opencut/ai-core';
import { assertImageTransferPayloadSize } from '@/lib/ai/image-transfer';

export interface WorkerApiContext {
  getApiBaseUrl: () => string;
  isCancelled: () => boolean;
}

interface TaskStatusResponse {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress?: number;
  result?: { url?: string; imageUrl?: string; videoUrl?: string };
  error?: string;
  resultUrl?: string;
}

interface SubmitResponse { taskId?: string; imageUrl?: string; videoUrl?: string; status: TaskStatusResponse['status']; }

export function buildApiUrl(path: string, apiBaseUrl = ''): string {
  if (apiBaseUrl) return `${apiBaseUrl}${path}`;
  if (typeof self !== 'undefined' && (self as any).location?.origin) return `${(self as any).location.origin}${path}`;
  return path;
}

function assertImageReady(source: string): void {
  if (/^https?:\/\//i.test(source)) return;
  if (!source.startsWith('data:image/')) throw new Error('参考图必须在主线程完成缩略后再发送');
  assertImageTransferPayloadSize(source);
}

export function createWorkerApi(context: WorkerApiContext) {
  const url = (path: string) => buildApiUrl(path, context.getApiBaseUrl());
  const pollTaskCompletion = async (taskId: string, type: 'image' | 'video', apiKey: string, provider: string, onProgress?: (progress: number) => void): Promise<string> => {
    const maxAttempts = type === 'video' ? 120 : 60;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (context.isCancelled()) throw new Error('Cancelled');
      const response = await fetch(url(`/api/ai/task/${taskId}?provider=${provider}&type=${type}`), { headers: { Authorization: `Bearer ${apiKey}` } });
      if (!response.ok) { await new Promise(r => setTimeout(r, 2000)); continue; }
      const data: TaskStatusResponse = await response.json();
      if (data.progress && onProgress) onProgress(data.progress);
      if (data.status === 'completed') {
        const result = data.result?.url || data.result?.imageUrl || data.result?.videoUrl || data.resultUrl;
        if (!result) throw new Error('Task completed but no URL in result');
        return result;
      }
      if (data.status === 'failed') throw new Error(typeof data.error === 'string' ? data.error : data.error ? JSON.stringify(data.error) : 'Task failed');
      await new Promise(r => setTimeout(r, 2000));
    }
    throw new Error(`Task ${taskId} timed out after ${(maxAttempts * 2000) / 1000}s`);
  };
  const generateImage = async (prompt: string, negativePrompt: string, config: Partial<GenerationConfig> & { apiKey?: string }, onProgress?: (progress: number) => void, referenceImages?: string[]): Promise<string> => {
    const apiKey = config.apiKey || (config as any).imageApiKey || ''; const provider = (config as any).imageProvider || 'memefast';
    if (!apiKey) throw new Error('未配置图片生成 API Key');
    for (const source of referenceImages || []) assertImageReady(source);
    const response = await fetch(url('/api/ai/image'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, negativePrompt, aspectRatio: config.aspectRatio || '9:16', apiKey, provider, referenceImages: referenceImages?.length ? referenceImages : undefined }) });
    if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.message || data.error || `Image API request failed: ${response.status}`); }
    const data: SubmitResponse = await response.json();
    if (data.imageUrl && data.status === 'completed') return data.imageUrl;
    if (data.taskId) return pollTaskCompletion(data.taskId, 'image', apiKey, provider, onProgress);
    throw new Error('Invalid API response: no taskId or imageUrl');
  };
  const generateVideo = async (imageUrl: string, prompt: string, config: Partial<GenerationConfig> & { apiKey?: string }, onProgress?: (progress: number) => void, referenceImages?: string[]): Promise<string> => {
    const apiKey = config.apiKey || (config as any).videoApiKey || ''; const provider = (config as any).videoProvider || 'memefast';
    if (!apiKey) throw new Error('未配置视频生成 API Key');
    assertImageReady(imageUrl); for (const source of referenceImages || []) assertImageReady(source);
    const response = await fetch(url('/api/ai/video'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUrl, prompt, aspectRatio: config.aspectRatio || '9:16', duration: (config as any).duration || 5, apiKey, provider, referenceImages: referenceImages?.length ? referenceImages : undefined }) });
    if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || `Video API request failed: ${response.status}`); }
    const data: SubmitResponse = await response.json();
    if (data.videoUrl && data.status === 'completed') return data.videoUrl;
    if (data.taskId) return pollTaskCompletion(data.taskId, 'video', apiKey, provider, onProgress);
    throw new Error('Invalid API response: no taskId or videoUrl');
  };
  const fetchAsBlob = async (mediaUrl: string): Promise<Blob> => { const response = await fetch(mediaUrl); if (!response.ok) throw new Error(`Failed to download: ${response.status}`); return response.blob(); };
  return { generateImage, generateVideo, fetchAsBlob, pollTaskCompletion };
}
