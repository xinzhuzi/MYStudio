// Renderer-facing types for the MiniMax-Music3 runtime (08-19-minimax-music3-engine).

export type Music3GenSetupStage = "idle" | "checking" | "ready" | "failed";

/** 整曲域 10-300s(与后端钳制同参) */
export const MUSIC3_MIN_DURATION_S = 10;
export const MUSIC3_MAX_DURATION_S = 300;

export interface Music3GenModelRow {
  modelName: string;
  label: string;
  downloaded: boolean;
  sizeMb: number | null;
  repoId: string;
  /** 平台×硬件门控(08-19):不同平台按硬件选择不同模型 */
  availability: "ok" | "unsupported";
  unsupportedReason?: string;
}

export interface Music3HardwareProfile {
  platform: string;
  machine: string;
  mlxImportable: boolean;
}

export interface Music3GenRuntimeStatus {
  setupStage: Music3GenSetupStage;
  setupMessage: string | undefined;
  models: Music3GenModelRow[];
  downloadStatus: "idle" | "downloading" | "complete" | "error";
  downloadProgress: number;
  downloadError: string | undefined;
  modelCacheDir?: string;
  /** 最近一次 probe 的宿主硬件画像(平台门控依据) */
  hardwareProfile?: Music3HardwareProfile;
}

/** 平台×模型矩阵(设置页展示口径;官方 CUDA 路线本应用不代管) */
export const MUSIC3_PLATFORM_MATRIX: ReadonlyArray<{
  platform: string;
  model: string;
  runnable: string;
}> = [
  { platform: "Apple Silicon(macOS arm64)", model: "MiniMax-Music3-MLX 自含仓", runnable: "可运行(本应用自动匹配)" },
  { platform: "NVIDIA Linux/Windows(2× CUDA)", model: "官方仓 SGLang-Omni 路线", runnable: "本应用不提供,官方仓自行部署" },
  { platform: "Intel Mac / 无 GPU", model: "无可用整曲模型", runnable: "不可用" },
];

export interface Music3GenGenerateResult {
  status: "accepted" | "blocked";
  outputPath?: string;
  outputSha256?: string;
  durationS?: number;
  samplingRate?: number;
  seed?: number;
  code?: string;
  message?: string;
}
