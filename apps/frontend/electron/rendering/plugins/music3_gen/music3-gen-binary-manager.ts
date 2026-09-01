/**
 * Music3 mlxserv 配置与二进制管理族——env/profile/config 读写/权重校验/二进制探测安装。
 * 深网二期:ctx(deps/getPaths)注入,体逐字保留。
 */
import fs from "node:fs";
import { dumpSidecarFailure } from "@/electron/diagnostics/sidecar-log-capture";
import path from "node:path";
import type { MlxServConfig } from "./music3-gen-runtime-consts";
import {
  MLXSERV_BINARY_CANDIDATES, MLXSERV_MANAGED_DIR_NAME, MLXSERV_DEFAULT_PORT,
  MLXSERV_REQUIRED_WEIGHTS, MLXSERV_REQUIRED_DIRS, MODEL_HOME, MLXSERV_DOWNLOAD_URL,
} from "./music3-gen-runtime-consts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createMusic3BinaryManager(ctx: any) {
  const { deps, getPaths } = ctx;

  function buildEnv(): NodeJS.ProcessEnv {
    const modelCacheDir = deps.modelCacheDir?.();
    return {
      ...process.env,
      PYTHONPATH: deps.backendRoot,
      ...(modelCacheDir ? { MYSTUDIO_MUSIC3_MODEL_DIR: modelCacheDir } : {}),
    };
  }

  function profileDir(): string {
    return path.join(getPaths().pythonRuntimeDir, "profiles", "music3-gen");
  }

  function progressFile(): string {
    return path.join(profileDir(), "download-progress.json");
  }

  // ---- mlx-serve 路线:配置/完整性/探测/服务器/生成 ----

  const mlxServ: MlxServConfig = loadMlxServConfig();
  const binaryCandidates = deps.binaryCandidates ?? MLXSERV_BINARY_CANDIDATES;

  function mlxServConfigPath(): string {
    return path.join(getPaths().storageBasePath, "music3-mlxserv-config.json");
  }

  function loadMlxServConfig(): MlxServConfig {
    try {
      const raw = JSON.parse(fs.readFileSync(mlxServConfigPath(), "utf8")) as Partial<MlxServConfig>;
      return {
        weightsDir: typeof raw.weightsDir === "string" ? raw.weightsDir : "",
        binaryPath: typeof raw.binaryPath === "string" ? raw.binaryPath : "",
        port: Number.isInteger(raw.port) && (raw.port as number) > 0 ? (raw.port as number) : MLXSERV_DEFAULT_PORT,
        preferredEngine: raw.preferredEngine === "mlxserv" ? "mlxserv" : "pocket",
      };
    } catch {
      return { weightsDir: "", binaryPath: "", port: MLXSERV_DEFAULT_PORT, preferredEngine: "pocket" };
    }
  }

  function saveMlxServConfig(): void {
    try {
      fs.mkdirSync(path.dirname(mlxServConfigPath()), { recursive: true });
      fs.writeFileSync(mlxServConfigPath(), JSON.stringify(mlxServ, null, 2), "utf8");
    } catch {
      // 配置写失败不阻断生成;下次读取回退默认。
    }
  }

  function checkWeightsDir(dir: string): { ready: boolean; reason: string } {
    if (!dir) return { ready: false, reason: "未指定权重目录" };
    let root: fs.Stats;
    try {
      root = fs.statSync(dir);
    } catch {
      return { ready: false, reason: `权重目录不存在: ${dir}` };
    }
    if (!root.isDirectory()) return { ready: false, reason: `权重路径不是目录: ${dir}` };
    if (fs.existsSync(path.join(dir, ".incomplete"))) {
      return { ready: false, reason: `权重目录存在 .incomplete 标记: ${dir}` };
    }
    if (!fs.existsSync(path.join(dir, "config.json"))) {
      return { ready: false, reason: "缺少权重配置 config.json" };
    }
    try {
      if (fs.statSync(path.join(dir, "config.json")).size <= 0) {
        return { ready: false, reason: "权重配置 config.json 为空" };
      }
    } catch {
      return { ready: false, reason: "无法读取权重配置 config.json" };
    }
    for (const name of MLXSERV_REQUIRED_WEIGHTS) {
      const weightPath = path.join(dir, name);
      try {
        if (!fs.statSync(weightPath).isFile() || fs.statSync(weightPath).size <= 0) {
          return { ready: false, reason: `权重文件 ${name} 为空或不是文件` };
        }
      } catch {
        return { ready: false, reason: `缺少权重文件 ${name}(应为 MiniMax-Music3 MLX bf16 转换产物目录)` };
      }
    }
    for (const name of MLXSERV_REQUIRED_DIRS) {
      try {
        if (!fs.statSync(path.join(dir, name)).isDirectory()) {
          return { ready: false, reason: `缺少目录 ${name}/` };
        }
      } catch {
        return { ready: false, reason: `缺少目录 ${name}/` };
      }
    }
    return { ready: true, reason: "" };
  }

  function detectBinary(): string | null {
    if (mlxServ.binaryPath) return fs.existsSync(mlxServ.binaryPath) ? mlxServ.binaryPath : null;
    // MYStudio 管理的自动下载版(优先级最高——用户点「检查运行时」后自动就位)
    const managed = managedBinaryPath();
    if (managed) return managed;
    for (const candidate of binaryCandidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  }

  /** MYStudio 管理的二进制家(<userData>/model/mlx-serve-managed/,08-19 并入 model 规范)。 */
  function managedBinaryHome(): string {
    const base = typeof deps.storageBasePath === "function" ? deps.storageBasePath() : (deps.storageBasePath ?? "");
    return path.join(base, MODEL_HOME, MLXSERV_MANAGED_DIR_NAME);
  }

  /** 旧布局(userData 根/mlx-serve-managed)探测位——仅用于一次性迁移。 */
  function legacyManagedBinaryHome(): string {
    const base = typeof deps.storageBasePath === "function" ? deps.storageBasePath() : (deps.storageBasePath ?? "");
    return path.join(base, MLXSERV_MANAGED_DIR_NAME);
  }

  /**
   * MYStudio 管理的二进制路径;未下载返回 null。
   * 旧布局在场时自动迁移到 model/ 下(同卷 rename;失败则回退旧路径,升级用户零感知)。
   */
  function managedBinaryPath(): string | null {
    const home = managedBinaryHome();
    const bin = path.join(home, "mlx-serve");
    try {
      if (fs.existsSync(bin)) return bin;
      const legacyBin = path.join(legacyManagedBinaryHome(), "mlx-serve");
      if (fs.existsSync(legacyBin)) {
        try {
          fs.mkdirSync(path.dirname(home), { recursive: true });
          fs.renameSync(legacyManagedBinaryHome(), home);
        } catch {
          // 迁移失败(权限/跨卷等):回退旧路径,不阻断生成
        }
        if (fs.existsSync(bin)) return bin;
        return legacyBin;
      }
      return null;
    } catch {
      return null;
    }
  }



  async function installMlxServeBinary(): Promise<{ installed: boolean; path?: string; error?: string }> {
    const dir = managedBinaryHome();
    const bin = path.join(dir, "mlx-serve");
    if (fs.existsSync(bin)) return { installed: true, path: bin };
    if (!deps.storageBasePath) return { installed: false, error: "缺少 storageBasePath" };
    const marker = path.join(dir, ".installing");
    if (fs.existsSync(marker)) return { installed: false, error: "另一进程正在安装" };
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(marker, String(Date.now()));
      const tarPath = path.join(dir, "mlx-serve.tar.gz");
      // 下载(不支持进度——62MB 可接受)
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);
      await execFileAsync("curl", ["-sL", MLXSERV_DOWNLOAD_URL, "-o", tarPath]);
      // 解压(release tar.gz 含顶层 mlx-serve-macos-arm64/ 目录,须剥层否则二进制落在子目录里)
      await execFileAsync("tar", ["-xzf", tarPath, "-C", dir, "--strip-components", "1"]);
      fs.unlinkSync(tarPath);
      // 给执行权限
      fs.chmodSync(bin, 0o755);
      fs.unlinkSync(marker);
      if (!fs.existsSync(bin)) {
        return { installed: false, error: "解压后未找到 mlx-serve 二进制" };
      }
      return { installed: true, path: bin };
    } catch (error) {
      try { fs.unlinkSync(marker); } catch { /* 忽略 */ }
      dumpSidecarFailure({
        module: "music3",
        title: `mlx-serve 二进制安装失败(${MLXSERV_DOWNLOAD_URL})`,
        detail: error instanceof Error
          ? [error.message, (error as { stderr?: string }).stderr].filter(Boolean).join("\n")
          : String(error),
      });
      return { installed: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  return {
    mlxServ, buildEnv, profileDir, progressFile,
    loadMlxServConfig, saveMlxServConfig, checkWeightsDir, detectBinary,
    managedBinaryHome, legacyManagedBinaryHome, managedBinaryPath, installMlxServeBinary,
  };
}
