import type { FreedomVideoUploadFile } from './video-upload-validation';

export interface FreedomImageParams {
  prompt: string;
  model?: string;
  aspectRatio?: string;
  resolution?: string;
  width?: number;
  height?: number;
  negativePrompt?: string;
  referenceImages?: string[];
  extraParams?: Record<string, any>;
  signal?: AbortSignal;
}

export interface FreedomVideoParams {
  prompt: string;
  model?: string;
  aspectRatio?: string;
  duration?: number;
  resolution?: string;
  uploadFiles?: FreedomVideoUploadFile[];
}

export interface GenerationResult {
  url: string;
  taskId?: string;
  mediaId?: string;
}
