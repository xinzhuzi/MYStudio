// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * AI Worker
 * Background worker for AI generation tasks
 * Handles screenplay generation, image/video creation, and media processing
 */

import type { 
  WorkerCommand, 
  WorkerEvent,
  PingCommand,
  GenerateScreenplayCommand,
  ExecuteScreenplayCommand,
  ExecuteScreenplayImagesCommand,
  ExecuteScreenplayVideosCommand,
  ExecuteSceneCommand,
  CancelCommand,
} from '@opencut/ai-core/protocol';
import type { AIScene, GenerationConfig, AICharacter, CharacterBibleLike } from '@opencut/ai-core';
import { PromptCompiler } from '@opencut/ai-core/services/prompt-compiler';
import { TaskPoller } from '@opencut/ai-core/api/task-poller';
import { createWorkerApi } from './ai-worker-api';
import { createWorkerRunLifecycle, type WorkerRun } from './worker-run-lifecycle';
import { createWorkerSceneEventReporter } from './worker-scene-events';
import { handleGenerateScreenplayCommand } from './worker-screenplay-handler';

const WORKER_VERSION = '0.3.1';

// Base URL for API requests (passed from main thread)
let apiBaseUrl = '';

// Prompt compiler instance
const promptCompiler = new PromptCompiler();

// Task poller for async operations
const taskPoller = new TaskPoller();


function getBibleCharacters(characterBible?: CharacterBibleLike | string, fallback: AICharacter[] = []): AICharacter[] {
  if (!characterBible || typeof characterBible === 'string') {
    return fallback;
  }
  return Array.isArray(characterBible.characters) ? characterBible.characters : fallback;
}

// ==================== State ====================

const workerRuns = createWorkerRunLifecycle();
const legacyWorkerApi = createWorkerApi({ getApiBaseUrl: () => apiBaseUrl, isCancelled: () => false });
// Legacy helper bodies below are retained as private compatibility scaffolding;
// route their polling call through the extracted API client so they cannot drift.
const pollTaskCompletion = legacyWorkerApi.pollTaskCompletion;

// Kept only for backwards-compatible local references in legacy dead code.
const assertImageReadyForNetwork = (_source: string): void => undefined;
const assertImagesReadyForNetwork = (_sources?: string[]): void => undefined;

type WorkerApi = ReturnType<typeof createWorkerApi>;

function beginRun(requestedRunId?: number): { run: WorkerRun; api: WorkerApi } {
  const run = workerRuns.begin(requestedRunId);
  return {
    run,
    api: createWorkerApi({
      getApiBaseUrl: () => apiBaseUrl,
      isCancelled: () => !workerRuns.isCurrent(run),
      signal: run.controller.signal,
    }),
  };
}

function isCancelled(run: WorkerRun): boolean {
  return !workerRuns.isCurrent(run);
}

// ==================== Message Handler ====================

self.onmessage = async (e: MessageEvent<WorkerCommand>) => {
  const command = e.data;
  
  try {
    switch (command.type) {
      case 'PING':
        handlePing(command);
        break;
        
      case 'GENERATE_SCREENPLAY':
        await handleGenerateScreenplay(command);
        break;
        
      case 'EXECUTE_SCENE':
        await handleExecuteScene(command);
        break;
        
      case 'EXECUTE_SCREENPLAY':
        await handleExecuteScreenplay(command);
        break;
        
      case 'EXECUTE_SCREENPLAY_IMAGES':
        await handleExecuteScreenplayImages(command);
        break;
        
      case 'EXECUTE_SCREENPLAY_VIDEOS':
        await handleExecuteScreenplayVideos(command);
        break;
        
      case 'CANCEL':
        handleCancel(command);
        break;
        
      default:
        console.warn('[AI Worker] Unknown command type:', (command as WorkerCommand).type);
    }
  } catch (error) {
    const err = error as Error;
    const runId = 'runId' in command ? command.runId : undefined;
    postEvent({
      type: 'WORKER_ERROR',
      payload: {
        message: err.message,
        stack: err.stack,
      },
    }, undefined, runId);
  }
};

// ==================== Command Handlers ====================

function handlePing(command: PingCommand): void {
  postEvent({
    type: 'PONG',
    payload: {
      timestamp: command.payload.timestamp,
      workerTimestamp: Date.now(),
    },
  });
}

