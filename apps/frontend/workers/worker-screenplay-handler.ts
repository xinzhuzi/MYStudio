import type { AIScreenplay, GenerationConfig } from '@opencut/ai-core';
import type { GenerateScreenplayCommand, WorkerEvent } from '@opencut/ai-core/protocol';
import { buildApiUrl } from './ai-worker-api';
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

  console.log('[AI Worker] Generating screenplay for prompt:', prompt.substring(0, 100));
  console.log('[AI Worker] Config received:', JSON.stringify(config, null, 2));

  try {
    const mockMode = runtimeConfig.mockMode || false;

    if (runtimeConfig.baseUrl) {
      deps.setApiBaseUrl(runtimeConfig.baseUrl);
    }

    const apiKey = runtimeConfig.apiKey || '';
    const provider = runtimeConfig.chatProvider || 'memefast';
    const sceneCount = config.sceneCount || 5;

    console.log('[AI Worker] Using sceneCount:', sceneCount);

    if (!apiKey && !mockMode) {
      throw new Error('未配置 API Key，请在设置中添加或启用 Mock 模式');
    }

    const response = await fetch(buildApiUrl('/api/ai/screenplay', deps.getApiBaseUrl()), {
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
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMsg = errorData.message || errorData.error || `API request failed: ${response.status}`;
      console.error('[AI Worker] Screenplay API error:', response.status, errorData);
      throw new Error(errorMsg);
    }

    const screenplay: AIScreenplay = await response.json();
    if (deps.isCancelled(run)) return;

    deps.postEvent({
      type: 'SCREENPLAY_READY',
      payload: screenplay,
    }, run);
  } catch (error) {
    const err = error as Error;
    if (deps.isCancelled(run)) return;
    console.error('[AI Worker] Screenplay generation error:', err);
    deps.postEvent({
      type: 'SCREENPLAY_ERROR',
      payload: {
        error: err.message,
        details: err.stack,
      },
    }, run);
  }
}
