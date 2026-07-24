// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Worker Communication Protocol
 * Defines message types between main thread and AI Worker
 */

import type { AIScreenplay, AIScene, GenerationConfig, SceneProgress, CharacterBibleLike } from '../types';

// ==================== Main Thread -> Worker Commands ====================

/**
 * Commands sent from main thread to worker
 */
export type WorkerCommand =
  | PingCommand
  | GenerateScreenplayCommand
  | ExecuteScreenplayCommand
  | ExecuteScreenplayImagesCommand
  | ExecuteScreenplayVideosCommand
  | ExecuteSceneCommand
  | RetrySceneCommand
  | CancelCommand
  | UpdateConfigCommand;

export interface WorkerRunCommand {
  runId?: number;
}

export interface PingCommand {
  type: 'PING';
  payload: { timestamp: number };
}

export interface GenerateScreenplayCommand extends WorkerRunCommand {
  type: 'GENERATE_SCREENPLAY';
  payload: {
    prompt: string;
    referenceImages?: ArrayBuffer[];
    config: Partial<GenerationConfig>;
  };
}

export interface ExecuteScreenplayCommand extends WorkerRunCommand {
  type: 'EXECUTE_SCREENPLAY';
  payload: {
    screenplay: AIScreenplay;
    config: GenerationConfig;
  };
}

export interface ExecuteSceneCommand extends WorkerRunCommand {
  type: 'EXECUTE_SCENE';
  payload: {
    screenplayId: string;
    scene: AIScene;
    config: GenerationConfig;
    characterBible?: CharacterBibleLike | string;
    characterReferenceImages?: string[];
  };
}

export interface ExecuteScreenplayImagesCommand extends WorkerRunCommand {
  type: 'EXECUTE_SCREENPLAY_IMAGES';
  payload: {
    screenplay: AIScreenplay;
    config: GenerationConfig;
  };
}

export interface ExecuteScreenplayVideosCommand extends WorkerRunCommand {
  type: 'EXECUTE_SCREENPLAY_VIDEOS';
  payload: {
    screenplay: AIScreenplay;
    config: GenerationConfig;
  };
}

export interface RetrySceneCommand {
  type: 'RETRY_SCENE';
  payload: {
    screenplayId: string;
    sceneId: number;
  };
}

export interface CancelCommand extends WorkerRunCommand {
  type: 'CANCEL';
  payload?: {
    screenplayId?: string;
    sceneId?: number;
  };
}

export interface UpdateConfigCommand {
  type: 'UPDATE_CONFIG';
  payload: Partial<GenerationConfig>;
}

// ==================== Worker -> Main Thread Events ====================

/**
 * Events sent from worker to main thread
 */
export interface WorkerEventBase {
  runId?: number;
}

export type WorkerEvent = (
  | PongEvent
  | ScreenplayReadyEvent
  | ScreenplayErrorEvent
  | SceneProgressEvent
  | SceneImageCompletedEvent
  | AllImagesCompletedEvent
  | SceneCompletedEvent
  | SceneFailedEvent
  | AllScenesCompletedEvent
  | WorkerErrorEvent
  | WorkerReadyEvent
) & WorkerEventBase;

export interface PongEvent {
  type: 'PONG';
  payload: { timestamp: number; workerTimestamp: number };
}

export interface WorkerReadyEvent {
  type: 'WORKER_READY';
  payload: { version: string };
}

export interface ScreenplayReadyEvent {
  type: 'SCREENPLAY_READY';
  payload: AIScreenplay;
}

export interface ScreenplayErrorEvent {
  type: 'SCREENPLAY_ERROR';
  payload: { error: string; details?: string };
}

export interface SceneProgressEvent {
  type: 'SCENE_PROGRESS';
  payload: {
    screenplayId: string;
    sceneId: number;
    progress: SceneProgress;
  };
}

export interface SceneCompletedEvent {
  type: 'SCENE_COMPLETED';
  payload: {
    screenplayId: string;
    sceneId: number;
    mediaBlob: Blob;
    mediaId?: string;
    metadata: {
      duration: number;
      width: number;
      height: number;
      mimeType: string;
    };
  };
}

export interface SceneImageCompletedEvent {
  type: 'SCENE_IMAGE_COMPLETED';
  payload: {
    screenplayId: string;
    sceneId: number;
    imageUrl: string;
  };
}

export interface AllImagesCompletedEvent {
  type: 'ALL_IMAGES_COMPLETED';
  payload: {
    screenplayId: string;
    completedCount: number;
    failedCount: number;
    totalCount: number;
    error?: string;
  };
}

export interface SceneFailedEvent {
  type: 'SCENE_FAILED';
  payload: {
    screenplayId: string;
    sceneId: number;
    error: string;
    retryable: boolean;
  };
}

export interface AllScenesCompletedEvent {
  type: 'ALL_SCENES_COMPLETED';
  payload: {
    screenplayId: string;
    totalScenes?: number;
    totalCount?: number;
    successCount?: number;
    completedCount?: number;
    failedCount: number;
  };
}

export interface WorkerErrorEvent {
  type: 'WORKER_ERROR';
  payload: {
    message: string;
    stack?: string;
  };
}

// ==================== Helper Types ====================

/**
 * Extract command type string
 */
export type CommandType = WorkerCommand['type'];

/**
 * Extract event type string
 */
export type EventType = WorkerEvent['type'];

/**
 * Type-safe command handler map
 */
export type CommandHandlers = {
  [K in CommandType]: (
    payload: Extract<WorkerCommand, { type: K }>['payload']
  ) => void | Promise<void>;
};

/**
 * Type-safe event handler map
 */
export type EventHandlers = {
  [K in EventType]?: (
    payload: Extract<WorkerEvent, { type: K }>['payload']
  ) => void;
};