async function handleGenerateScreenplay(command: GenerateScreenplayCommand): Promise<void> {
  return handleGenerateScreenplayCommand(command, {
    beginRun,
    getApiBaseUrl: () => apiBaseUrl,
    isCancelled,
    postEvent,
    setApiBaseUrl: (baseUrl) => {
      apiBaseUrl = baseUrl;
    },
  });
}

/**
 * Helper: Generate image via API
 * Returns image URL after polling for completion
 * @param referenceImages - Character reference images (base64 or URL) for consistency
 */
async function legacyGenerateImage(
  prompt: string,
  negativePrompt: string,
  config: Partial<GenerationConfig> & { apiKey?: string },
  onProgress?: (progress: number) => void,
  referenceImages?: string[]
): Promise<string> {
  return legacyWorkerApi.generateImage(prompt, negativePrompt, config, onProgress, referenceImages);
}

/**
 * Helper: Generate video via API
 * Returns video URL after polling for completion
 * @param referenceImages - Character reference images (URL) for consistency
 */
async function legacyGenerateVideo(
  imageUrl: string,
  prompt: string,
  config: Partial<GenerationConfig> & { apiKey?: string },
  onProgress?: (progress: number) => void,
  referenceImages?: string[]
): Promise<string> {
  return legacyWorkerApi.generateVideo(imageUrl, prompt, config, onProgress, referenceImages);
}

/**
 * Helper: Poll task status until completion
 */
async function legacyPollTaskCompletion(
  taskId: string,
  type: 'image' | 'video',
  apiKey: string,
  provider: string,
  onProgress?: (progress: number) => void
): Promise<string> {
  return legacyWorkerApi.pollTaskCompletion(taskId, type, apiKey, provider, onProgress);
}

/**
 * Helper: Download URL content as Blob
 */
async function legacyFetchAsBlob(url: string): Promise<Blob> {
  return legacyWorkerApi.fetchAsBlob(url);
}

async function handleExecuteScene(command: ExecuteSceneCommand): Promise<void> {
  const { screenplayId, scene, config, characterBible, characterReferenceImages } = command.payload;
  const { run, api } = beginRun(command.runId);

  console.log(`[AI Worker] Executing scene ${scene.sceneId} for screenplay ${screenplayId}`);
  
  // Check cancellation
  if (isCancelled(run)) {
    reportSceneFailed(run, screenplayId, scene.sceneId, 'Cancelled', false);
    return;
  }
  
  // Report progress: starting image generation
  reportSceneProgress(run, screenplayId, scene.sceneId, 'generating', 'image', 0);
  
  try {
    // Extract characters from bible for consistency
    const characters = getBibleCharacters(characterBible);
    
    // Get character reference images (base64 or URL)
    // These are used to maintain visual consistency across scenes
    const refImages = characterReferenceImages || [];
    console.log(`[AI Worker] Using ${refImages.length} character reference images`);
    
    // ========== Stage 1: Image Generation ==========
    const imagePrompt = promptCompiler.compileSceneImagePrompt(
      scene,
      characters,
      config
    );
    const negativePrompt = promptCompiler.getNegativePrompt();
    
    console.log('[AI Worker] Image prompt:', imagePrompt.substring(0, 100));
    
    // Generate image with progress tracking
    // Pass character reference images for visual consistency
    const imageUrl = await api.generateImage(
      imagePrompt,
      negativePrompt,
      config,
      (progress) => {
        // Map image progress to 0-45%
        const mappedProgress = Math.floor(progress * 0.45);
        reportSceneProgress(run, screenplayId, scene.sceneId, 'generating', 'image', mappedProgress);
      },
      refImages // Character reference images
    );
    
    reportSceneProgress(run, screenplayId, scene.sceneId, 'generating', 'image', 45);
    console.log('[AI Worker] Image generated:', imageUrl);
    
    // ========== Stage 2: Video Generation ==========
    const videoPrompt = promptCompiler.compileSceneVideoPrompt(scene, characters);
    
    console.log('[AI Worker] Video prompt:', videoPrompt.substring(0, 100));
    reportSceneProgress(run, screenplayId, scene.sceneId, 'generating', 'video', 50);
    
    // Generate video with progress tracking
    // Pass character reference images for visual consistency in video
    const videoUrl = await api.generateVideo(
      imageUrl,
      videoPrompt,
      config,
      (progress) => {
        // Map video progress to 50-95%
        const mappedProgress = 50 + Math.floor(progress * 0.45);
        reportSceneProgress(run, screenplayId, scene.sceneId, 'generating', 'video', mappedProgress);
      },
      refImages // Character reference images
    );
    
    console.log('[AI Worker] Video generated:', videoUrl);
    
    // ========== Stage 3: Download and Create Blob ==========
    reportSceneProgress(run, screenplayId, scene.sceneId, 'generating', 'video', 95);
    
    // Download the video as blob
    const videoBlob = await api.fetchAsBlob(videoUrl);
    
    // ========== Complete ==========
    reportSceneProgress(run, screenplayId, scene.sceneId, 'completed', 'done', 100);
    
    // Send the completed scene with media blob
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
  }
}

