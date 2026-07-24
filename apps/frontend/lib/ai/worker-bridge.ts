// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * AI Worker Bridge
 * Communication layer between main thread and AI Worker
 * Handles message routing, promise management, and store updates
 */

import type {
  WorkerCommand,
  WorkerEvent,
  EventHandlers,
  AIScreenplay,
  AIScene,
  GenerationConfig,
  SceneProgress,
  SceneCompletedEvent,
  SceneFailedEvent,
} from '@opencut/ai-core';
import { useMediaStore } from '@/stores/media-store';
import { useProjectStore } from '@/stores/project-store';
import { useDirectorStore } from '@/stores/director-store';
import { prepareReferenceImageForTransfer, prepareReferenceImagesForTransfer } from '@/lib/ai/image-transfer';

type GenerationConfigWithReferenceImages = GenerationConfig & {
  characterReferenceImages?: string[];
};

async function prepareGenerationConfigForTransfer(
  config: GenerationConfig,
): Promise<GenerationConfig> {
  const referenceImages = (config as GenerationConfigWithReferenceImages).characterReferenceImages;
  const prepared = await prepareReferenceImagesForTransfer(referenceImages);
  if (!prepared) return config;
  return { ...config, characterReferenceImages: prepared } as GenerationConfigWithReferenceImages;
}

async function prepareScreenplayFramesForTransfer(screenplay: AIScreenplay): Promise<AIScreenplay> {
  const scenes: AIScene[] = [];
  for (const scene of screenplay.scenes) {
    scenes.push(scene.imageUrl
      ? { ...scene, imageUrl: await prepareReferenceImageForTransfer(scene.imageUrl) }
      : scene);
  }
  return { ...screenplay, scenes };
}

