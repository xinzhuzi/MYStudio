import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { Agent } from "undici";

/**
 * Music3 生成引擎常量与工具——时长窗/超时/mlxserv 端口与权重布局/构建 WAV 名。file-size-reduction P3 拆出,体逐字保留。
 */
// MiniMax-Music3 (MLX) runtime controller — whole-song BGM engine.
// Same explicit-download policy as audio-gen/sfx-gen: the ~28.5 GB bf16 weight pack
// downloads ONLY from the settings panel; generation fails closed with
// "model-not-downloaded" otherwise. Generation is minutes-scale (whole song),
// so the IPC timeout is generous and progress is user-observable via exports.


export const execFileAsync = promisify(execFile);

/**
 * 产物 wav 命名(单曲文件夹,08-21):带 songName 时用「<曲名>-seed<种子>-<时间戳>」
 * (IPC 层已净化曲名并建好 <音乐根>/<曲名>/ 子目录);无 songName 维持
 * 「<前缀>-<时间戳>-<种子>」旧行为,存量平铺产物命名不漂移。
 */
export function buildWavName(prefix: string, seed: number, songName?: string): string {
  return songName ? `${songName}-seed${seed}-${Date.now()}.wav` : `${prefix}-${Date.now()}-${seed}.wav`;
}

/** 与 backend/music3_gen/worker.py 的钳制保持同参(整曲域 10-300s) */
export const MUSIC3_MIN_DURATION_S = 10;
export const MUSIC3_MAX_DURATION_S = 300;
/** 整曲生成为分钟级;给足执行窗口(backend 硬限 30min,这里同参) */
export const MUSIC3_GENERATE_TIMEOUT_MS = 30 * 60_000;

/**
 * 长任务专用 fetch:整曲生成是分钟级慢响应(实测 162s 曲目 21.3min 才回响应头),
 * 全局 fetch 的 undici 默认 headersTimeout=300s 会在响应头到达前掐断请求——
 * AbortSignal 给再宽也管不到它。此 Agent 放宽 headersTimeout 至生成窗口之上;
 * 与 undici 自家 fetch 同实例配对使用,避免跨副本 dispatcher 符号不兼容。
 */
export const LONG_JOB_AGENT = new Agent({
  headersTimeout: MUSIC3_GENERATE_TIMEOUT_MS + 60_000,
  bodyTimeout: 0,
});

// ---- mlx-serve 指向引擎路线(08-19-music3-mlxserv-connector)----
// 指向本地已转换的 MiniMax-Music3 MLX bf16 权重目录(布局同 convert_music3_weights.py 产物)
// (Zig+MLX,OpenAI 兼容 HTTP)。零 Python、零权重拷贝:直接指向已下载目录。
export const MLXSERV_DEFAULT_PORT = 11273; // MYStudio 专用端口(避开 MLX Core 常用 11234)
export const MLXSERV_HEALTH_TIMEOUT_MS = 5 * 60_000; // 28.5GB bf16 冷装载预算
export const MLXSERV_IDLE_SHUTDOWN_MS = 10 * 60_000;
export const MLXSERV_REQUIRED_WEIGHTS = [
  "language_model.safetensors",
  "rvq_depth_decoder.safetensors",
  "transformer.safetensors",
  "condition_encoder.safetensors",
  "vocoder.safetensors",
] as const;
export const MLXSERV_REQUIRED_DIRS = ["tokenizer", "music_tokenizer"] as const;
export const MLXSERV_BINARY_CANDIDATES = [
  "/opt/homebrew/bin/mlx-serve",
  "/usr/local/bin/mlx-serve",
];
/** 模型/引擎统一家 <userData>/model/(08-19 用户裁定规范;minimax 权重与 mlx-serve 引擎皆居此)。 */
export const MODEL_HOME = "model";
/** minimax 家:与 MODEL_HOME 同源拼接。 */
export const MLXSERV_WEIGHTS_HOME = path.join(MODEL_HOME, "minimax");
export const MLXSERV_WEIGHTS_STAGING = ".staging-music3-full";
export const MLXSERV_WEIGHTS_PACK = "music3-mlxserv-bf16";
/** bf16 档推理内存门槛(实测常驻 34.9GB,留系统余量;防「下完 28.5GB 到生成才爆内存」)。 */
export const MLXSERV_WEIGHTS_MIN_RAM_BYTES = 44 * 1024 ** 3;
/** MYStudio 管理的 mlx-serve 二进制(自动下载到插件目录;2026-08-19 用户裁定:开箱即用不依赖 brew)。 */
export const MLXSERV_DOWNLOAD_URL = "https://github.com/ddalcu/mlx-serve/releases/download/v26.8.9/mlx-serve-bin-macos-arm64.tar.gz";
export const MLXSERV_MANAGED_DIR_NAME = "mlx-serve-managed";

