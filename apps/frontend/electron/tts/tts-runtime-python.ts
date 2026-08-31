/**
 * tts-runtime Python 运行时族——托管 Python 发现/校验/下载解压(HTTPS 源+
 * sha256 校验+tar 穿越防护)与依赖离线证明/安装(marker 哈希)。08-31
 * file-size-reduction 专批拆出,体逐字保留。
 */
import path from "node:path";
import crypto from "node:crypto";
import type { TtsRuntimeInstalledItem, TtsRuntimeStatus } from "@/types/tts";
import type { TtsRuntimeControllerDeps } from "./tts-runtime-shared";
import { defaultPythonDownloadUrl, isValidPythonRuntimeUrl, sha256File } from "./tts-runtime-shared";
import { getErrorMessage, isRecord, parseJsonString } from "./tts-runtime-utils";
import type { TtsRuntimePaths } from "./tts-runtime-paths";

export interface TtsPythonIo {
  fileExists: (filePath: string) => boolean;
  ensureDir: (dirPath: string) => void;
  removeFile: (filePath: string) => void;
  writeBinaryFile: (filePath: string, data: Uint8Array) => void;
  renameFile: (from: string, to: string) => void;
  readTextFile: (filePath: string) => string | null;
  writeTextFile: (filePath: string, text: string) => void;
}
export type TtsPythonExec = {
  runPython: NonNullable<TtsRuntimeControllerDeps["runPython"]>;
  fetchRuntimeArchive: NonNullable<TtsRuntimeControllerDeps["fetchRuntimeArchive"]>;
  extractArchive: NonNullable<TtsRuntimeControllerDeps["extractArchive"]>;
};
export interface TtsPythonHooks {
  updateSetupState: (next: Pick<TtsRuntimeStatus, "setupStage" | "setupMessage" | "setupProgress">) => void;
  setInstalledItem: (item: TtsRuntimeInstalledItem) => void;
  currentSetupProgress: () => number | undefined;
}

