/**
 * AI worker 视频批处理命令族——handleExecuteScreenplayVideos(内含 generateSceneImageOnly)。
 * 深网专批矩阵驱动:独占 ~430 行,体逐字保留;共享态经 ctx 注入。
 */
import type { ExecuteScreenplayVideosCommand, WorkerEvent } from '@/lib/ai/core/protocol';
import { sleep } from './ai-worker';
import { PromptCompiler } from '@/lib/ai/core/services/prompt-compiler';

const promptCompiler = new PromptCompiler();
import type { AIScene, GenerationConfig, CharacterBibleLike, AICharacter } from '@/lib/ai/core';
import { createWorkerApi } from './ai-worker-api';
import type { WorkerRun } from './worker-run-lifecycle';

type WorkerApi = ReturnType<typeof createWorkerApi>;

export type SceneVideosCtx = {
  isCancelled: (run: WorkerRun) => boolean;
  beginRun: (runId?: number) => { run: WorkerRun; api: WorkerApi };
  postEvent: (event: WorkerEvent, run?: WorkerRun, explicitRunId?: number) => void;
  setApiBaseUrl: (url: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reportSceneProgress: (run: WorkerRun, screenplayId: string, sceneId: number, status: any, stage: any, progress: number) => void;
  reportSceneFailed: (run: WorkerRun, screenplayId: string, sceneId: number, message: string, retryable: boolean) => void;
  getBibleCharacters: (bible?: CharacterBibleLike | string, fallback?: AICharacter[]) => AICharacter[];
};

export async function handleExecuteScreenplayVideos(
  command: ExecuteScreenplayVideosCommand,
  ctx: SceneVideosCtx,
): Promise<void> {
  const { beginRun, isCancelled, postEvent, setApiBaseUrl, reportSceneFailed, reportSceneProgress, getBibleCharacters } = ctx;
  const { screenplay, config } = command.payload;
  const { run, api } = beginRun(command.runId);

  
  // Debug: Log each scene's imageUrl
 
  for (const _scene of screenplay.scenes) {
  }
  
  // Set baseUrl if provided
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((config as any).baseUrl) {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    setApiBaseUrl((config as any).baseUrl);
  }
  
  // Check for mock mode
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockVideo = (config as any).mockVideo || false;
  
  // Get API keys from config
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiKeys = (config as any).apiKeys || {};
  const concurrency = config.concurrency || 1;
  
  // Get character reference images from config
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const characterReferenceImages = (config as any).characterReferenceImages || [];
  
  // Prepare extended config with API keys
  const extendedConfig = {
    ...config,
    apiKey: apiKeys.memefast || '',
    videoApiKey: apiKeys.memefast || '',
    mockVideo,
    characterReferenceImages,
  };
  
  // Execute video generation for all scenes
  const scenes = screenplay.scenes;
  let completedCount = 0;
  let failedCount = 0;
  
  // Process scenes in batches
  for (let i = 0; i < scenes.length; i += concurrency) {
    if (isCancelled(run)) {
      break;
    }
    
    const batch = scenes.slice(i, i + concurrency);
    
    // Execute batch in parallel
    await Promise.allSettled(
      batch.map(async (scene) => {
        try {
          // Scene must have imageUrl from Step 1
          if (!scene.imageUrl) {
            throw new Error(`Scene ${scene.sceneId} has no image, cannot generate video`);
          }
          await generateSceneVideoOnly(run, api, screenplay.id, scene, extendedConfig, screenplay.characterBible, characterReferenceImages, { isCancelled, reportSceneFailed, reportSceneProgress, getBibleCharacters, postEvent });
          completedCount++;
        } catch (error) {
          failedCount++;
          const err = error as Error;
          console.error(`[AI Worker] Scene ${scene.sceneId} video failed:`, err.message);
        }
      })
    );
  }
  
  // Report all scenes completed
  postEvent({
    type: 'ALL_SCENES_COMPLETED',
    payload: {
      screenplayId: screenplay.id,
      completedCount,
      failedCount,
      totalCount: scenes.length,
    },
  }, run);
  
}

/**
 * Generate image only for a scene (used in two-step flow)
 */
export async function generateSceneImageOnly(
  run: WorkerRun,
  api: WorkerApi,
  screenplayId: string,
  scene: AIScene,
  config: GenerationConfig & { mockImage?: boolean },
  characterBible?: CharacterBibleLike | string,
  characterReferenceImages?: string[]
,
  deps?: Pick<SceneVideosCtx, "isCancelled" | "reportSceneFailed" | "reportSceneProgress" | "getBibleCharacters" | "postEvent">,
): Promise<void> {
  const _d = deps ?? { isCancelled: () => false, reportSceneFailed: () => {} } as unknown as Pick<SceneVideosCtx, "isCancelled" | "reportSceneFailed" | "reportSceneProgress" | "getBibleCharacters" | "postEvent">;
  const { isCancelled, reportSceneFailed, reportSceneProgress, getBibleCharacters, postEvent } = _d;
  
  // Check cancellation
  if (isCancelled(run)) {
    reportSceneFailed(run, screenplayId, scene.sceneId, 'Cancelled', false);
    throw new Error('Cancelled');
  }
  
  // Report progress: starting image generation
  reportSceneProgress(run, screenplayId, scene.sceneId, 'generating', 'image', 0);
  
  // Mock mode check
  if (config.mockImage) {
    
    // Simulate progress
    for (let p = 0; p <= 100; p += 25) {
      if (isCancelled(run)) throw new Error('Cancelled');
      await sleep(200);
      reportSceneProgress(run, screenplayId, scene.sceneId, 'generating', 'image', p / 2);
    }
    
    const mockImageUrl = `https://picsum.photos/seed/${scene.sceneId}/1280/720`;
    
    // Report image completed
    postEvent({
      type: 'SCENE_IMAGE_COMPLETED',
      payload: {
        screenplayId,
        sceneId: scene.sceneId,
        imageUrl: mockImageUrl,
      },
    }, run);
    
    return;
  }
  
  try {
    // Extract characters from bible for consistency
    const characters = getBibleCharacters(characterBible);
    
    // Get character reference images
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const refImages = characterReferenceImages || (config as any).characterReferenceImages || [];
    
    // Compile image prompt
    const imagePrompt = promptCompiler.compileSceneImagePrompt(
      scene,
      characters,
      config
    );
    const negativePrompt = promptCompiler.getNegativePrompt();
    
    
    // Generate image with progress tracking
    const imageUrl = await api.generateImage(
      imagePrompt,
      negativePrompt,
      config,
      (progress) => {
        reportSceneProgress(run, screenplayId, scene.sceneId, 'generating', 'image', Math.floor(progress * 0.5));
      },
      refImages
    );
    
    
    // Report image completed
    postEvent({
      type: 'SCENE_IMAGE_COMPLETED',
      payload: {
        screenplayId,
        sceneId: scene.sceneId,
        imageUrl,
      },
    }, run);
    
  } catch (error) {
    const err = error as Error;
    const isCancelled = err.message === 'Cancelled';
    console.error(`[AI Worker] Scene ${scene.sceneId} image failed:`, err);
    reportSceneFailed(run, screenplayId, scene.sceneId, err.message, !isCancelled);
    throw error;
  }
}

/**
 * Generate video only for a scene (used in two-step flow)
 */
export async function generateSceneVideoOnly(
  run: WorkerRun,
  api: WorkerApi,
  screenplayId: string,
  scene: AIScene,
  config: GenerationConfig & { mockVideo?: boolean },
  characterBible?: CharacterBibleLike | string,
  characterReferenceImages?: string[]
,
  deps?: Pick<SceneVideosCtx, "isCancelled" | "reportSceneFailed" | "reportSceneProgress" | "getBibleCharacters" | "postEvent">,
): Promise<void> {
  const _d = deps ?? { isCancelled: () => false, reportSceneFailed: () => {}, reportSceneProgress: () => {}, postEvent: () => {} } as unknown as Pick<SceneVideosCtx, "isCancelled" | "reportSceneFailed" | "reportSceneProgress" | "getBibleCharacters" | "postEvent">;
  const { isCancelled, reportSceneFailed, reportSceneProgress, postEvent, getBibleCharacters } = _d;
  
  // Check cancellation
  if (isCancelled(run)) {
    reportSceneFailed(run, screenplayId, scene.sceneId, 'Cancelled', false);
    throw new Error('Cancelled');
  }
  
  // Report progress: starting video generation
  reportSceneProgress(run, screenplayId, scene.sceneId, 'generating', 'video', 50);
  
  // Mock mode check
  if (config.mockVideo) {
    
    // Simulate progress
    for (let p = 50; p <= 100; p += 10) {
      if (isCancelled(run)) throw new Error('Cancelled');
      await sleep(200);
      reportSceneProgress(run, screenplayId, scene.sceneId, 'generating', 'video', p);
    }
    
    // Create a mock video blob
    const mockBlob = new Blob(['mock video data'], { type: 'video/mp4' });
    
    reportSceneProgress(run, screenplayId, scene.sceneId, 'completed', 'done', 100);
    
    postEvent({
      type: 'SCENE_COMPLETED',
      payload: {
        screenplayId,
        sceneId: scene.sceneId,
        mediaBlob: mockBlob,
        metadata: {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
          duration: (config as any).duration || 5,
          width: config.aspectRatio === '9:16' ? 720 : 1280,
          height: config.aspectRatio === '9:16' ? 1280 : 720,
          mimeType: 'video/mp4',
        },
      },
    }, run);
    
    return;
  }
  
  try {
    // Extract characters from bible for consistency
    const characters = getBibleCharacters(characterBible);
    
    // Get character reference images
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const refImages = characterReferenceImages || (config as any).characterReferenceImages || [];
    
    // Compile video prompt
    const videoPrompt = promptCompiler.compileSceneVideoPrompt(scene, characters);
    
    
    // Generate video with progress tracking
    const videoUrl = await api.generateVideo(
      scene.imageUrl!,
      videoPrompt,
      config,
      (progress) => {
        const mappedProgress = 50 + Math.floor(progress * 0.45);
        reportSceneProgress(run, screenplayId, scene.sceneId, 'generating', 'video', mappedProgress);
      },
      refImages
    );
    
    
    // Download and create blob
    reportSceneProgress(run, screenplayId, scene.sceneId, 'generating', 'video', 95);
    const videoBlob = await api.fetchAsBlob(videoUrl);
    
    // Complete
    reportSceneProgress(run, screenplayId, scene.sceneId, 'completed', 'done', 100);
    
    postEvent({
      type: 'SCENE_COMPLETED',
      payload: {
        screenplayId,
        sceneId: scene.sceneId,
        mediaBlob: videoBlob,
        metadata: {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
          duration: (config as any).duration || 5,
          width: config.aspectRatio === '9:16' ? 720 : 1280,
          height: config.aspectRatio === '9:16' ? 1280 : 720,
          mimeType: 'video/mp4',
        },
      },
    }, run);
    
  } catch (error) {
    const err = error as Error;
    const isCancelled = err.message === 'Cancelled';
    console.error(`[AI Worker] Scene ${scene.sceneId} video failed:`, err);
    reportSceneFailed(run, screenplayId, scene.sceneId, err.message, !isCancelled);
    throw error;
  }
}

/**
 * Internal scene execution (used by both EXECUTE_SCENE and EXECUTE_SCREENPLAY)
 */
export async function executeSceneInternal(
  run: WorkerRun,
  api: WorkerApi,
  screenplayId: string,
  scene: AIScene,
  config: GenerationConfig & { mockImage?: boolean; mockVideo?: boolean },
  characterBible?: CharacterBibleLike | string,
  characterReferenceImages?: string[],
  deps?: Pick<SceneVideosCtx, "isCancelled" | "reportSceneFailed" | "reportSceneProgress" | "getBibleCharacters" | "postEvent">,
): Promise<void> {
  const { isCancelled, reportSceneFailed, reportSceneProgress, getBibleCharacters, postEvent } = deps ?? {} as never;
  
  // Check cancellation
  if (isCancelled(run)) {
    reportSceneFailed(run, screenplayId, scene.sceneId, 'Cancelled', false);
    throw new Error('Cancelled');
  }
  
  // Report progress: starting image generation
  reportSceneProgress(run, screenplayId, scene.sceneId, 'generating', 'image', 0);
  
  // Mock mode check
  if (config.mockImage && config.mockVideo) {
    
    // Simulate progress
    for (let p = 0; p <= 100; p += 20) {
      if (isCancelled(run)) throw new Error('Cancelled');
      await sleep(300);
      const stage = p < 50 ? 'image' : 'video';
      reportSceneProgress(run, screenplayId, scene.sceneId, 'generating', stage, p);
    }
    
    // Create a mock video blob
    const mockBlob = new Blob(['mock video data'], { type: 'video/mp4' });
    
    reportSceneProgress(run, screenplayId, scene.sceneId, 'completed', 'done', 100);
    
    postEvent({
      type: 'SCENE_COMPLETED',
      payload: {
        screenplayId,
        sceneId: scene.sceneId,
        mediaBlob: mockBlob,
        metadata: {
          duration: config.duration || 5,
          width: config.aspectRatio === '9:16' ? 720 : 1280,
          height: config.aspectRatio === '9:16' ? 1280 : 720,
          mimeType: 'video/mp4',
        },
      },
    }, run);
    
    return;
  }
  
  try {
    // Extract characters from bible for consistency
    const characters = getBibleCharacters(characterBible);
    
    // Get character reference images
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const refImages = characterReferenceImages || (config as any).characterReferenceImages || [];
    
    // ========== Stage 1: Image Generation ==========
    const imagePrompt = promptCompiler.compileSceneImagePrompt(
      scene,
      characters,
      config
    );
    const negativePrompt = promptCompiler.getNegativePrompt();
    
    
    // Generate image with progress tracking
    // Pass character reference images for visual consistency
    const imageUrl = await api.generateImage(
      imagePrompt,
      negativePrompt,
      config,
      (progress) => {
        const mappedProgress = Math.floor(progress * 0.45);
        reportSceneProgress(run, screenplayId, scene.sceneId, 'generating', 'image', mappedProgress);
      },
      refImages
    );
    
    reportSceneProgress(run, screenplayId, scene.sceneId, 'generating', 'image', 45);
    
    // ========== Stage 2: Video Generation ==========
    const videoPrompt = promptCompiler.compileSceneVideoPrompt(scene, characters);
    
    reportSceneProgress(run, screenplayId, scene.sceneId, 'generating', 'video', 50);
    
    // Generate video with progress tracking
    // Pass character reference images for visual consistency in video
    const videoUrl = await api.generateVideo(
      imageUrl,
      videoPrompt,
      config,
      (progress) => {
        const mappedProgress = 50 + Math.floor(progress * 0.45);
        reportSceneProgress(run, screenplayId, scene.sceneId, 'generating', 'video', mappedProgress);
      },
      refImages
    );
    
    
    // ========== Stage 3: Download and Create Blob ==========
    reportSceneProgress(run, screenplayId, scene.sceneId, 'generating', 'video', 95);
    
    // Download the video as blob
    const videoBlob = await api.fetchAsBlob(videoUrl);
    
    // ========== Complete ==========
    reportSceneProgress(run, screenplayId, scene.sceneId, 'completed', 'done', 100);
    
    postEvent({
      type: 'SCENE_COMPLETED',
      payload: {
        screenplayId,
        sceneId: scene.sceneId,
        mediaBlob: videoBlob,
        metadata: {
          duration: config.duration || 5,
          width: config.aspectRatio === '9:16' ? 720 : 1280,
          height: config.aspectRatio === '9:16' ? 1280 : 720,
          mimeType: 'video/mp4',
        },
      },
    }, run);
    
  } catch (error) {
    const err = error as Error;
    const isCancelled = err.message === 'Cancelled';
    console.error(`[AI Worker] Scene ${scene.sceneId} failed:`, err);
    reportSceneFailed(run, screenplayId, scene.sceneId, err.message, !isCancelled);
    throw error;
  }
}