export interface MlxServConfig {
  /** 已下载的 MLX bf16 权重目录(MiniMax-Music3 MLX 转换产物) */
  weightsDir: string;
  /** 空 = 自动探测(PATH / homebrew 常规位) */
  binaryPath: string;
  port: number;
  /** 首选引擎:pocket(PocketAiHub 下载版)/ mlxserv(指向版) */
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

/** bf16 权重获取流程状态(ModelScope 全量 → 本地转换;后端进度文件驱动)。 */
export interface MlxServWeightsInstallState {
  status: "idle" | "downloading" | "converting" | "complete" | "error";
  progress: number;
  stage?: string;
  filename?: string;
  error?: string;
}

export type Music3GenSetupStage = "idle" | "checking" | "ready" | "failed";

export interface Music3GenModelRow {
  modelName: string;
  label: string;
  downloaded: boolean;
  sizeMb: number | null;
  repoId: string;
  /** 平台×硬件门控(08-19):不同平台按硬件选择不同模型 */
  availability: "ok" | "unsupported";
  unsupportedReason?: string;
  /** Python probe 识别出的实际缓存布局与执行入口。 */
  layout?: "mlxserv" | "pocket";
  modelDir?: string;
  engine?: "mlx-serve" | "pocket";
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
  /** MiniMax-Music3 下载版模型实际落盘目录(独立于 TTS/MusicGen/SFX),供设置页展示+打开 */
  modelCacheDir?: string;
  /** 最近一次 probe 的宿主硬件画像(平台门控依据) */
  hardwareProfile?: Music3HardwareProfile;
  /** mlx-serve 指向路线状态(08-19-music3-mlxserv-connector) */
  mlxServ?: MlxServRuntimeStatus;
  /** 权重获取流程状态(08-19:指向版补权重获取,bf16 单一规格) */
  mlxServWeightsInstall?: MlxServWeightsInstallState;
  /** 宿主总内存(GB,bf16 权重内存门禁依据) */
  hostTotalRamGb?: number;
}

export interface ControllerDeps {
  storageBasePath: string | (() => string);
  backendRoot: string;
  modelCacheDir?: () => string;
  spawnProcess?: typeof spawn;
  execFileFn?: ExecFileLike;
  /** 注入以便单测;默认全局 fetch(Node 18+) */
  fetchFn?: typeof fetch;
  /** 覆盖探测候选(单测);默认 MLXSERV_BINARY_CANDIDATES */
  binaryCandidates?: readonly string[];
  /** 覆盖健康等待预算(单测);默认 MLXSERV_HEALTH_TIMEOUT_MS */
  healthTimeoutMs?: number;
  /** 覆盖宿主内存探测(单测);默认 os.totalmem() */
  totalMemBytes?: () => number;
}

type ExecFileLike = (
  file: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout: number; maxBuffer: number },
) => Promise<{ stdout?: string; stderr?: string }>;

export interface Music3GenGenerateResult {
  status: "accepted" | "blocked";
  outputPath?: string;
  outputSha256?: string;
  durationS?: number;
  samplingRate?: number;
  seed?: number;
  /** 生成路线:pocket(PocketAiHub 脚本)/ mlx-serve(HTTP) */
  engine?: "pocket" | "mlx-serve";
  code?: string;
  message?: string;
}

export interface ProbePayload {
  status?: string;
  model?: string;
  depsOk?: boolean;
  sizeMb?: number | null;
  hardware?: { platform?: string; machine?: string; mlxImportable?: boolean };
  availability?: { available?: boolean; reason?: string };
  layout?: "mlxserv" | "pocket";
  modelDir?: string;
  engine?: "mlx-serve" | "pocket";
}

