// Copyright (c) 2025 hotflow2024
/** VLM Review runtime controller — lifecycle + inference scheduling + artifact verification.
 *  沿 upscale-runtime-controller.ts 模式(文件中介 worker CLI + sha256 回验)。 */

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type {
  VlmReviewArtifactV1,
  VlmReviewProbeResult,
  VlmReviewRunPayload,
  VlmDownloadProgress,
} from "../../../../types/contracts/vlm-review-workflow";
import {
  buildVlmReviewProbeArgs,
  buildVlmReviewWorkerArgs,
} from "./vlm-review-runtime";

const execFileAsync = promisify(execFile);
const VLM_RUN_TIMEOUT_MS = 60_000; // 含冷装载(首次 30~60s)

export interface VlmReviewRuntimeConfig {
  pythonExecutable: string;
  backendRoot: string;
  storageBasePath: string;
  resolveProjectFilePath: (url: string) => Promise<string | null>;
}

export class VlmReviewRuntimeController {
  private readonly config: VlmReviewRuntimeConfig;

  constructor(config: VlmReviewRuntimeConfig) {
    this.config = config;
  }

  /** python 子进程公共环境:PYTHONPATH 进 backendRoot,并显式注入 MYSTUDIO_STORAGE_BASE——
   * python 侧 model_cache/downloader 都靠它定位 <storageBase>/model/vlm,此前从未传递,
   * 导致模型下载完成后探测仍恒报 model-not-downloaded(08-28 修)。 */
  private pythonEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      PYTHONPATH: this.config.backendRoot,
      MYSTUDIO_STORAGE_BASE: this.config.storageBasePath,
    };
  }

  async probeReadiness(): Promise<VlmReviewProbeResult> {
    try {
      const { stdout } = await execFileAsync(
        this.config.pythonExecutable,
        buildVlmReviewProbeArgs(),
        { cwd: this.config.backendRoot, env: this.pythonEnv(), timeout: 15_000 },
      );
      const parsed = JSON.parse(stdout.trim()) as Partial<VlmReviewProbeResult>;
      return {
        status: parsed.status === "ready" ? "ready" : "blocked",
        hardwareProfile: parsed.hardwareProfile,
        mlxVlmAvailable: Boolean(parsed.mlxVlmAvailable),
        mlxVlmVersion: parsed.mlxVlmVersion,
        modelDir: parsed.modelDir ?? null,
        code: parsed.code ?? null,
        message: parsed.message ?? null,
      };
    } catch {
      return { status: "blocked", mlxVlmAvailable: false, modelDir: null, code: "probe-failed", message: "VLM 运行时探测失败" };
    }
  }

  async runReview(payload: VlmReviewRunPayload): Promise<VlmReviewArtifactV1> {
    // 解析 project-file:// → 绝对路径
    const generatedAbs = await this.resolvePath(payload.generatedImagePath);
    const refImages = await Promise.all(
      (payload.referenceImages ?? []).map(async (ref) => ({
        ...ref,
        path: (await this.resolvePath(ref.path)) ?? ref.path,
      })),
    );

    const workspaceDir = path.join(this.config.storageBasePath, "profiles", "vlm-review", "runs", `${Date.now()}`);
    await fs.mkdir(workspaceDir, { recursive: true });
    const requestPath = path.join(workspaceDir, "request.json");
    const artifactPath = path.join(workspaceDir, "artifact.json");

    try {
      await fs.writeFile(requestPath, JSON.stringify({ ...payload, generatedImagePath: generatedAbs, referenceImages: refImages }, null, 2));
      const { stdout } = await execFileAsync(
        this.config.pythonExecutable,
        buildVlmReviewWorkerArgs(requestPath, artifactPath),
        { cwd: this.config.backendRoot, env: this.pythonEnv(), timeout: VLM_RUN_TIMEOUT_MS },
      );
      // Read artifact from file (more reliable than stdout for large payloads)
      const artifactRaw = await fs.readFile(artifactPath, "utf-8").catch(() => stdout.trim());
      const artifact = JSON.parse(artifactRaw) as VlmReviewArtifactV1;
      // 回验:projectId/shotId 一致性
      if (artifact.projectId !== payload.projectId || artifact.shotId !== payload.shotId) {
        return this.blocked("artifact-mismatch", "审核产物与请求不匹配(防篡改校验失败)");
      }
      return artifact;
    } catch (error) {
      const stderr = (error as { stderr?: string }).stderr ?? "";
      if (stderr.includes("exit code 2")) {
        // blocked 结果(exit 2 也有完整 artifact)
        try {
          const artifactRaw = await fs.readFile(artifactPath, "utf-8");
          return JSON.parse(artifactRaw) as VlmReviewArtifactV1;
        } catch { /* fall through */ }
      }
      return this.blocked("run-failed", `VLM 审核执行失败: ${String(error).slice(0, 200)}`);
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async getDownloadProgress(progressFile: string): Promise<VlmDownloadProgress> {
    try {
      const raw = await fs.readFile(progressFile, "utf-8");
      return JSON.parse(raw) as VlmDownloadProgress;
    } catch {
      return { status: "idle" };
    }
  }

  // 进度文件路径(下载时由 Python worker 写入,前端轮询读取)
  private downloadProgressFile(): string {
    return path.join(this.config.storageBasePath, "profiles", "vlm-review", "download-progress.json");
  }

  async readDownloadProgress(): Promise<VlmDownloadProgress> {
    return this.getDownloadProgress(this.downloadProgressFile());
  }

  async downloadModel(): Promise<{ success: boolean; error?: string }> {
    const progressFile = this.downloadProgressFile();
    await fs.mkdir(path.dirname(progressFile), { recursive: true });
    try {
      // spawn Python download_model --progress <file>(异步,不 await 完成)
      const { spawn } = await import("node:child_process");
      const child = spawn(
        this.config.pythonExecutable,
        ["-m", "vlm_review.download_model", "--model", "qwen3-vl-8b-instruct-mlx-8bit", "--progress", progressFile],
        { cwd: this.config.backendRoot, env: this.pythonEnv(), stdio: "pipe" },
      );
      child.stderr?.on("data", (data: Buffer) => {
        console.error(`[vlm-review-download] ${data.toString().trim()}`);
      });
      // 不等完成,返回 accepted(前端轮询进度文件)
      return { success: true };
    } catch (error) {
      return { success: false, error: `模型下载启动失败: ${String(error).slice(0, 200)}` };
    }
  }

  async deleteModel(): Promise<{ success: boolean; error?: string }> {
    const modelDir = path.join(this.config.storageBasePath, "model", "vlm");
    try {
      await fs.rm(modelDir, { recursive: true, force: true });
      return { success: true };
    } catch (error) {
      return { success: false, error: `删除模型失败: ${String(error).slice(0, 200)}` };
    }
  }

  private blocked(code: string, message: string): VlmReviewArtifactV1 {
    return {
      schemaVersion: 1, projectId: "", shotId: "", status: "blocked",
      model: "", checks: {}, reasons: [], inferenceMs: 0, inputSha256: "",
      code, message, generatedAt: Date.now(),
    };
  }

  private async resolvePath(inputPath: string): Promise<string> {
    if (inputPath.startsWith("project-file://")) {
      const resolved = await this.config.resolveProjectFilePath(inputPath);
      return resolved ?? inputPath;
    }
    return inputPath;
  }
}
