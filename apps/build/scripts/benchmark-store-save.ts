/**
 * store 保存 CPU 基准（08-18-store-cpu-incremental design §6）
 * 用法：vite-node --config build/timeline/vite-node.config.ts build/scripts/benchmark-store-save.ts
 * 输出：全量规划 vs 增量规划的中位耗时（改 1 章保存场景），数值记入任务 notes。
 */
import {
  planStudioWorkflowShards,
  type StudioWorkflowDomainGeneration,
} from "@/lib/storage/studio-workflow-shards";

function buildSyntheticLive(chapterCount: number) {
  const novelChapters = Array.from({ length: chapterCount }, (_, i) => ({
    id: `chapter-${String(i + 1).padStart(3, "0")}`,
    index: i + 1,
    title: `第${i + 1}章`,
    sourceText: "剧情推进。".repeat(500), // ~2KB/章
    eventSummary: `事件${i + 1}`,
  }));
  const storyboards = Array.from({ length: chapterCount * 6 }, (_, i) => ({
    id: `sb-${i}`,
    episodeId: `chapter-${String(Math.floor(i / 6) + 1).padStart(3, "0")}`,
    index: i,
    prompt: `分镜提示词${i}：画面描述与镜头语言要点`,
    line: `台词${i}`,
  }));
  const mediaTasks = Array.from({ length: chapterCount * 4 }, (_, i) => ({
    id: `task-${i}`,
    kind: "storyboardImage",
    targetId: `sb-${i}`,
    episodeId: `chapter-${String(Math.floor(i / 4) + 1).padStart(3, "0")}`,
    status: "success",
  }));
  return {
    novelChapters,
    storyboards,
    mediaTasks,
    materials: Array.from({ length: 40 }, (_, i) => ({ id: `m-${i}`, name: `素材${i}`, localPath: `/a/${i}`, size: 1 })),
    workflowConfig: { autoAnalyzeEventsOnImport: false, episodeDurationMin: 3 },
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function run(label: string, chapterCount: number) {
  const live = buildSyntheticLive(chapterCount);
  const envelopeBytes = () => Buffer.byteLength(JSON.stringify({ state: live, version: 10 }));

  // 场景 A：全量规划（现状路径），改 1 章后整体重规划 ×10
  const fullTimes: number[] = [];
  for (let i = 0; i < 10; i += 1) {
    (live.novelChapters as Array<{ title: string }>)[3]!.title = `第4章改${i}`;
    const value = JSON.stringify({ state: live, version: 10 });
    const start = performance.now();
    planStudioWorkflowShards(value);
    fullTimes.push(performance.now() - start);
  }

  // 场景 B：增量规划，改 1 章（新数组引用=不可变更新）×10
  const itemCache = new WeakMap<object, string>();
  const domainCache = new Map<string, StudioWorkflowDomainGeneration>();
  const incrementalTimes: number[] = [];
  let incrementalStats = { serializedItems: 0, reusedItems: 0 };
  for (let i = 0; i < 10; i += 1) {
    const chapters = [...(live.novelChapters as object[])];
    chapters[3] = { ...(chapters[3] as { title: string }), title: `第4章增改${i}` };
    (live as { novelChapters: object[] }).novelChapters = chapters;
    const value = JSON.stringify({ state: live, version: 10 });
    const start = performance.now();
    const plan = planStudioWorkflowShards(value, { getLiveState: () => live, itemCache, domainCache });
    incrementalTimes.push(performance.now() - start);
    incrementalStats = plan.stats;
  }

  const kb = (envelopeBytes() / 1024).toFixed(0);
  console.log(
    `[${label}] ${chapterCount} 章 envelope=${kb}KB | ` +
    `全量中位=${median(fullTimes).toFixed(1)}ms | 增量中位=${median(incrementalTimes).toFixed(1)}ms | ` +
    `末轮 stats: 序列化=${incrementalStats.serializedItems} 复用=${incrementalStats.reusedItems}`,
  );
}

run("100 章", 100);
run("500 章", 500);
