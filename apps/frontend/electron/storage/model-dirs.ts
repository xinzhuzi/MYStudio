import path from "node:path";

/**
 * 08-19 模型目录规范(用户裁定):模型缓存/权重统一住 <storageBase>/model/<family>/。
 * TTS 家的单一拼装源——electron 侧(TTS 运行时/存储面板)与 video-use 插件一律经
 * 此处拼装,勿在调用方重复拼段。(CLI 侧 apps/build 暂留本地拼装,待其并行改动落定后收敛。)
 */
export function ttsModelCacheDir(storageBasePath: string): string {
  return path.join(storageBasePath, "model", "TTS");
}
