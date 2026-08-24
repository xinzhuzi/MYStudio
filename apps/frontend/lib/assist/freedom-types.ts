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
  /**
   * 传输形态(08-24 结构修复:API 成功但图片 URL 下载 504 会直接丢图):
   * "chat"=绕过智能路由直走 chat/completions 形态,base64 data-URL 直返、
   * 不经 CDN——供调用方在「images 端点成功、URL 落盘失败」后无损重试。
   * 缺省 auto=按模型元数据智能路由(行为不变)。
   */
  transport?: "auto" | "chat";
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
