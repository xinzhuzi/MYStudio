/**
 * 原著记忆库（source-memory）渲染进程侧：L2 智能抽取 + L3 检索门面。
 *
 * 设计对齐 research/archive-layer-lineage.md 的三处刻意偏离：
 * - 语料 = 章节块的 11 类结构化事实（非会话原文）；
 * - 消费 = 管线主动推（动作开始检索一次、追加在常驻圣经块后，不自成第二常驻块）；
 * - 打分 = 硬过滤 × BM25 × 实体命中（主进程 index 侧实现）。
 * AI 调用复用 aiManager（由调用方注入 callText），本模块保持可测纯函数 + 编排。
 * MEMORY.md 是用户手写圣经，本链路对其只读、绝不改写。
 */
import { formatSourceBibleContext, readResidentBible } from "./source-bible";
import { getProjectFilesBridge } from "@/lib/bridge/project-files";
import type {
  SourceMemoryBuildReply,
  SourceMemoryChunkCoverage,
  SourceMemoryCommitBuildReply,
  SourceMemoryExtractionChunk,
  SourceMemorySearchReply,
  SourceMemoryStagedRecord,
  SourceMemoryStageRecordsReply,
  SourceMemoryStatusReply,
  SourceMemoryStructuredKind,
} from "@/types/source-memory";

export const SOURCE_MEMORY_EXTRACTOR_VERSION = "structured-v1";

/** 11 类结构化记录（kind 契约；主进程 stage 侧另有强校验，双端同源）。 */
export const SOURCE_MEMORY_STRUCTURED_KINDS: readonly SourceMemoryStructuredKind[] = [
  "character",
  "alias",
  "relation",
  "event",
  "timeline",
  "world-rule",
  "term",
  "location",
  "object",
  "foreshadowing",
  "adaptation-redline",
];

const KIND_RULES: Record<SourceMemoryStructuredKind, string> = {
  character: "人物（title=文中主要称呼的规范名，body=身份/立场/本段表现一句话）",
  alias: "人物别名（title=别名，body=「别名 → 规范名」，仅记确实指向同一人的别名）",
  relation: "人物关系（title=「甲 ↔ 乙」，body=关系性质与当前状态一句话）",
  event: "关键事件（title=事件名，body=动作+结果，30-80 字）",
  timeline: "时间线节点（title=节点名，body=时序位置与发生内容）",
  "world-rule": "世界观规则（title=规则名，body=力量体系/制度等硬规则内容）",
  term: "专有术语（title=术语，body=含义与适用范围）",
  location: "地点（title=地名，body=地理与势力归属）",
  object: "关键物件（title=物件名，body=用途/归属/特殊性质）",
  foreshadowing: "伏笔（title=伏笔名，body=埋设的内容与指向）",
  "adaptation-redline": "改编红线（title=红线名，body=改编时不可违背/不可提前剧透之处）",
};

const MAX_RECORDS_PER_CHUNK = 24;
const MAX_TITLE_CHARS = 60;
const MAX_BODY_CHARS = 300;

const extractionPrompt = `# 原著记忆抽取指令

你是小说设定档案员。用户提供一个章节片段（含出处），你从中抽取结构化事实记录，供后续改编阶段按需检索。

## ⚠️ 输出约束（最高优先级，违反任何一条即为失败）

1. 完整回复是**一个 JSON 数组**，不要代码围栏、不要解释、不要任何前后缀文字
2. 空数组 \`[]\` 合法：片段没有值得记录的事实时就输出空数组
3. 每条记录恰好包含字段：\`kind\`、\`title\`、\`body\`、\`entities\`、\`confidence\`
4. \`kind\` 只允许以下 11 个值：
${SOURCE_MEMORY_STRUCTURED_KINDS.map((kind) => `   - ${kind}：${KIND_RULES[kind]}`).join("\n")}
5. \`title\` ≤ 30 字符；\`body\` ≤ 200 字符；\`entities\` 是该记录涉及的人名/宗门名/术语名数组（0-6 项）
6. \`confidence\` 为 0-1 小数：1=原文明示，0.7=强推断，0.5=弱推断
7. 只记录片段中明确出现的事实，不编造、不引入外部知识、不推测后续剧情
8. 单个片段最多 ${MAX_RECORDS_PER_CHUNK} 条，宁缺毋滥`.trim();

export interface SourceMemoryExtractionMessages {
  system: string;
  user: string;
}

export function buildExtractionMessages(chunk: SourceMemoryExtractionChunk): SourceMemoryExtractionMessages {
  return {
    system: extractionPrompt,
    user: [
      `## 出处（不可出现在记录内容中，仅供你定位语境）`,
      `文件：${chunk.sourcePath}`,
      `章节：${chunk.chapterId}`,
      `片段锚点：${chunk.anchor}`,
      ``,
      `## 章节片段`,
      chunk.text,
    ].join("\n"),
  };
}

