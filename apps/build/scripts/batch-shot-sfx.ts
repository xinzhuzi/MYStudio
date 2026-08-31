/**
 * 批量生成分镜音效并绑入 chapter manifest(本地 MusicGen 引擎,种子确定性)
 *
 * 链路(与工作台「生成音效」按钮同语义,WorkbenchTab.bindShotSfxFromPath 为准):
 *   分镜 sound 描述(去「音效:」前缀)→ sfx_gen.worker 确定性生成 WAV
 *   → RemotionChapterManifestService.writeGeneratedShotAudio(内容寻址落仓+探测)
 *   → 构建 sfx binding(封印)→ manifest revision+1 单次 CAS 写回
 *   → store 分镜 shotAudioBindings 同步回写(写前 CAS 校验,应用勿并发写)。
 *
 * 确定性:同 (prompt, seed, model, device) → 逐字节相同 WAV → sha/bindingId 稳定,
 * 重跑天然幂等(已绑定镜自动跳过)。
 *
 * Usage:
 *   cd apps && MYSTUDIO_SHOT_SFX_BATCH=1 npx vite-node --config build/timeline/vite-node.config.ts \
 *     build/scripts/batch-shot-sfx.ts --project <项目根> [--chapter chapter-001] [--seconds 3] [--dry-run]
 *   --dry-run 只列计划不生成;默认 seconds=3(2~5 钳制,与 worker 同参)。
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { RemotionChapterManifestService } from "@rendering/plugins/remotion/manifest/remotion-chapter-manifest-service";
import {
  createRemotionAudioBindingFingerprint,
  createRemotionChapterManifestFingerprint,
} from "@/lib/studio/remotion/remotion-audio-fingerprint";
import type {
  RemotionChapterManifestV2,
  RemotionImportedAudioV2,
  RemotionShotAudioBindingV2,
} from "@/types/remotion-workspace";
import type { StoryboardItem } from "@/types/studio";
import { probeRenderedMedia } from "../remotion/render-smoke-evidence";
import {
  deriveStorageRoots,
  readStudioWorkflowStoreState,
  resolveProjectDir,
  resolveStorageBasePath,
} from "../timeline/storage-paths";
import { writeStudioWorkflowStore } from "../../frontend/electron/storage/studio-workflow-store-io";
import { sfxModelCacheDir } from "../../frontend/electron/storage/model-dirs";

const execFileAsync = promisify(execFile);
const DEFAULT_SECONDS = 3;

// ────────────────────────────── 纯函数(单测覆盖) ──────────────────────────────

/** 分镜 sound 字段 → 生成提示词:去「音效:」前缀,空白返回 null(该镜跳过) */
export function normalizeSfxPrompt(sound: string | null | undefined): string | null {
  const trimmed = (sound ?? "").trim();
  if (!trimmed) return null;
  return trimmed.replace(/^音效[:：]\s*/, "");
}

/** seed 与 TTS 生成链同约定(41001+index),保证逐镜确定性 */
export function sfxSeedForIndex(index: number): number {
  return 41001 + index;
}

export interface ShotSfxBatchPlanItem {
  shotId: string;
  prompt: string;
  seed: number;
  shotRevision: number;
}

export interface ShotSfxBatchSkip {
  shotId: string;
  reason: "already-bound" | "storyboard-missing" | "sound-empty";
}

export function planShotSfxBatch(input: {
  manifestShots: { shotId: string; revision: number; audioBindings: { role: string }[] }[];
  storyboardsById: Map<string, StoryboardItem>;
}): { targets: ShotSfxBatchPlanItem[]; skipped: ShotSfxBatchSkip[] } {
  const targets: ShotSfxBatchPlanItem[] = [];
  const skipped: ShotSfxBatchSkip[] = [];
  for (const shot of input.manifestShots) {
    if (shot.audioBindings.some((binding) => binding.role === "sfx")) {
      skipped.push({ shotId: shot.shotId, reason: "already-bound" });
      continue;
    }
    const storyboard = input.storyboardsById.get(shot.shotId);
    if (!storyboard) {
      skipped.push({ shotId: shot.shotId, reason: "storyboard-missing" });
      continue;
    }
    const prompt = normalizeSfxPrompt(storyboard.sound);
    if (!prompt) {
      skipped.push({ shotId: shot.shotId, reason: "sound-empty" });
      continue;
    }
    targets.push({
      shotId: shot.shotId,
      prompt,
      seed: sfxSeedForIndex(storyboard.index ?? 0),
      shotRevision: Math.max(1, shot.revision),
    });
  }
  return { targets, skipped };
}

