/**
 * 分层定位(2026-08-29 迁自 lib/assist/freedom-*,Trellis 08-28-freedom-image-engine-rename 批次 A):
 * 渠道/引擎层——与 image-generator/mikoto-async 同层,服务于所有生图消费方
 * (自由面板/分镜批量/资产生成),不隶属任何单一面板。行为零变更,纯迁移。
 */
/**
 * 生图引擎通用契约(参数/结果)。视频参数(FreedomVideoParams)留在
 * lib/assist/freedom-types.ts,待二期视频链正名时一并迁入。
 */

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

export interface GenerationResult {
  url: string;
  taskId?: string;
  mediaId?: string;
}