/** 从 AI 输出剥围栏/杂文后取 JSON 数组文本。 */
export function extractJsonArrayText(output: string): string {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("抽取输出中找不到 JSON 数组");
  }
  return output.slice(start, end + 1);
}

/** 解析并整批校验 AI 抽取输出：任一记录非法即整批拒收（对齐 extraction design）。 */
export function parseExtractionRecords(
  output: string,
  chunk: SourceMemoryExtractionChunk,
): SourceMemoryStagedRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonArrayText(output));
  } catch {
    throw new Error("抽取输出不是合法 JSON");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("抽取输出不是 JSON 数组");
  }
  if (parsed.length > MAX_RECORDS_PER_CHUNK) {
    throw new Error(`抽取记录超过单片段上限 ${MAX_RECORDS_PER_CHUNK} 条`);
  }
  const kindSet = new Set<string>(SOURCE_MEMORY_STRUCTURED_KINDS);
  const records: SourceMemoryStagedRecord[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("抽取记录不是对象");
    }
    const raw = item as Record<string, unknown>;
    if (typeof raw.kind !== "string" || !kindSet.has(raw.kind)) {
      throw new Error(`非法 kind：${String(raw.kind)}`);
    }
    if (typeof raw.title !== "string" || typeof raw.body !== "string") {
      throw new Error("记录缺少 title/body");
    }
    const title = raw.title.trim();
    const body = raw.body.trim();
    if (!title || title.length > MAX_TITLE_CHARS) {
      throw new Error(`title 缺失或超过 ${MAX_TITLE_CHARS} 字符`);
    }
    if (!body || body.length > MAX_BODY_CHARS) {
      throw new Error(`body 缺失或超过 ${MAX_BODY_CHARS} 字符`);
    }
    let entities: string[] = [];
    if (raw.entities !== undefined) {
      if (!Array.isArray(raw.entities) || raw.entities.some((e) => typeof e !== "string")) {
        throw new Error("entities 不是字符串数组");
      }
      entities = (raw.entities as string[]).map((e) => e.trim()).filter(Boolean).slice(0, 6);
    }
    let confidence: number | undefined;
    if (raw.confidence !== undefined) {
      if (typeof raw.confidence !== "number" || raw.confidence < 0 || raw.confidence > 1) {
        throw new Error("confidence 不是 0-1 数值");
      }
      confidence = raw.confidence;
    }
    // provenance 由 plan 注入，不信任 AI 回传的来源字段
    records.push({
      kind: raw.kind as SourceMemoryStructuredKind,
      title,
      body,
      entities,
      ...(confidence !== undefined ? { confidence } : {}),
      sourcePath: chunk.sourcePath,
      sourceSha256: chunk.sourceSha256,
      chapterId: chunk.chapterId,
      anchor: chunk.anchor,
    });
  }
  return records;
}

/** IPC 桥的最小面（window.sourceMemory 的结构子集，便于测试注入）。 */
export interface SourceMemoryBridge {
  build: (projectId: string) => Promise<SourceMemoryBuildReply>;
  status: (projectId: string) => Promise<SourceMemoryStatusReply>;
  stageRecords: (
    projectId: string,
    buildId: string,
    records: SourceMemoryStagedRecord[],
  ) => Promise<SourceMemoryStageRecordsReply>;
  commitBuild: (
    projectId: string,
    payload: { buildId: string; coverage?: SourceMemoryChunkCoverage[] },
  ) => Promise<SourceMemoryCommitBuildReply>;
  search: (projectId: string, query: string, limit?: number) => Promise<SourceMemorySearchReply>;
}

export function getSourceMemoryBridge(): SourceMemoryBridge | undefined {
  try {
    return (window as unknown as { sourceMemory?: SourceMemoryBridge }).sourceMemory;
  } catch {
    // 无 window（测试/非渲染环境）→ 无桥，调用方零注入
    return undefined;
  }
}

export interface SourceMemoryExtractionProgress {
  total: number;
  done: number;
  failed: number;
}

export interface SourceMemoryExtractionSummary {
  success: boolean;
  /** ready=全部块抽取成功；partial=部分失败（raw 索引保留）；nothing-to-do=无变化章节；failed=链路失败 */
  status: "ready" | "partial" | "nothing-to-do" | "failed";
  buildId?: string;
  changedSources?: number;
  doneChunks?: number;
  failedChunks?: number;
  structuredCount?: number;
  rawCount?: number;
  error?: string;
}

/**
 * 全量抽取编排：build（拿增量 plan）→ 小批并发 AI 抽取 → stage → commit。
 * 任一环节失败都不阻断已暂存内容：AI 失败的块计入 coverage ok:false，commit 落 partial。
 * plan-stale / sources-changed 直接中止并报错（调用方提示重建）。
 */