/** 与 WorkbenchTab.bindShotSfxFromPath 逐字同款(封印字段全覆盖) */
export async function buildShotSfxBinding(input: {
  projectId: string;
  chapterId: string;
  shotId: string;
  shotRevision: number;
  imported: RemotionImportedAudioV2;
}): Promise<RemotionShotAudioBindingV2> {
  const binding: RemotionShotAudioBindingV2 = {
    schemaVersion: 2,
    bindingId: `sfx:${input.shotId}:${input.imported.source.contentSha256.slice(0, 16)}`,
    bindingFingerprint: "",
    renderScope: "shot",
    projectId: input.projectId,
    chapterId: input.chapterId,
    shotId: input.shotId,
    shotRevision: input.shotRevision,
    role: "sfx",
    source: input.imported.source,
    sourceFingerprint: input.imported.source.contentSha256,
    sourceDurationUs: input.imported.durationUs,
    sourceStartUs: 0,
    shotStartUs: 0,
    durationUs: input.imported.durationUs,
    volume: 1,
    fadeInUs: 0,
    fadeOutUs: 0,
    envelope: [
      { timeUs: 0, gain: 1 },
      { timeUs: input.imported.durationUs, gain: 1 },
    ],
  };
  binding.bindingFingerprint = await createRemotionAudioBindingFingerprint(binding);
  return binding;
}

// ────────────────────────────── CLI 装配 ──────────────────────────────

export function parseCliArgs(argv: readonly string[]): {
  projectDir?: string;
  chapter?: string;
  seconds: number;
  dryRun: boolean;
} {
  const result: { projectDir?: string; chapter?: string; seconds: number; dryRun: boolean } = {
    seconds: DEFAULT_SECONDS,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--project") result.projectDir = argv[i += 1];
    else if (arg === "--chapter") result.chapter = argv[i += 1];
    else if (arg === "--seconds") result.seconds = Number(argv[i += 1]);
    else if (arg === "--dry-run") result.dryRun = true;
    else throw new Error(`未知参数:${arg}(支持 --project/--chapter/--seconds/--dry-run)`);
  }
  if (!Number.isFinite(result.seconds)) throw new Error("--seconds 必须是数字");
  return result;
}

interface WorkerPaths {
  pythonExecutable: string;
  backendRoot: string;
  modelCacheDir: string;
}

function resolveWorkerPaths(): WorkerPaths {
  const storageBase = resolveStorageBasePath();
  const pythonExecutable = path.join(storageBase, "python", "bin", "python3");
  if (!fs.existsSync(pythonExecutable)) {
    throw new Error(`共享 Python 运行时缺失:${pythonExecutable}(设置页先完成本地配置)`);
  }
  return {
    pythonExecutable,
    backendRoot: path.resolve(import.meta.dirname, "../../backend"),
    modelCacheDir: sfxModelCacheDir(storageBase),
  };
}