const { reportSceneProgress, reportSceneFailed } = createWorkerSceneEventReporter(postEvent);


/**
 * Handle EXECUTE_SCREENPLAY command
 * Executes all scenes in the screenplay sequentially (or with limited concurrency)
 */
async function handleExecuteScreenplay(command: ExecuteScreenplayCommand): Promise<void> {
  const { screenplay, config } = command.payload;
  const { run, api } = beginRun(command.runId);

  console.log(`[AI Worker] Executing screenplay ${screenplay.id} with ${screenplay.scenes.length} scenes`);
  
  // Set baseUrl if provided
  if ((config as any).baseUrl) {
    apiBaseUrl = (config as any).baseUrl;
  }
  
  // Check for mock modes
  const mockImage = (config as any).mockImage || false;
  const mockVideo = (config as any).mockVideo || false;
  
  // Get API keys from config
  const apiKeys = (config as any).apiKeys || {};
  const concurrency = config.concurrency || 1;
  
  // Get character reference images from config
  const characterReferenceImages = (config as any).characterReferenceImages || [];
  console.log(`[AI Worker] Using ${characterReferenceImages.length} character reference images from config`);
  
  // Prepare extended config with API keys
  const extendedConfig = {
    ...config,
    apiKey: apiKeys.memefast || '',
    imageApiKey: apiKeys.memefast || '',
    videoApiKey: apiKeys.memefast || '',
    mockImage,
    mockVideo,
    characterReferenceImages,
  };
  
  // Execute scenes with concurrency control
  const scenes = screenplay.scenes;
  let completedCount = 0;
  let failedCount = 0;
  
  // Process scenes in batches
  for (let i = 0; i < scenes.length; i += concurrency) {
    if (isCancelled(run)) {
      console.log('[AI Worker] Screenplay execution cancelled');
      break;
    }
    
    const batch = scenes.slice(i, i + concurrency);
    
    // Execute batch in parallel
    await Promise.allSettled(
      batch.map(async (scene) => {
        try {
          await executeSceneInternal(run, api, screenplay.id, scene, extendedConfig, screenplay.characterBible, characterReferenceImages);
          completedCount++;
        } catch (error) {
          failedCount++;
          const err = error as Error;
          console.error(`[AI Worker] Scene ${scene.sceneId} failed:`, err.message);
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
  
  console.log(`[AI Worker] Screenplay execution complete: ${completedCount} completed, ${failedCount} failed`);
}

/**
 * Handle EXECUTE_SCREENPLAY_IMAGES command
 * Generates images for all scenes (Step 1 of two-step flow)
 */
async function handleExecuteScreenplayImages(command: ExecuteScreenplayImagesCommand): Promise<void> {
  const { screenplay, config } = command.payload;
  const { run, api } = beginRun(command.runId);

  console.log(`[AI Worker] Generating images for screenplay ${screenplay.id} with ${screenplay.scenes.length} scenes`);
  
  // Set baseUrl if provided
  if ((config as any).baseUrl) {
    apiBaseUrl = (config as any).baseUrl;
  }
  
  // Check for mock mode
  const mockImage = (config as any).mockImage || false;
  
  // Get API keys from config
  const apiKeys = (config as any).apiKeys || {};
  const concurrency = config.concurrency || 1;
  
  console.log('[AI Worker] Config apiKeys:', JSON.stringify(apiKeys));
  console.log('[AI Worker] Config keys:', Object.keys(config));
  
  // Validate API key (required for image generation)
  const imageKey = apiKeys.memefast || '';
  if (!imageKey && !mockImage) {
    console.error('[AI Worker] Image API Key not configured');
    postEvent({
      type: 'ALL_IMAGES_COMPLETED',
      payload: {
        screenplayId: screenplay.id,
        completedCount: 0,
        failedCount: screenplay.scenes.length,
        totalCount: screenplay.scenes.length,
        error: '未配置图片生成 API Key，请在服务映射中配置',
      },
    }, run);
    // Also report failure for each scene
    for (const scene of screenplay.scenes) {
      reportSceneFailed(run, screenplay.id, scene.sceneId, '未配置图片生成 API Key', false);
    }
    return;
  }
  
  // Get character reference images from config
  const characterReferenceImages = (config as any).characterReferenceImages || [];
  console.log(`[AI Worker] Using ${characterReferenceImages.length} character reference images`);
  console.log(`[AI Worker] Image API Key: ${imageKey ? imageKey.substring(0, 10) + '...' : 'NOT SET'}`);
  
  // Prepare extended config with API keys
  const extendedConfig = {
    ...config,
    apiKey: imageKey,
    imageApiKey: imageKey,
    mockImage,
    characterReferenceImages,
  };
  
  // Execute image generation for all scenes
  const scenes = screenplay.scenes;
  let completedCount = 0;
  let failedCount = 0;
  
  // Process scenes in batches
  for (let i = 0; i < scenes.length; i += concurrency) {
    if (isCancelled(run)) {
      console.log('[AI Worker] Image generation cancelled');
      break;
    }
    
    const batch = scenes.slice(i, i + concurrency);
    
    // Execute batch in parallel
    await Promise.allSettled(
      batch.map(async (scene) => {
        try {
          await generateSceneImageOnly(run, api, screenplay.id, scene, extendedConfig, screenplay.characterBible, characterReferenceImages);
          completedCount++;
        } catch (error) {
          failedCount++;
          const err = error as Error;
          console.error(`[AI Worker] Scene ${scene.sceneId} image failed:`, err.message);
        }
      })
    );
  }
  
  // Report all images completed
  postEvent({
    type: 'ALL_IMAGES_COMPLETED',
    payload: {
      screenplayId: screenplay.id,
      completedCount,
      failedCount,
      totalCount: scenes.length,
    },
  }, run);
  
  console.log(`[AI Worker] Image generation complete: ${completedCount} completed, ${failedCount} failed`);
}

/**
 * Handle EXECUTE_SCREENPLAY_VIDEOS command
 * Generates videos from existing scene images (Step 2 of two-step flow)
 */
async function handleExecuteScreenplayVideos(command: ExecuteScreenplayVideosCommand): Promise<void> {
  const { screenplay, config } = command.payload;
  const { run, api } = beginRun(command.runId);

  console.log(`[AI Worker] Generating videos for screenplay ${screenplay.id} with ${screenplay.scenes.length} scenes`);
  
  // Debug: Log each scene's imageUrl
  for (const scene of screenplay.scenes) {
    console.log(`[AI Worker] Scene ${scene.sceneId} imageUrl: ${scene.imageUrl || 'NOT SET'}`);
  }
  
  // Set baseUrl if provided
  if ((config as any).baseUrl) {
    apiBaseUrl = (config as any).baseUrl;
  }
  
  // Check for mock mode
  const mockVideo = (config as any).mockVideo || false;
  
  // Get API keys from config
  const apiKeys = (config as any).apiKeys || {};
  const concurrency = config.concurrency || 1;
  
  // Get character reference images from config
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
      console.log('[AI Worker] Video generation cancelled');
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
          await generateSceneVideoOnly(run, api, screenplay.id, scene, extendedConfig, screenplay.characterBible, characterReferenceImages);
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
  
  console.log(`[AI Worker] Video generation complete: ${completedCount} completed, ${failedCount} failed`);
}

/**
 * Generate image only for a scene (used in two-step flow)
 */
async function generateSceneImageOnly(
  run: WorkerRun,
  api: WorkerApi,
  screenplayId: string,
  scene: AIScene,
  config: GenerationConfig & { mockImage?: boolean },
  characterBible?: CharacterBibleLike | string,
  characterReferenceImages?: string[]
): Promise<void> {
  console.log(`[AI Worker] Generating image for scene ${scene.sceneId}`);
  
  // Check cancellation
  if (isCancelled(run)) {
    reportSceneFailed(run, screenplayId, scene.sceneId, 'Cancelled', false);
    throw new Error('Cancelled');
  }
  
  // Report progress: starting image generation
  reportSceneProgress(run, screenplayId, scene.sceneId, 'generating', 'image', 0);
  
  // Mock mode check
  if (config.mockImage) {
    console.log('[AI Worker] Mock mode - simulating image generation');
    
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
    const refImages = characterReferenceImages || (config as any).characterReferenceImages || [];
    console.log(`[AI Worker] Scene ${scene.sceneId}: Using ${refImages.length} reference images`);
    
    // Compile image prompt
    const imagePrompt = promptCompiler.compileSceneImagePrompt(
      scene,
      characters,
      config
    );
    const negativePrompt = promptCompiler.getNegativePrompt();
    
    console.log('[AI Worker] Image prompt:', imagePrompt.substring(0, 100));
    
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
    
    console.log('[AI Worker] Image generated:', imageUrl);
    
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
async function generateSceneVideoOnly(
  run: WorkerRun,
  api: WorkerApi,
  screenplayId: string,
  scene: AIScene,
  config: GenerationConfig & { mockVideo?: boolean },
  characterBible?: CharacterBibleLike | string,
  characterReferenceImages?: string[]
): Promise<void> {
  console.log(`[AI Worker] Generating video for scene ${scene.sceneId}`);
  
  // Check cancellation
  if (isCancelled(run)) {
    reportSceneFailed(run, screenplayId, scene.sceneId, 'Cancelled', false);
    throw new Error('Cancelled');
  }
  
  // Report progress: starting video generation
  reportSceneProgress(run, screenplayId, scene.sceneId, 'generating', 'video', 50);
  
  // Mock mode check
  if (config.mockVideo) {
    console.log('[AI Worker] Mock mode - simulating video generation');
    
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
    const refImages = characterReferenceImages || (config as any).characterReferenceImages || [];
    
    // Compile video prompt
    const videoPrompt = promptCompiler.compileSceneVideoPrompt(scene, characters);
    
    console.log('[AI Worker] Video prompt:', videoPrompt.substring(0, 100));
    
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
    
    console.log('[AI Worker] Video generated:', videoUrl);
    
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
async function executeSceneInternal(
  run: WorkerRun,
  api: WorkerApi,
  screenplayId: string,
  scene: AIScene,
  config: GenerationConfig & { mockImage?: boolean; mockVideo?: boolean },
  characterBible?: CharacterBibleLike | string,
  characterReferenceImages?: string[]
): Promise<void> {
  console.log(`[AI Worker] Executing scene ${scene.sceneId} for screenplay ${screenplayId}`);
  
  // Check cancellation
  if (isCancelled(run)) {
    reportSceneFailed(run, screenplayId, scene.sceneId, 'Cancelled', false);
    throw new Error('Cancelled');
  }
  
  // Report progress: starting image generation
  reportSceneProgress(run, screenplayId, scene.sceneId, 'generating', 'image', 0);
  
  // Mock mode check
  if (config.mockImage && config.mockVideo) {
    console.log('[AI Worker] Mock mode - simulating scene execution');
    
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
    const refImages = characterReferenceImages || (config as any).characterReferenceImages || [];
    console.log(`[AI Worker] Scene ${scene.sceneId}: Using ${refImages.length} reference images`);
    
    // ========== Stage 1: Image Generation ==========
    const imagePrompt = promptCompiler.compileSceneImagePrompt(
      scene,
      characters,
      config
    );
    const negativePrompt = promptCompiler.getNegativePrompt();
    
    console.log('[AI Worker] Image prompt:', imagePrompt.substring(0, 100));
    
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
    console.log('[AI Worker] Image generated:', imageUrl);
    
    // ========== Stage 2: Video Generation ==========
    const videoPrompt = promptCompiler.compileSceneVideoPrompt(scene, characters);
    
    console.log('[AI Worker] Video prompt:', videoPrompt.substring(0, 100));
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
    
    console.log('[AI Worker] Video generated:', videoUrl);
    
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

function handleCancel(command: CancelCommand): void {
  console.log('[AI Worker] Cancelling operations');
  workerRuns.cancel(command.runId);
}

// ==================== Helpers ====================

function postEvent(event: WorkerEvent, run?: WorkerRun, explicitRunId?: number): void {
  if (run && !workerRuns.isCurrent(run)) return;
  if (explicitRunId !== undefined) {
    self.postMessage({ ...event, runId: explicitRunId });
    return;
  }
  self.postMessage(run ? { ...event, runId: run.id } : event);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==================== Initialization ====================

// Signal that worker is ready
postEvent({
  type: 'WORKER_READY',
  payload: { version: WORKER_VERSION },
});

console.log(`[AI Worker] Initialized, version ${WORKER_VERSION}`);