export function createTtsRuntimePython(paths: TtsRuntimePaths, io: TtsPythonIo, exec: TtsPythonExec, hooks: TtsPythonHooks) {
  const { fileExists, ensureDir, removeFile, writeBinaryFile, renameFile, readTextFile, writeTextFile } = io;
  const { runPython, fetchRuntimeArchive, extractArchive } = exec;
  const { updateSetupState, setInstalledItem, currentSetupProgress } = hooks;
  const { runtimePythonDir, runtimeArchiveDir, runtimeDataDir, readConfig } = paths;

  function managedPythonExecutablePath(runtimeDir: string) {
    return process.platform === "win32"
      ? path.join(runtimeDir, "python.exe")
      : path.join(runtimeDir, "bin", "python3");
  }

  function getBundledPython(sidecarRoot: string): string | null {
    const pythonPath = managedPythonExecutablePath(sidecarRoot);
    return fileExists(pythonPath) ? pythonPath : null;
  }

  function pythonDownloadUrl(): string | null {
    const config = readConfig();
    // 配置/环境变量下载源必须 HTTPS;非法值不落地执行,回退官方默认源。
    const configuredUrl = config.pythonRuntimeUrl?.trim();
    if (configuredUrl) {
      if (!isValidPythonRuntimeUrl(configuredUrl)) {
        console.warn("[TTS] pythonRuntimeUrl 非 HTTPS，已忽略并回退默认下载源:", configuredUrl.slice(0, 24));
        return defaultPythonDownloadUrl();
      }
      return configuredUrl;
    }
    const override = process.env.MANYING_TTS_PYTHON_RUNTIME_URL?.trim();
    if (override) {
      if (!isValidPythonRuntimeUrl(override)) {
        console.warn("[TTS] MANYING_TTS_PYTHON_RUNTIME_URL 非 HTTPS，已忽略并回退默认下载源");
        return defaultPythonDownloadUrl();
      }
      return override;
    }
    return defaultPythonDownloadUrl();
  }

  function findManagedPython(): string | null {
    return getBundledPython(runtimePythonDir());
  }

  async function validateManagedPython(python: string): Promise<{ success: boolean; error?: string }> {
    try {
      const versionResult = await runPython(python, ["--version"], { timeout: 30_000, maxBuffer: 1024 * 1024 }) as {
        stdout?: string;
        stderr?: string;
      };
      const versionText = `${versionResult.stdout ?? ""}${versionResult.stderr ?? ""}`.trim();
      if (/Python\s+3\.12\./.test(versionText)) return { success: true };
      return { success: false, error: `当前 Python 运行环境不是 Python 3.12: ${versionText || python}` };
    } catch (error) {
      return { success: false, error: `Python 3.12 运行环境校验失败: ${getErrorMessage(error)}` };
    }
  }

  async function findReadyPython(): Promise<{ python?: string; error?: string }> {
    updateSetupState({ setupStage: "checking", setupMessage: "正在检查 Python 运行环境", setupProgress: 0 });
    const managedPython = findManagedPython();
    if (managedPython) {
      const validation = await validateManagedPython(managedPython);
      if (!validation.success) {
        updateSetupState({ setupStage: "failed", setupMessage: "Python 3.12 运行环境校验失败", setupProgress: 0 });
        return { error: validation.error };
      }
      updateSetupState({
        setupStage: "checking",
        setupMessage: "已找到项目存储中的 Python 运行环境",
        setupProgress: 100,
      });
      return { python: managedPython };
    }
    updateSetupState({ setupStage: "failed", setupMessage: "Python 3.12 运行环境未配置", setupProgress: 0 });
    return { error: "请先到设置里的本地配置页的 Python 运行环境区块完成配置" };
  }

  async function ensurePython(): Promise<{ python?: string; error?: string }> {
    updateSetupState({ setupStage: "checking", setupMessage: "正在检查 Python 3.12 运行环境", setupProgress: 0 });
    const managedPython = findManagedPython();
    if (managedPython) {
      const validation = await validateManagedPython(managedPython);
      if (!validation.success) {
        updateSetupState({ setupStage: "failed", setupMessage: "Python 3.12 运行环境校验失败", setupProgress: 0 });
        setInstalledItem({ label: "Python 运行环境", detail: managedPython, status: "failed" });
        return { error: validation.error };
      }
      setInstalledItem({
        label: "Python 运行环境",
        detail: managedPython,
        status: "skipped",
      });
      return { python: managedPython };
    }
    const runtimeDir = runtimePythonDir();
    const url = pythonDownloadUrl();
    if (!url) {
      updateSetupState({ setupStage: "failed", setupMessage: "当前平台不支持自动下载 Python", setupProgress: 0 });
      return { error: `不支持的平台: ${process.platform} ${process.arch}` };
    }
    const archiveDir = runtimeArchiveDir();
    const partialArchive = path.join(archiveDir, "python-runtime.tar.gz.partial");
    const archivePath = path.join(archiveDir, "python-runtime.tar.gz");
    try {
      ensureDir(archiveDir);
      updateSetupState({ setupStage: "downloading-python", setupMessage: "正在下载 Python 运行环境", setupProgress: 0 });
      const res = await fetchRuntimeArchive(url, partialArchive, (progress) => {
        updateSetupState({
          setupStage: "downloading-python",
          setupMessage: "正在下载 Python 运行环境",
          setupProgress: progress.progress,
        });
      });
      if (!res.ok || !res.data) {
        removeFile(partialArchive);
        updateSetupState({ setupStage: "failed", setupMessage: "Python 下载失败", setupProgress: currentSetupProgress() });
        return { error: `下载 Python 失败 (${res.status})` };
      }
      writeBinaryFile(partialArchive, res.data instanceof Uint8Array ? res.data : new Uint8Array(res.data));
      renameFile(partialArchive, archivePath);
      const expectedSha256 = readConfig().pythonRuntimeSha256?.trim().toLowerCase();
      if (expectedSha256) {
        const actualSha256 = await sha256File(archivePath);
        if (actualSha256 !== expectedSha256) {
          removeFile(archivePath);
          updateSetupState({ setupStage: "failed", setupMessage: "Python 运行环境包完整性校验失败", setupProgress: 100 });
          setInstalledItem({ label: "Python 运行环境", detail: runtimeDir, status: "failed" });
          return { error: `Python 运行环境包 sha256 校验失败(期望 ${expectedSha256.slice(0, 12)}…，实际 ${actualSha256.slice(0, 12)}…)` };
        }
      }
      updateSetupState({ setupStage: "extracting-python", setupMessage: "正在配置 Python 仓库", setupProgress: 100 });
      await extractArchive(archivePath, archiveDir);
      removeFile(archivePath);
      const py = getBundledPython(runtimeDir);
      if (!py) {
        updateSetupState({ setupStage: "failed", setupMessage: "Python 解压后未找到可执行文件", setupProgress: 100 });
        setInstalledItem({ label: "Python 运行环境", detail: runtimeDir, status: "failed" });
        return { error: "Python 解压后未找到可执行文件" };
      }
      const validation = await validateManagedPython(py);
      if (!validation.success) {
        updateSetupState({ setupStage: "failed", setupMessage: "Python 3.12 运行环境校验失败", setupProgress: 100 });
        setInstalledItem({ label: "Python 运行环境", detail: py, status: "failed" });
        return { error: validation.error };
      }
      setInstalledItem({ label: "Python 运行环境", detail: py, status: "installed" });
      return { python: py };
    } catch (error) {
      removeFile(partialArchive);
      updateSetupState({ setupStage: "failed", setupMessage: "Python 下载失败", setupProgress: currentSetupProgress() });
      setInstalledItem({ label: "Python 运行环境", detail: runtimeDir, status: "failed" });
      return { error: `Python 下载失败: ${getErrorMessage(error)}` };
    }
  }

  function getDepsPlan(sidecarRoot: string, python: string): {
    reqPath?: string;
    markerPath?: string;
    reqHash?: string;
  } {
    const reqPath = path.join(sidecarRoot, "requirements.txt");
    if (!fileExists(reqPath)) return {};
    const markerPath = path.join(runtimeDataDir(), ".deps-hash");
    const reqContent = readTextFile(reqPath) ?? "";
    const reqHash = crypto.createHash("md5").update(`${python}\n${reqContent}`).digest("hex");
    return { reqPath, markerPath, reqHash };
  }

  function depsAreReady(sidecarRoot: string, python: string) {
    const depsPlan = getDepsPlan(sidecarRoot, python);
    if (!depsPlan.markerPath || !depsPlan.reqHash) return true;
    return readTextFile(depsPlan.markerPath)?.trim() === depsPlan.reqHash;
  }

  function decodePipInstallReport(value: unknown): { install: unknown[] } | null {
    if (!isRecord(value)) return null;
    const install = value.install;
    if (!Array.isArray(install)) return null;
    return { install };
  }

  /**
   * Offline dependency proof for stale/missing markers: pip runs with
   * `--dry-run` (mutates nothing) and `--no-index` (cannot contact any
   * package index); only a structured report whose `install` list is empty
   * counts as satisfied. Malformed output, pending installs, or command
   * failure all fail closed and route to the explicit setup action.
   */
  async function verifyDepsWithoutInstall(reqPath: string, python: string): Promise<boolean> {
    try {
      const result = await runPython(
        python,
        ["-m", "pip", "install", "--dry-run", "--no-index", "--report", "-", "--quiet", "-r", reqPath],
        { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
      ) as { stdout?: string };
      const report = decodePipInstallReport(parseJsonString(result.stdout));
      return report !== null && report.install.length === 0;
    } catch {
      return false;
    }
  }

  async function ensureDeps(sidecarRoot: string, python: string): Promise<{ success: boolean; error?: string }> {
    const { reqPath, markerPath, reqHash } = getDepsPlan(sidecarRoot, python);
    if (!reqPath || !markerPath || !reqHash) return { success: true };
    const installedHash = readTextFile(markerPath);
    if (installedHash?.trim() === reqHash) {
      setInstalledItem({ label: "TTS Python 依赖", detail: reqPath, status: "skipped" });
      return { success: true };
    }
    try {
      updateSetupState({ setupStage: "installing-deps", setupMessage: "正在安装 TTS 依赖", setupProgress: undefined });
      if (process.platform === "win32") {
        // PyPI 默认是 CPU 版 torch，Windows 需从 CUDA 专用 index 安装
        await runPython(python, ["-m", "pip", "install", "torch", "--index-url", "https://download.pytorch.org/whl/cu121"], { timeout: 1_800_000, maxBuffer: 32 * 1024 * 1024 });
      }
      await runPython(python, ["-m", "pip", "install", "-r", reqPath], { timeout: 1_800_000, maxBuffer: 32 * 1024 * 1024 });
      ensureDir(runtimeDataDir());
      writeTextFile(markerPath, reqHash);
      setInstalledItem({ label: "TTS Python 依赖", detail: reqPath, status: "installed" });
    } catch (error) {
      updateSetupState({ setupStage: "failed", setupMessage: "安装 TTS 依赖失败", setupProgress: undefined });
      setInstalledItem({ label: "TTS Python 依赖", detail: reqPath, status: "failed" });
      return { success: false, error: `安装依赖失败: ${getErrorMessage(error)}` };
    }
    return { success: true };
  }

  return {
    managedPythonExecutablePath, getBundledPython, pythonDownloadUrl, findManagedPython,
    validateManagedPython, findReadyPython, ensurePython, getDepsPlan, depsAreReady,
    decodePipInstallReport, verifyDepsWithoutInstall, ensureDeps,
  };
}
