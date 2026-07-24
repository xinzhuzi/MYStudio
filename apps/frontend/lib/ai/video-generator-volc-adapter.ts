import { extractVideoUrl, normalizeUrl } from './video-response-utils';

type KeyManager = { handleError: (status: number, errorText?: string) => boolean };
type ImageRole = { url: string; role: string };

function sleepOrAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('用户已取消'));
    const tid = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(tid); reject(new Error('用户已取消')); }, { once: true });
  });
}

function throwSubmitError(status: number, errorText: string, keyManager?: KeyManager): never {
  keyManager?.handleError(status, errorText);
  let message = `视频 API 错误: ${status}`;
  try { const json = JSON.parse(errorText); message = json.error?.message || json.message || message; } catch { /* ignore */ }
  if (status === 401 || status === 403) throw new Error('API Key 无效或已过期');
  if (status === 429) { const e = new Error('API 请求过于频繁，请稍后重试') as Error & { status?: number }; e.status = 429; throw e; }
  const e = new Error(message || `上游服务暂时不可用 (${status})`) as Error & { status?: number }; e.status = status; throw e;
}

export async function callVolcVideoApi(
  apiKey: string, prompt: string, baseUrl: string, model: string, aspectRatio: string,
  imageWithRoles: ImageRole[], videoResolution?: string, duration?: number, cameraFixed?: boolean,
  onProgress?: (progress: number) => void, keyManager?: KeyManager, videoRefs?: string[], audioRefs?: string[], signal?: AbortSignal,
): Promise<string> {
  const content: Array<Record<string, unknown>> = [];
  let text = `${prompt} --rs ${(videoResolution || '720p').toLowerCase()} --rt ${aspectRatio}`;
  if (duration) text += ` --dur ${duration}`;
  if (cameraFixed !== undefined) text += ` --cf ${cameraFixed}`;
  content.push({ type: 'text', text });
  for (const img of imageWithRoles) if (img.url) content.push({ type: 'image_url', image_url: { url: img.url }, role: img.role });
  for (const url of videoRefs || []) if (url) content.push({ type: 'video_url', video_url: { url } });
  for (const url of audioRefs || []) if (url) content.push({ type: 'audio_url', audio_url: { url } });
  const response = await fetch(`${baseUrl}/volc/v1/contents/generations/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, content }) });
  if (!response.ok) throwSubmitError(response.status, await response.text(), keyManager);
  const data = await response.json();
  if (data.status === 'failed' || data.status === 'error') {
    const msg = data.message || data.error?.message || '视频提交失败（代理返回业务错误）';
    const match = msg.match(/status\s+(\d+)/); throwSubmitError(match ? Number(match[1]) : 400, JSON.stringify(data), keyManager);
  }
  const id = (data.id || data.task_id || data.request_id || data.data?.id || data.data?.task_id || data.response?.task_id || data.response?.id || data.result?.task_id || data.result?.id || data.output?.task_id || data.output?.id)?.toString();
  if (!id) throw new Error(data.message || data.error?.message || 'doubao-seedance 返回空的任务 ID（响应格式未识别，请检查控制台日志）');
  for (let attempt = 0; attempt < 180; attempt++) {
    onProgress?.(Math.min(20 + Math.floor((attempt / 180) * 80), 99));
    const statusResponse = await fetch(`${baseUrl}/volc/v1/contents/generations/tasks/${id}`, { method: 'GET', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${apiKey}` }, signal });
    if (!statusResponse.ok) { if (statusResponse.status === 404) throw new Error('任务不存在'); await sleepOrAbort(5000, signal); continue; }
    const statusData = await statusResponse.json(); const status = String(statusData.status ?? 'unknown').toLowerCase();
    if (status === 'succeeded') { const url = normalizeUrl(statusData.content?.video_url) || normalizeUrl(statusData.output?.video_url) || normalizeUrl(statusData.output?.url) || normalizeUrl(statusData.video_url) || normalizeUrl(statusData.url) || extractVideoUrl(statusData); if (!url) throw new Error('任务完成但没有视频 URL'); return url; }
    if (status === 'failed' || status === 'expired' || status === 'cancelled') { const msg = statusData.error?.message || statusData.error?.code || '视频生成失败'; throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg)); }
    await sleepOrAbort(5000, signal);
  }
  throw new Error('视频生成超时');
}
