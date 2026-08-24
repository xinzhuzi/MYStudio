import type { FreedomVideoUploadFile } from './video-upload-validation';

export interface FreedomImageParams {
  prompt: string;
  model?: string;
  aspectRatio?: string;
  resolution?: string;
  width?: number;
  height?: number;
  negativePrompt?: string;
  /** raw=调用方已持有最终 provider-visible 文本(如道劫分镜帧编译产物),传输层禁止再追加/改写 */
  promptPolicy?: "enhanced" | "raw";
  referenceImages?: string[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
