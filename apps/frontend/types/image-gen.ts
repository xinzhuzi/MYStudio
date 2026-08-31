// Renderer-facing types for the local image generation runtime.

export type ImageGenSetupStage =
  | "idle"
  | "checking"
  | "starting-server"
  | "ready"
  | "failed";

export interface ImageGenModelRow {
  modelName: string;
  label: string;
  downloaded: boolean;
  sizeMb: number | null;
  repoId: string;
  /** 指向版专用:大件在而小件缺时 UI 显示「补齐小件」(null=非指向版) */
  pointed?: boolean | null;
  /** 大件实际生效来源:comfyui=指向零下载 / app-cache=应用缓存自足完整下载 / comfyui-service=桥接服务(null=缺大件) */
  bigFilesSource?: "comfyui" | "app-cache" | "comfyui-service" | null;
  comfyuiVersion?: string | null;
  smallPiecesReady?: boolean | null;
  /** 大件实际绝对路径列表(主模型/文本编码器,两源通用),设置页展示用;缺大件为空表 */
  pointedFiles?: string[] | null;
}

export interface ImageGenRuntimeStatus {
  running: boolean;
  setupStage: ImageGenSetupStage;
  setupMessage: string | undefined;
  models: ImageGenModelRow[];
  activeModel: string;
  downloadStatus: Record<string, "idle" | "downloading" | "complete" | "error">;
  downloadProgress: Record<string, number>;
  downloadError: Record<string, string | undefined>;
}
