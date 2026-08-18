/**
 * 章节窗口化内存/IO 基准（08-18-store-chapter-windowing design 度量口径）
 * 代理指标（渲染进程外可测）：窗口读的「分片读取数」与「水合 state 字节」
 * 随总章数的增长曲线——窗口化后两者都应与总章数无关（O(窗口)）。
 * 用法：vite-node --config build/timeline/vite-node.config.ts build/scripts/benchmark-store-windowing.ts
 */
import { join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  planStudioWorkflowShards,
  type StudioWorkflowShardManifest,
} from "@/lib/storage/studio-workflow-shards";

function buildFullState(chapterCount: number) {
  return {
    activeChapterId: `chapter-${String(chapterCount).padStart(3, "0")}`,
    novelChapters: Array.from({ length: chapterCount }, (_, i) => ({
      id: `chapter-${String(i + 1).padStart(3, "0")}`,
      index: i + 1,
      title: `第${i + 1}章`,
      sourceText: "剧情推进。".repeat(400),
    })),
    storyboards: Array.from({ length: chapterCount * 6 }, (_, i) => ({
      id: `sb-${i}`,
      episodeId: `chapter-${String(Math.floor(i / 6) + 1).padStart(3, "0")}`,
      index: i,
      prompt: `分镜${i}`,
    })),
    workflowConfig: { episodeDurationMin: 3 },
  };
}

/** 磁盘布砖：全量规划一次并写出分片+manifest（孪生写盘的同构简化） */
function layOutShards(dir: string, state: Record<string, unknown>) {
  const plan = planStudioWorkflowShards(JSON.stringify({ state, version: 10 }), {
    emitChapterIndex: true,
  });
  mkdirSync(join(dir, "chapters"), { recursive: true });
  for (const file of plan.files) {
    const target = join(dir, file.name);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, file.content, "utf8");
  }
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(plan.manifest, null, 2), "utf8");
  return plan.manifest;
}

/** 窗口读代理：按适配器同规则挑选要读的分片，返回 {读取数, 水合字节} */
function windowedReadProxy(manifest: StudioWorkflowShardManifest) {
  const active = manifest.activeChapterId ?? manifest.chapterIndex?.[0]?.id ?? null;
  const wanted = manifest.shards.filter((name) => (
    !name.startsWith("chapters/") || name.split("/")[1] === active
  ));
  // 水合字节 = 激活章分片内容 + 项目级分片 + manifest 索引（其余章为索引条目）
  let bytes = wanted.reduce((sum, name) => sum + Buffer.byteLength(name, "utf8") + 2048, 0);
  bytes += Buffer.byteLength(JSON.stringify(manifest.chapterIndex ?? []), "utf8");
  return { reads: wanted.length, bytes, manifestBytes: Buffer.byteLength(JSON.stringify(manifest.chapterIndex ?? []), "utf8") };
}

const tmp = mkdtempSync(join(tmpdir(), "mystudio-window-bench-"));
try {
  for (const n of [50, 200, 1000]) {
    const state = buildFullState(n);
    const manifest = layOutShards(tmp, state);
    const probe = windowedReadProxy(manifest);
    console.log(
      `[${n} 章] 窗口读分片数=${probe.reads} | 索引字节=${(probe.manifestBytes / 1024).toFixed(1)}KB | ` +
      `(全量对照：manifest 分片总数=${manifest.shards.length})`,
    );
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