export async function runSourceMemoryExtraction(input: {
  projectId: string;
  bridge?: SourceMemoryBridge;
  /** 注入 aiManager.text 封装（universalAi binding）；抛错=该块失败。 */
  callText: (messages: SourceMemoryExtractionMessages) => Promise<string>;
  concurrency?: number;
  onProgress?: (progress: SourceMemoryExtractionProgress) => void;
}): Promise<SourceMemoryExtractionSummary> {
  const bridge = input.bridge ?? getSourceMemoryBridge();
  if (!bridge) {
    return { success: false, status: "failed", error: "当前环境不支持原著记忆库（缺少 IPC 桥）" };
  }
  const buildReply = await bridge.build(input.projectId);
  if (!buildReply.success) {
    return { success: false, status: "failed", error: buildReply.error || "构建失败" };
  }
  const plan = buildReply.plan;
  if (!plan || !plan.chunks.length) {
    return {
      success: true,
      status: "nothing-to-do",
      buildId: buildReply.buildId,
      changedSources: 0,
      doneChunks: 0,
      failedChunks: 0,
    };
  }
  const coverage: SourceMemoryChunkCoverage[] = [];
  const progress: SourceMemoryExtractionProgress = { total: plan.chunks.length, done: 0, failed: 0 };
  const queue = [...plan.chunks.entries()];
  const concurrency = Math.max(1, Math.min(input.concurrency ?? 2, 4));
  let aborted: string | undefined;

  const worker = async () => {
    while (!aborted) {
      const next = queue.shift();
      if (!next) return;
      const [, chunk] = next;
      try {
        const records = parseExtractionRecords(await input.callText(buildExtractionMessages(chunk)), chunk);
        const staged = await bridge.stageRecords(input.projectId, plan.buildId, records);
        if (!staged.success) {
          if (staged.error?.startsWith("plan-stale")) {
            aborted = staged.error;
            return;
          }
          throw new Error(staged.error || "暂存被拒");
        }
        if ((staged.rejected ?? 0) > 0) {
          throw new Error(`暂存拒绝 ${staged.rejected} 条：${staged.errors?.[0] ?? "未知原因"}`);
        }
        coverage.push({ sourcePath: chunk.sourcePath, anchor: chunk.anchor, ok: true });
      } catch {
        coverage.push({ sourcePath: chunk.sourcePath, anchor: chunk.anchor, ok: false });
        progress.failed += 1;
      } finally {
        progress.done += 1;
        input.onProgress?.({ ...progress });
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  if (aborted) {
    return { success: false, status: "failed", buildId: plan.buildId, error: aborted };
  }
  const commit = await bridge.commitBuild(input.projectId, { buildId: plan.buildId, coverage });
  if (!commit.success) {
    return { success: false, status: "failed", buildId: plan.buildId, error: commit.error || "提交失败" };
  }
  return {
    success: true,
    status: commit.status === "ready" ? "ready" : "partial",
    buildId: commit.buildId,
    changedSources: plan.changedSources,
    doneChunks: plan.chunks.length,
    failedChunks: commit.failedChunks ?? 0,
    structuredCount: commit.structuredCount,
    rawCount: commit.rawCount,
  };
}

/** 检索门面（L3）：动作开始检索一次、格式化为单块；不可用→undefined 零注入零阻断。 */
export async function retrieveArchiveContext(input: {
  projectId?: string | null;
  query: string;
  limit?: number;
}): Promise<string | undefined> {
  const bridge = getSourceMemoryBridge();
  if (!input.projectId || !bridge) return undefined;
  try {
    const result = await bridge.search(input.projectId, input.query.slice(0, 200), input.limit ?? 4);
    if (!result.success || !result.hits?.length) return undefined;
    return [
      "## 原著档案检索（按需补充，事实以圣经与正文为准）",
      ...result.hits.map((hit) => `- [${hit.kind}] ${hit.title}（${hit.sourcePath}）：${hit.snippet}`),
    ].join("\n");
  } catch {
    return undefined;
  }
}

/** 常驻圣经块 + 档案检索块合一读取（用户裁定：每条消息常驻块只有一个，检索追加其后）。 */
export async function readBibleWithArchiveContext(input: {
  projectId?: string | null;
  storeFallback?: string;
  archiveQuery: string;
  archiveLimit?: number;
}): Promise<string | undefined> {
  const residentBible = await readResidentBible({
    projectId: input.projectId,
    readText: getProjectFilesBridge()?.readText,
    storeFallback: input.storeFallback,
  });
  const bibleContext = formatSourceBibleContext(residentBible) || undefined;
  const archiveContext = await retrieveArchiveContext({
    projectId: input.projectId,
    query: input.archiveQuery,
    limit: input.archiveLimit,
  });
  return [bibleContext, archiveContext].filter(Boolean).join("\n\n") || undefined;
}