type PromiseCallbacks = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export class AIWorkerBridge {
  private worker: Worker | null = null;
  private eventHandlers: Partial<EventHandlers> = {};
  private pendingPromises: Map<string, PromiseCallbacks> = new Map();
  private isReady = false;
  private readyPromise: Promise<void>;
  private readyResolve: (() => void) | null = null;
  private activeRunId: number | null = null;
  private nextRunId = 0;

  constructor() {
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve;
    });
  }

  /**
   * Initialize the worker
   * Call this once when the app starts
   */
  async initialize(): Promise<void> {
    if (this.worker) {
      console.warn('[WorkerBridge] Worker already initialized');
      return;
    }

    // Create worker using Next.js worker loader
    this.worker = new Worker(
      new URL('../../workers/ai-worker.ts', import.meta.url)
    );

    this.worker.onmessage = this.handleWorkerMessage.bind(this);
    this.worker.onerror = this.handleWorkerError.bind(this);

    // Wait for worker to signal ready
    await this.readyPromise;
    console.log('[WorkerBridge] Worker initialized and ready');
  }

  /**
   * Terminate the worker
   */
  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.isReady = false;
    }
  }

  /**
   * Register event handlers
   */
  on<K extends keyof EventHandlers>(
    eventType: K,
    handler: EventHandlers[K]
  ): void {
    this.eventHandlers[eventType] = handler;
  }

  /**
   * Remove event handler
   */
  off(eventType: keyof EventHandlers): void {
    delete this.eventHandlers[eventType];
  }

  /**
   * Send a ping to test worker connectivity
   */
  async ping(): Promise<number> {
    const timestamp = Date.now();
    return new Promise((resolve, reject) => {
      const id = `ping_${timestamp}`;
      this.pendingPromises.set(id, {
        resolve: (payload: unknown) => {
          const p = payload as { workerTimestamp: number };
          resolve(p.workerTimestamp - timestamp);
        },
        reject,
      });

      this.sendCommand({ type: 'PING', payload: { timestamp } });

      // Timeout after 5 seconds
      setTimeout(() => {
        if (this.pendingPromises.has(id)) {
          this.pendingPromises.delete(id);
          reject(new Error('Ping timeout'));
        }
      }, 5000);
    });
  }

  /**
   * Generate a screenplay from a prompt
   */
  async generateScreenplay(
    prompt: string,
    referenceImages?: File[],
    config?: Partial<GenerationConfig>
  ): Promise<AIScreenplay> {
    // Convert files to ArrayBuffer for transfer
    const imageBuffers = referenceImages
      ? await Promise.all(referenceImages.map((f) => f.arrayBuffer()))
      : undefined;

    return new Promise((resolve, reject) => {
      const runId = this.beginRun();
      const id = `screenplay_${runId}`;
      this.pendingPromises.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });

      this.sendCommand({
        type: 'GENERATE_SCREENPLAY',
        runId,
        payload: {
          prompt,
          referenceImages: imageBuffers,
          config: config || {},
        },
      });
    });
  }

  /**
   * Execute a single scene
   * @param characterReferenceImages - Array of character reference image URLs or base64 strings
   */
  async executeScene(
    screenplayId: string,
    scene: AIScene,
    config: GenerationConfig,
    characterBible?: string,
    characterReferenceImages?: string[]
  ): Promise<void> {
    const preparedReferenceImages = await prepareReferenceImagesForTransfer(characterReferenceImages);
    const runId = this.beginRun();
    this.sendCommand({
      type: 'EXECUTE_SCENE',
      runId,
      payload: {
        screenplayId,
        scene,
        config,
        characterBible,
        characterReferenceImages: preparedReferenceImages,
      },
    });
  }

  /**
   * Execute entire screenplay (images + videos)
   */
  async executeScreenplay(screenplay: AIScreenplay, config: GenerationConfig): Promise<void> {
    const preparedConfig = await prepareGenerationConfigForTransfer(config);
    const preparedScreenplay = await prepareScreenplayFramesForTransfer(screenplay);
    const runId = this.beginRun();
    this.sendCommand({
      type: 'EXECUTE_SCREENPLAY',
      runId,
      payload: { screenplay: preparedScreenplay, config: preparedConfig },
    });
  }

  /**
   * Execute screenplay images only (Step 1)
   * Generates images for all scenes without videos
   */
  async executeScreenplayImages(screenplay: AIScreenplay, config: GenerationConfig): Promise<void> {
    const preparedConfig = await prepareGenerationConfigForTransfer(config);
    const runId = this.beginRun();
    this.sendCommand({
      type: 'EXECUTE_SCREENPLAY_IMAGES',
      runId,
      payload: { screenplay, config: preparedConfig },
    });
  }

  /**
   * Execute screenplay videos only (Step 2)
   * Generates videos from existing scene images
   */
  async executeScreenplayVideos(screenplay: AIScreenplay, config: GenerationConfig): Promise<void> {
    const preparedConfig = await prepareGenerationConfigForTransfer(config);
    const preparedScreenplay = await prepareScreenplayFramesForTransfer(screenplay);
    const runId = this.beginRun();
    this.sendCommand({
      type: 'EXECUTE_SCREENPLAY_VIDEOS',
      runId,
      payload: { screenplay: preparedScreenplay, config: preparedConfig },
    });
  }

  /**
   * Retry a failed scene
   */
  retryScene(screenplayId: string, sceneId: number): void {
    this.sendCommand({
      type: 'RETRY_SCENE',
      payload: { screenplayId, sceneId },
    });
  }

  /**
   * Cancel all or specific operations
   */
  cancel(screenplayId?: string, sceneId?: number): void {
    const runId = this.activeRunId ?? undefined;
    if (runId !== undefined) {
      this.activeRunId = null;
      this.rejectPendingScreenplay(runId, new Error('Generation cancelled'));
    }
    this.sendCommand({
      type: 'CANCEL',
      runId,
      payload: screenplayId || sceneId ? { screenplayId, sceneId } : undefined,
    });
  }

  // ==================== Private Methods ====================

  private sendCommand(command: WorkerCommand): void {
    if (!this.worker) {
      throw new Error('Worker not initialized');
    }
    this.worker.postMessage(command);
  }

  private beginRun(): number {
    if (this.activeRunId !== null) {
      this.rejectPendingScreenplay(this.activeRunId, new Error('Generation superseded by a newer run'));
    }
    this.activeRunId = ++this.nextRunId;
    return this.activeRunId;
  }

  private rejectPendingScreenplay(runId: number, error: Error): void {
    const id = `screenplay_${runId}`;
    const callbacks = this.pendingPromises.get(id);
    if (!callbacks) return;
    callbacks.reject(error);
    this.pendingPromises.delete(id);
  }

  private handleWorkerMessage(e: MessageEvent<WorkerEvent>): void {
    const event = e.data;
    if (event.runId !== undefined && event.runId !== this.activeRunId) return;

    switch (event.type) {
      case 'WORKER_READY':
        this.isReady = true;
        this.readyResolve?.();
        console.log(`[WorkerBridge] Worker ready, version ${event.payload.version}`);
        break;

      case 'PONG':
        // Resolve the oldest pending ping
        for (const [id, callbacks] of this.pendingPromises) {
          if (id.startsWith('ping_')) {
            callbacks.resolve(event.payload);
            this.pendingPromises.delete(id);
            break;
          }
        }
        break;

      case 'SCREENPLAY_READY':
        this.resolveScreenplay(event);
        // Also call registered handler
        this.eventHandlers.SCREENPLAY_READY?.(event.payload);
        break;

      case 'SCREENPLAY_ERROR':
        this.rejectScreenplay(event);
        break;

      case 'SCENE_PROGRESS':
        this.eventHandlers.SCENE_PROGRESS?.(event.payload);
        break;

      case 'SCENE_IMAGE_COMPLETED':
        // Image-only completion (Step 1 of two-step flow)
        this.eventHandlers.SCENE_IMAGE_COMPLETED?.(event.payload);
        break;

      case 'ALL_IMAGES_COMPLETED':
        // All images generated (Step 1 complete)
        this.eventHandlers.ALL_IMAGES_COMPLETED?.(event.payload);
        break;

      case 'SCENE_COMPLETED':
        // Inject completed scene into media store and replace ghost
        this.handleSceneCompleted(event.payload);
        this.eventHandlers.SCENE_COMPLETED?.(event.payload);
        break;

      case 'SCENE_FAILED':
        // Update ghost status to failed
        this.handleSceneFailed(event.payload);
        this.eventHandlers.SCENE_FAILED?.(event.payload);
        break;

      case 'ALL_SCENES_COMPLETED':
        this.eventHandlers.ALL_SCENES_COMPLETED?.(event.payload);
        break;

      case 'WORKER_ERROR':
        console.error('[WorkerBridge] Worker error:', event.payload.message);
        this.eventHandlers.WORKER_ERROR?.(event.payload);
        break;

      default:
        console.warn('[WorkerBridge] Unhandled event type:', (event as WorkerEvent).type);
    }
  }

  private resolveScreenplay(event: Extract<WorkerEvent, { type: 'SCREENPLAY_READY' }>): void {
    const id = event.runId === undefined ? undefined : `screenplay_${event.runId}`;
    if (id) {
      const callbacks = this.pendingPromises.get(id);
      if (!callbacks) return;
      callbacks.resolve(event.payload);
      this.pendingPromises.delete(id);
      return;
    }
    for (const [pendingId, callbacks] of this.pendingPromises) {
      if (!pendingId.startsWith('screenplay_')) continue;
      callbacks.resolve(event.payload);
      this.pendingPromises.delete(pendingId);
      return;
    }
  }

  private rejectScreenplay(event: Extract<WorkerEvent, { type: 'SCREENPLAY_ERROR' }>): void {
    const error = new Error(event.payload.error);
    if (event.runId !== undefined) {
      this.rejectPendingScreenplay(event.runId, error);
      return;
    }
    for (const [id, callbacks] of this.pendingPromises) {
      if (!id.startsWith('screenplay_')) continue;
      callbacks.reject(error);
      this.pendingPromises.delete(id);
      return;
    }
  }

  private handleWorkerError(error: ErrorEvent): void {
    console.error('[WorkerBridge] Worker error event:', error);
    
    // Reject all pending promises
    for (const [id, callbacks] of this.pendingPromises) {
      callbacks.reject(new Error(`Worker error: ${error.message}`));
    }
    this.pendingPromises.clear();
  }

  /**
   * Handle completed scene: inject media and replace ghost
   */
  private async handleSceneCompleted(
    payload: SceneCompletedEvent['payload']
  ): Promise<void> {
    const { screenplayId, sceneId, mediaBlob, metadata } = payload;
    
    console.log(`[WorkerBridge] Scene ${sceneId} completed, injecting media...`);
    
    try {
      const projectId = useProjectStore.getState().activeProject?.id;
      if (!projectId) {
        console.error('[WorkerBridge] No active project');
        return;
      }
      
      // 1. Convert Blob to File
      const file = new File(
        [mediaBlob],
        `ai-scene-${sceneId}.mp4`,
        { type: metadata.mimeType || 'video/mp4' }
      );
      
      // 2. Add to media store in AI视频 system folder
      const videoFolderId = useMediaStore.getState().getOrCreateCategoryFolder('ai-video');
      const mediaFile = await useMediaStore.getState().addMediaFile(projectId, {
        name: file.name,
        type: 'video',
        file,
        url: URL.createObjectURL(file),
        duration: metadata.duration,
        width: metadata.width,
        height: metadata.height,
        folderId: videoFolderId,
        source: 'ai-video',
        projectId,
      });
      
      // 3. Update director store
      const directorStore = useDirectorStore.getState();
      if (mediaFile) {
        directorStore.onSceneCompleted(sceneId, mediaFile.id);
        console.log(`[WorkerBridge] Scene ${sceneId} media injected: ${mediaFile.id}`);
      }
      
    } catch (error) {
      console.error('[WorkerBridge] Failed to inject scene media:', error);
    }
  }

  /**
   * Handle failed scene: update ghost status
   */
  private async handleSceneFailed(
    payload: SceneFailedEvent['payload']
  ): Promise<void> {
    const { screenplayId, sceneId, error, retryable } = payload;
    
    console.log(`[WorkerBridge] Scene ${sceneId} failed:`, error);
    
    try {
      // Update director store
      const directorStore = useDirectorStore.getState();
      directorStore.onSceneFailed(sceneId, error);
      
    } catch (err) {
      console.error('[WorkerBridge] Failed to handle scene failure:', err);
    }
  }
}

// Singleton instance
let bridgeInstance: AIWorkerBridge | null = null;

/**
 * Get or create the singleton worker bridge instance
 */
export function getWorkerBridge(): AIWorkerBridge {
  if (!bridgeInstance) {
    bridgeInstance = new AIWorkerBridge();
  }
  return bridgeInstance;
}

/**
 * Initialize the worker bridge (call once at app startup)
 */
export async function initializeWorkerBridge(): Promise<AIWorkerBridge> {
  const bridge = getWorkerBridge();
  await bridge.initialize();
  return bridge;
}
