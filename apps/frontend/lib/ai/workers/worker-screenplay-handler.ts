import type { AIScreenplay, GenerationConfig } from '@/lib/ai/core';
import type { GenerateScreenplayCommand, WorkerEvent } from '@/lib/ai/core/protocol';
import { buildApiUrl, decodeWorkerApiPayload, fetchWithDeadline, WorkerApiError } from './ai-worker-api';
import type { WorkerRun } from './worker-run-lifecycle';

type ScreenplayGenerationConfig = Partial<GenerationConfig> & {
  apiKey?: string;
  baseUrl?: string;
  chatProvider?: string;
  mockMode?: boolean;
};

export interface GenerateScreenplayHandlerDeps {
  beginRun: (requestedRunId?: number) => { run: WorkerRun };
  getApiBaseUrl: () => string;
  isCancelled: (run: WorkerRun) => boolean;
  postEvent: (event: WorkerEvent, run?: WorkerRun) => void;
  setApiBaseUrl: (baseUrl: string) => void;
}

export async function handleGenerateScreenplayCommand(
  command: GenerateScreenplayCommand,
  deps: GenerateScreenplayHandlerDeps,
): Promise<void> {
  const { prompt, config } = command.payload;
  const runtimeConfig = config as ScreenplayGenerationConfig;
  const { run } = deps.beginRun(command.runId);


  try {
    const mockMode = runtimeConfig.mockMode || false;

    if (runtimeConfig.baseUrl) {
      deps.setApiBaseUrl(runtimeConfig.baseUrl);
    }

    const apiKey = runtimeConfig.apiKey || '';
    const provider = runtimeConfig.chatProvider || 'memefast';
    const sceneCount = config.sceneCount || 5;


    if (!apiKey && !mockMode) {
      throw new Error('未配置 API Key，请在设置中添加或启用 Mock 模式');
    }

    const response = await fetchWithDeadline(
      buildApiUrl('/api/ai/screenplay', deps.getApiBaseUrl()),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: run.controller.signal,
        body: JSON.stringify({
          prompt,
          sceneCount,
          aspectRatio: config.aspectRatio || '9:16',
          apiKey,
          provider,
          mockMode,
        }),
      },
      180_000,
      provider,
    );

    if (!response.ok) {
      let errorMessage: string | undefined;
      try {
        const data = decodeWorkerApiPayload(await response.json().catch(() => undefined));
        errorMessage = data.errorMessage;
      } catch {}
      throw new WorkerApiError({
        code: 'http-error',
        message: errorMessage || `API request failed: ${response.status}`,
        retryable: response.status === 429 || response.status >= 500,
        status: response.status,
        provider,
      });
    }

    const rawPayload = await response.json();
 
    decodeWorkerApiPayload(rawPayload);
    const screenplay: AIScreenplay = rawPayload as AIScreenplay;
    if (deps.isCancelled(run)) return;

    deps.postEvent({
      type: 'SCREENPLAY_READY',
      payload: screenplay,
    }, run);
  } catch (error) {
    const err = error as Error;
    if (deps.isCancelled(run)) return;
    console.error('[AI Worker] Screenplay generation error:', err);
    const errorMessage = err instanceof WorkerApiError ? err.envelope.message : err.message;
    deps.postEvent({
      type: 'SCREENPLAY_ERROR',
      payload: {
        error: errorMessage,
        details: err.stack,
      },
    }, run);
  }
}
