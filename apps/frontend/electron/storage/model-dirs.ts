import path from "node:path";

/**
 * 09-10 模型统一家(用户裁定):全部本地模型住 <storageBase>/comfyui/models/<family>/,
 * 引擎卡「模型」页统一可见。08-19 的 <storageBase>/model/<family>/ 规范就此退役
 * (老目录由 apps/build/scripts/model_dir_unify.py 一次性迁平)。
 * TTS 家的单一拼装源——electron 侧(TTS 运行时/存储面板)与 video-use 插件一律经
 * 此处拼装,勿在调用方重复拼段。(CLI 侧 apps/build 暂留本地拼装,待其并行改动落定后收敛。)
 */
export function ttsModelCacheDir(storageBasePath: string): string {
  return path.join(storageBasePath, "comfyui", "models", "TTS");
}

/** MusicGen BGM weights live in their own HF cache family. */
export function audioModelCacheDir(storageBasePath: string): string {
  return path.join(storageBasePath, "comfyui", "models", "audio");
}

/** SFX weights live in their own cache family even when the model repo is shared. */
export function sfxModelCacheDir(storageBasePath: string): string {
  return path.join(storageBasePath, "comfyui", "models", "sfx");
}

