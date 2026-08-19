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

/** mlx-serve 8bit 指向路线(ddalcu/MiniMax-Music3-MLX-Serve-8bit,零拷贝指向已下载目录) */
export interface MlxServConfig {
  weightsDir: string;
  binaryPath: string;
  port: number;
  preferredEngine: "pocket" | "mlxserv";
}

export interface MlxServRuntimeStatus {
  config: MlxServConfig;
  weightsReady: boolean;
  weightsReason: string;
  binaryPath: string | null;
  binaryFound: boolean;
  serverRunning: boolean;
  serverStarting: boolean;
}

/** bf16 权重获取流程状态(ModelScope 全量 → 本地转换;08-19 指向版补权重获取)。 */
export interface MlxServWeightsInstallState {
  status: "idle" | "downloading" | "converting" | "complete" | "error";
  progress: number;
  stage?: string;
  filename?: string;
  error?: string;
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
  /** mlx-serve 8bit 指向路线状态 */
  mlxServ?: MlxServRuntimeStatus;
  /** 权重获取流程状态 */
  mlxServWeightsInstall?: MlxServWeightsInstallState;
  /** 宿主总内存(GB,量化档位门禁依据) */
  hostTotalRamGb?: number;
}

/** bf16 权重获取内存门槛(GB;与主进程 MLXSERV_WEIGHTS_MIN_RAM_BYTES 同参,改动须两处同步)。 */
export const MUSIC3_WEIGHTS_MIN_RAM_GB = 44;

/** 平台×模型矩阵(设置页展示口径;官方 CUDA 路线本应用不代管) */
export const MUSIC3_PLATFORM_MATRIX: ReadonlyArray<{
  platform: string;
  model: string;
  runnable: string;
}> = [
  { platform: "Apple Silicon(macOS arm64)", model: "MiniMax-Music3 8bit 量化系", runnable: "可运行,双路线:应用内下载版(PocketAiHub 自含仓)/指向版(mlx-serve 指向已下载权重)" },
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
