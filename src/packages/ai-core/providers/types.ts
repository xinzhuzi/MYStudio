// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * API Provider Types
 * Common types for all AI service providers
 */

import type { ProviderId, ServiceType, AsyncTaskResult } from '../types';

/**
 * API Provider interface
 * All providers must implement this interface
 */
export interface APIProvider {
  id: ProviderId;
  name: string;
  services: ServiceType[];
  baseUrl: string;

  /**
   * Check if the provider is configured (has valid API key)
   */
  isConfigured(): boolean;

  /**
   * Test connection to the provider
   */
  testConnection(): Promise<{ success: boolean; error?: string }>;
}

/**
 * Chat provider interface
 */
export interface ChatProvider extends APIProvider {
  /**
   * Send a chat completion request
   */
  chat(params: ChatParams): Promise<ChatResult>;
}

/**
 * Image generation provider interface
 */
export interface ImageProvider extends APIProvider {
  /**
   * Submit image generation task
   */
  generateImage(params: ImageParams): Promise<TaskSubmitResult>;

  /**
   * Poll image task status
   */
  pollImageTask(taskId: string): Promise<AsyncTaskResult>;
}

/**
 * Video generation provider interface
 */
export interface VideoProvider extends APIProvider {
  /**
   * Submit video generation task
   */
  generateVideo(params: VideoParams): Promise<TaskSubmitResult>;

  /**
   * Poll video task status
   */
  pollVideoTask(taskId: string): Promise<AsyncTaskResult>;
}

// ==================== Request/Response Types ====================

export interface ChatParams {
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

export interface ChatResult {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ImageParams {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  model?: string;
  steps?: number;
  guidanceScale?: number;
}

export interface VideoParams {
  imageUrl?: string;
  imageBase64?: string;
  prompt?: string;
  duration: number;
  aspectRatio?: '16:9' | '9:16';
}

export interface TaskSubmitResult {
  taskId: string;
  estimatedTime?: number;
}

// ==================== Provider Registry ====================

/**
 * Registry of all available providers
 */
export interface ProviderRegistry {
  chat: Map<ProviderId, ChatProvider>;
  image: Map<ProviderId, ImageProvider>;
  video: Map<ProviderId, VideoProvider>;
}

/**
 * Get API key function type
 * Used for dynamic key retrieval from config store
 */
export type GetApiKeyFn = (providerId: ProviderId) => string;
