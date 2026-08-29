/**
 * 自由面板类型(视频侧)。图片参数/结果已迁 lib/ai/generation-types
 * (08-28-freedom-image-engine-rename 批次 A),此处再导出保旧引用兼容;
 * FreedomVideoParams 待二期视频链正名时迁入引擎层。
 */
import type { FreedomVideoUploadFile } from './video-upload-validation';

export type { FreedomImageParams, GenerationResult } from '@/lib/ai/generation-types';

export interface FreedomVideoParams {
  prompt: string;
  model?: string;
  aspectRatio?: string;
  duration?: number;
  resolution?: string;
  uploadFiles?: FreedomVideoUploadFile[];
}
