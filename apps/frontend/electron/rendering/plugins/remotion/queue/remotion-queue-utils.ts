import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canTransitionRemotionStatus, transitionRemotionRenderJob } from "@/lib/studio/remotion/remotion-workspace-state";
import type { RemotionJobError, RemotionRenderJobTarget, RemotionRenderJobV1, RemotionStageStatus } from "@/types/remotion-workspace";
import { RemotionQueuePersistence } from "./remotion-queue-contract";

/**
 * Remotion 队列工具族——目标章判定/身份等价/ready/blocked 状态构造。file-size-reduction P3 拆出,体逐字保留。
 */
export function targetChapterId(target: RemotionRenderJobTarget): string {
  return target.chapterId;
}

export function sameJobIdentity(left: RemotionRenderJobV1, right: RemotionRenderJobV1): boolean {
  return left.projectId === right.projectId
    && JSON.stringify(left.target) === JSON.stringify(right.target)
    && left.inputHash === right.inputHash
    && left.bundleContentHash === right.bundleContentHash
    && left.renderSettingsHash === right.renderSettingsHash;
}

export function asReady(job: RemotionRenderJobV1): RemotionRenderJobV1 {
  if (job.status === "ready") return job;
  if (!canTransitionRemotionStatus(job.status, "ready")) throw new Error(`job ${job.jobId} 不允许恢复 ready`);
  return transitionOrThrow(job, { status: "ready", at: Date.now() });
}

export function asBlocked(job: RemotionRenderJobV1, at: number, error: RemotionJobError): RemotionRenderJobV1 {
  if (job.status === "blocked") return { ...job, error };
  return transitionOrThrow(job, { status: "blocked", at, error });
}

export function asStale(job: RemotionRenderJobV1, at: number, error: RemotionJobError): RemotionRenderJobV1 {
  if (job.status === "stale") return { ...job, error };
  return transitionOrThrow(job, { status: "stale", at, error });
}

export function transitionOrThrow(job: RemotionRenderJobV1, transition: {
  status: RemotionStageStatus;
  at: number;
  error?: RemotionJobError;
  outputPath?: string;
  evidencePath?: string;
}): RemotionRenderJobV1 {
  const result = transitionRemotionRenderJob(job, transition);
  if (!result.success) throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  return result.value;
}

export function invalid(message: string): { accepted: false; reason: "invalid"; message: string } {
  return { accepted: false, reason: "invalid", message };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export async function atomicWrite(filePath: string, content: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  // tmp 名含 pid+随机段：同进程并发原子写不得共用同名（rename 会互抢 ENOENT），
  // 跨进程残留 tmp 也互不干扰；孤儿 tmp 由下次成功写自然覆盖/无害残留。
  const temporaryPath = `${filePath}.${process.pid}-${crypto.randomUUID().slice(0, 8)}.tmp`;
  await fs.promises.writeFile(temporaryPath, content, "utf8");
  await fs.promises.rename(temporaryPath, filePath);
}

export interface RemotionQueuePersistenceRoots {
  /** queue-state.json 所在目录(队列运行态,跟随项目数据根,crash recovery 依赖)。 */
  stateRoot: string;
  /** queue-events.jsonl 所在目录(事件日志,统一归 <userData>/logs/remotion-queue)。 */
  eventsRoot: string;
}

export function createRemotionQueueFilePersistence(roots: RemotionQueuePersistenceRoots): RemotionQueuePersistence {
  for (const [label, value] of [["stateRoot", roots.stateRoot], ["eventsRoot", roots.eventsRoot]] as const) {
    if (!path.isAbsolute(value)) throw new Error(`Remotion queue persistence ${label} 必须是绝对路径`);
  }
  const eventsPath = path.join(roots.eventsRoot, "queue-events.jsonl");
  const snapshotPath = path.join(roots.stateRoot, "queue-state.json");
  // 进程内写互斥（08-20 真机修复）：append 是读改写全量重写，队列 pump/完成回调/
  // enqueue 连发会并发触发——无锁时丢事件+同名 tmp 互抢 rename ENOENT（曾致
  // queue-events.jsonl 出现交错损坏行，load 逐行 JSON.parse 崩→项目切换 IPC 永挂）。
  let writeChain: Promise<unknown> = Promise.resolve();
  function serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = writeChain.then(task, task);
    writeChain = run.then(() => undefined, () => undefined);
    return run;
  }
  return {
    async load() {
      const snapshot = await readOptionalJson(snapshotPath);
      const rawEvents = await readOptionalText(eventsPath);
      const events = rawEvents
        ? rawEvents.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as unknown)
        : [];
      return { snapshot, events };
    },
    async append(event) {
      await serialize(async () => {
        const previous = await readOptionalText(eventsPath) ?? "";
        await atomicWrite(eventsPath, `${previous}${JSON.stringify(event)}\n`);
      });
    },
    async writeSnapshot(snapshot) {
      await serialize(() => atomicWrite(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`));
    },
  };
}

/** 一次性迁移:旧布局事件日志与队列状态同目录;日志统一归位后搬到 logs/。
 * 目标已存在或来源不存在时 no-op;rename 跨卷(EXDEV)回退 copy(tmp+rename 原子
 * 落位,严防半截文件——load 逐行 JSON.parse 撞上即崩,08-20 事故同款死法)。
 * 同步实现:main.ts 在构造队列前调用,杜绝与懒加载 init() 的竞态。 */
export function migrateQueueEventsFileIfNeeded(sourcePath: string, targetPath: string): "moved" | "skipped" {
  if (fs.existsSync(targetPath) || !fs.existsSync(sourcePath)) return "skipped";
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  try {
    fs.renameSync(sourcePath, targetPath);
  } catch (error) {
    if (!isNodeError(error) || error.code !== "EXDEV") throw error;
    const tempPath = `${targetPath}.${process.pid}.migrating`;
    fs.copyFileSync(sourcePath, tempPath);
    fs.renameSync(tempPath, targetPath);
    fs.unlinkSync(sourcePath);
  }
  return "moved";
}

export async function readOptionalText(filePath: string): Promise<string | undefined> {
  try {
    return await fs.promises.readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function readOptionalJson(filePath: string): Promise<unknown | undefined> {
  const raw = await readOptionalText(filePath);
  return raw === undefined ? undefined : JSON.parse(raw) as unknown;
}

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