async function generateSfxWav(
  worker: WorkerPaths,
  input: { prompt: string; seed: number; seconds: number; outputPath: string },
): Promise<void> {
  const { stdout } = await execFileAsync(
    worker.pythonExecutable,
    [
      "-m", "sfx_gen.worker", "--generate",
      "--prompt", input.prompt,
      "--seed", String(input.seed),
      "--seconds", String(input.seconds),
      "--output", input.outputPath,
    ],
    {
      cwd: worker.backendRoot,
      env: {
        ...process.env,
        PYTHONPATH: worker.backendRoot,
        MYSTUDIO_SFX_MODEL_DIR: worker.modelCacheDir,
      },
      timeout: 5 * 60_000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  const parsed = JSON.parse(stdout || "{}") as { status?: string; code?: string; message?: string };
  if (parsed.status !== "accepted") {
    throw new Error(`音效生成失败: ${parsed.code ?? "unknown"} ${parsed.message ?? ""}`);
  }
}

export async function runShotSfxBatch(argv: readonly string[]): Promise<{
  ok: boolean;
  chapterId: string;
  generated: number;
  skipped: { shotId: string; reason: string }[];
  manifestRevision: number | null;
}> {
  const args = parseCliArgs(argv);
  const projectDir = args.projectDir ? path.resolve(args.projectDir) : resolveProjectDir();
  const chapterId = args.chapter ?? "chapter-001";
  const roots = deriveStorageRoots(projectDir);
  const projectId = roots.projectId;

  const manifestService = new RemotionChapterManifestService({
    projectRootForProject: (pid: string) => {
      if (pid !== projectId) throw new Error(`项目身份不一致: ${pid}`);
      return projectDir;
    },
    probeMedia: async (filePath: string) => {
      const probe = await probeRenderedMedia(filePath);
      return { durationUs: Math.round(probe.duration * 1_000_000), streams: probe.streams };
    },
  });
  const current = await manifestService.read(projectId, chapterId);
  if (!current) throw new Error(`chapter manifest 不存在: ${projectId}/${chapterId}`);

  const snapshot = readStudioWorkflowStoreState(projectDir);
  if (!snapshot) throw new Error("studio-workflow store 不可读");
  const storyboards = snapshot.state.storyboards as StoryboardItem[];
  const plan = planShotSfxBatch({
    manifestShots: current.shots.map((shot) => ({
      shotId: shot.shotId,
      revision: shot.revision,
      audioBindings: shot.audioBindings,
    })),
    storyboardsById: new Map(storyboards.map((item) => [item.id, item])),
  });

  process.stderr.write(
    `[sfx-batch] ${chapterId}: 计划生成 ${plan.targets.length} 镜,跳过 ${plan.skipped.length} 镜`
    + `(${Object.entries(plan.skipped.reduce<Record<string, number>>((acc, s) => {
      acc[s.reason] = (acc[s.reason] ?? 0) + 1;
      return acc;
    }, {})).map(([k, v]) => `${k}:${v}`).join(" ")})\n`,
  );
  if (args.dryRun) {
    for (const target of plan.targets) {
      process.stderr.write(`  [dry-run] ${target.shotId} seed=${target.seed} prompt=${target.prompt.slice(0, 40)}\n`);
    }
    return { ok: true, chapterId, generated: 0, skipped: plan.skipped, manifestRevision: null };
  }

  const worker = resolveWorkerPaths();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "sfx-batch-"));
  const bindingsByShot = new Map<string, RemotionShotAudioBindingV2>();
  let generated = 0;
  try {
    for (const target of plan.targets) {
      const wavPath = path.join(workDir, `${target.shotId}.wav`);
      const startedAt = Date.now();
      await generateSfxWav(worker, {
        prompt: target.prompt,
        seed: target.seed,
        seconds: args.seconds,
        outputPath: wavPath,
      });
      const imported = await manifestService.writeGeneratedShotAudio({
        projectId,
        chapterId,
        shotId: target.shotId,
        role: "sfx",
        extension: "wav",
        bytes: fs.readFileSync(wavPath),
      });
      bindingsByShot.set(
        target.shotId,
        await buildShotSfxBinding({
          projectId,
          chapterId,
          shotId: target.shotId,
          shotRevision: target.shotRevision,
          imported,
        }),
      );
      generated += 1;
      process.stderr.write(
        `[sfx-batch] ${target.shotId} ✓ ${(Date.now() - startedAt) / 1000}s sha=${imported.source.contentSha256.slice(0, 12)} (${generated}/${plan.targets.length})\n`,
      );
    }
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }

  const next: RemotionChapterManifestV2 = {
    ...current,
    revision: current.revision + 1,
    updatedAt: Date.now(),
    shots: current.shots.map((shot) => bindingsByShot.has(shot.shotId)
      ? {
        ...shot,
        audioBindings: [
          ...shot.audioBindings.filter((binding) => binding.role !== "sfx"),
          bindingsByShot.get(shot.shotId)!,
        ],
      }
      : shot),
    manifestFingerprint: "",
  };
  next.manifestFingerprint = await createRemotionChapterManifestFingerprint(next);
  const writeResult = await manifestService.writeCas({
    projectId,
    chapterId,
    expectedRevision: current.revision,
    manifest: next,
  });
  if (writeResult.status !== "written") {
    throw new Error(`manifest CAS 写入失败: ${JSON.stringify(writeResult)}`);
  }

  // store 回写:写前 CAS 校验(批期间应用不得并发写 store)
  const latest = readStudioWorkflowStoreState(projectDir);
  if (!latest) throw new Error("studio-workflow store 写回前不可读");
  const nextStoryboards = (latest.state.storyboards as StoryboardItem[]).map((storyboard) => {
    const binding = bindingsByShot.get(storyboard.id);
    if (!binding) return storyboard;
    return {
      ...storyboard,
      shotAudioBindings: [
        ...(storyboard.shotAudioBindings ?? []).filter((item) => item.role !== "sfx"),
        binding,
      ],
    };
  });
  const writeStoreResult = writeStudioWorkflowStore(
    roots.dataRoot,
    projectId,
    JSON.stringify({
      state: { ...latest.state, storyboards: nextStoryboards },
      version: latest.version,
    }),
  );
  process.stderr.write(`[sfx-batch] manifest r${current.revision}→r${next.revision};store 分片写回 ${writeStoreResult.shardNames.length} 片\n`);

  return {
    ok: true,
    chapterId,
    generated,
    skipped: plan.skipped,
    manifestRevision: next.revision,
  };
}

const isDirectExecution = process.env.MYSTUDIO_SHOT_SFX_BATCH === "1"
  || (process.argv[1]
    ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
    : false);
if (isDirectExecution) {
  void runShotSfxBatch(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
  }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
