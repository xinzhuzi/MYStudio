/**
 * 章节作业铸造（一次性恢复工具，08-17 precedent：queue 复活 chapter job）
 * 从 editing.json 当前工程 + studio-workflow-store shotFx + 队列最新分镜作业，
 * 构造 queued 状态的 chapter 队列条目并写回 queue-state.json（应用需退出）。
 * 运行: vite-node --config build/timeline/vite-node.config.ts build/scripts/craft-chapter-job.ts
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { compileTimelineRenderPlan } from "@/lib/studio/editing/timeline-render-compiler";
import { mergeShotFxEditingEffects } from "@/lib/studio/remotion/shot-fx-decisions";
import { readRemotionCurrentShotSlotsFromWorkspace } from "@/lib/studio/remotion/remotion-current-slot";
import { createRemotionRenderJobId } from "@/lib/studio/remotion/remotion-job-identity";
import { createReadyRemotionChapterJob } from "@rendering/plugins/remotion/renderer/remotion-chapter-renderer";
import type { RemotionChapterManifestV2 } from "@/types/remotion-workspace";
import type { EditingProjectV1 } from "@/types/editing";

const MA = "/Users/zhengbingjin/Project/IP/MA";
const QUEUE = "/Users/zhengbingjin/Library/Application Support/漫影工作室/projects/_remotion/queue/queue-state.json";
const CHAPTER_ID = "chapter-001";
const PROJECT_ID = "49dce4c1-64b1-42de-85c2-9f266698aec4";

function sha256File(p: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}
function sha256Json(v: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");
}

async function main() {
  const now = Date.now();
  // 1. editing 工程（当前 revision）
  const editing = JSON.parse(fs.readFileSync(path.join(MA, "editing.json"), "utf8"));
  const state = editing.state ?? editing;
  const projects = state.editingProjects ?? {};
  const projectEntry = Object.values<Record<string, unknown>>(projects)
    .find((p) => p.episodeId === CHAPTER_ID) as unknown as EditingProjectV1 | undefined;
  if (!projectEntry) throw new Error("editing 工程未找到");
  console.log("editing rev:", projectEntry.revision);

  // 2. 编译 plan
  const jobId = `studio-${PROJECT_ID}-${CHAPTER_ID}-r${projectEntry.revision}`;
  const compiled = compileTimelineRenderPlan(projectEntry, {
    jobId,
    createdAt: Date.now(),
  });
  if (!compiled.success) {
    throw new Error("编译失败: " + compiled.issues.map((i) => `${i.path}: ${i.message}`).join("; "));
  }
  let plan = compiled.value;

  // 3. shotFx 合并（plan.effects 正门）
  // 分片 store(studio-workflow/ 目录, 08-18 起新形态)
  // store 布局 v1:已迁移项目分片在 store/studio-workflow(08-18-project-store-layout)
  const shardDir = path.join(
    fs.existsSync(path.join(MA, "store")) ? path.join(MA, "store") : MA,
    "studio-workflow",
  );
  const storyboards: unknown[] = [];
  for (const shard of fs.readdirSync(shardDir).filter((f) => f.startsWith("storyboards-") && f.endsWith(".json"))) {
    const d = JSON.parse(fs.readFileSync(path.join(shardDir, shard), "utf8"));
    const list = (d.state ?? d).storyboards ?? (Array.isArray(d) ? d : []);
    if (Array.isArray(list)) storyboards.push(...list);
  }
  const merged = mergeShotFxEditingEffects(plan.effects, {
    planClips: plan.clips as never,
    storyboards: storyboards as never,
  });
  plan = { ...plan, effects: merged.effects };
  console.log("plan.effects:", plan.effects.length, "(motion", merged.counts.motion, "shake", merged.counts.shake, "glow", merged.counts.glow, "chroma", merged.counts.chroma, ")");

  // 4. 队列：最新 43 个 shot 作业 → slots + 依赖 + 新 bundle 哈希
  const queueState = JSON.parse(fs.readFileSync(QUEUE, "utf8"));
  const items = (queueState.state ?? queueState).jobs ?? [];
  const shotByShotId = new Map<string, Record<string, any>>();
  for (const it of items) {
    const job = it?.job;
    if (job?.target?.kind === "shot" && job.status === "succeeded") {
      shotByShotId.set(job.target.shotId, job); // 后写覆盖=最新
    }
  }
  console.log("最新分镜作业:", shotByShotId.size);

  const dependencyJobIds: string[] = [];
  let bundleContentHash = "";
  let templateVersion = "";
  let remotionVersion = "";
  const slots = await readRemotionCurrentShotSlotsFromWorkspace(
    path.join(MA, "remotion"), PROJECT_ID, CHAPTER_ID,
  );
  console.log("工作区 current slots:", slots.length);
  for (const [shotId, job] of shotByShotId) {
    dependencyJobIds.push(job.jobId);
    bundleContentHash = job.bundleContentHash ?? bundleContentHash;
    templateVersion = job.templateVersion ?? templateVersion;
    remotionVersion = job.remotionVersion ?? remotionVersion;
  }
  if (slots.length === 0) throw new Error("工作区无 current slot");
  if (!bundleContentHash) throw new Error("无分镜作业可引用");

  // 5. 真实 identity + ready 作业（复用渲染器自己的构造函数）
  const manifest = JSON.parse(
    fs.readFileSync(path.join(MA, "remotion/chapters", CHAPTER_ID + ".json"), "utf8"),
  ) as RemotionChapterManifestV2;
  const job = await createReadyRemotionChapterJob({
    plan,
    currentShotSlots: slots as never,
    chapterManifest: manifest,
    bundleContentHash,
    templateVersion,
    remotionVersion,
    now: Date.now(),
  });
  const entry = { kind: "chapter", job, dependencyJobIds, plan, currentShotSlots: slots };

  // 6. 备份并写回（去掉旧 chapter 条目避免重复）
  fs.copyFileSync(QUEUE, QUEUE + ".bak-craft-" + now);
  const kept = items.filter((it: Record<string, any>) => it?.job?.target?.kind !== "chapter");
  (queueState.state ?? queueState).jobs = [...kept, entry];
  fs.writeFileSync(QUEUE, JSON.stringify(queueState));
  console.log("已注入 chapter 作业:", job.jobId.slice(0, 30), "deps:", dependencyJobIds.length, "slots:", slots.length, "status:", job.status);
  console.log("effects 样例:", JSON.stringify(plan.effects.slice(0, 2), null, 1).slice(0, 400));
}

void main();
