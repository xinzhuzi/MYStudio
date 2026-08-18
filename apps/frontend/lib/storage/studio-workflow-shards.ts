// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * studio-workflow store 分片持久化——纯拆分/合并逻辑（无 Electron/Node 依赖）。
 *
 * 布局（项目根 `studio-workflow/`，经 `_p/{pid}/studio-workflow/<name>` 虚拟键路由）：
 * - `manifest.json`：{layout, version, shards}——唯一读盘清单，读写均 manifest 驱动
 * - `chapters/<chapterId>/<slug>-NNN-<stamp>.json`：**章优先目录分层**（08-18 用户裁定）
 *   ——章节归属数组域按条目所属章切进每章自己的子目录（章内超 512KB 续 -NNN；
 *   无法归章的条目落根层 `<slug>-shared-NNN-*`），一章的增删改只动一章的目录，
 *   为增量写/章节归档铺路
 * - `core-<stamp>.json`（溢出续 `core-002-<stamp>.json`…）：小域 + 空数组 + 未知键
 * - `<slug>-<stamp>.json` / `<slug>-NNN-<stamp>.json`：非章节数组域（materials 等）
 *   按大小批切，单片裸名、多片才编号
 *
 * 关键设计：
 * - 每片信封保持 `{"state":{...},"version":N}` 形状 → asset inventory 的
 *   zustand-project-state 解码器与 physicalRefs 合并天然兼容
 * - 文件名含内容 stamp（djb2 前 8 hex）：写序 = 先写全部分片（新名不覆盖旧名）→
 *   最后原子换 manifest → 清孤儿。进程中途死时 manifest 仍指向旧代完整文件集，
 *   读端拿到的是一致的一代数据；固定名原地覆盖则会留下新旧混合代（解析成功但
 *   数据语义损坏），故弃用
 * - 512KB（UTF-8 字节）为单片预算：数组按条批切、core 按键批切；单条/单键超限
 *   时独占一片（PRD 裁定：单章超限独占一片，不截断不报错丢数据）
 * - 无损保证：章节域按「同章连续段（run）」切文件，manifest 顺序 = 数组原序，
 *   合并 concat 精确还原条目顺序（数组中章交错时 run 机制天然保序）
 * - 同一数组域跨多片时，读端按 manifest 顺序 concat；重复出现的标量/对象键后者
 *   覆盖前者（写端保证 core 与域分片键不重叠）
 */

export const STUDIO_WORKFLOW_SHARD_DIR = "studio-workflow";
export const STUDIO_WORKFLOW_SHARD_LAYOUT = "studio-workflow-shards-v1";
export const STUDIO_WORKFLOW_SHARD_LIMIT_BYTES = 512 * 1024;

export interface StudioWorkflowShardPlanFile {
  /** shard 目录内的文件名（含 .json 后缀，即磁盘文件名） */
  name: string;
  content: string;
}

export interface StudioWorkflowShardManifest {
  layout: typeof STUDIO_WORKFLOW_SHARD_LAYOUT;
  version: number;
  shards: string[];
}

export class StudioWorkflowShardPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioWorkflowShardPlanError";
  }
}

/** 文件名安全的 chapterId（chapterId 保持 ASCII，防御脏数据进文件名）。 */
const SAFE_CHAPTER_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * manifest 分片名的安全形态：根层 `<name>.json`（1 段）或章节目录
 * `chapters/<chapterId>/<name>.json`（3 段）。每段禁 `..`/空段/反斜杠，
 * 从根上封死路径穿越。
 */
export function isSafeShardFileName(name: string): boolean {
  if (!name || name.length > 200 || name.includes("\\")) return false;
  const segments = name.split("/");
  if (segments.length > 3) return false;
  return segments.every((segment) => SAFE_CHAPTER_KEY_RE.test(segment));
}

/** 章节归属解析上下文：间接归属域（videoCandidates/imageWorkflows）用的映射。 */
interface ChapterAttributionContext {
  episodeIdByStoryboardId: Map<string, string>;
  episodeIdByTrackId: Map<string, string>;
}

function recordField(item: unknown, field: string): string | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const value = (item as Record<string, unknown>)[field];
  return typeof value === "string" && SAFE_CHAPTER_KEY_RE.test(value) ? value : null;
}

type ChapterKeyExtractor = (item: unknown, context: ChapterAttributionContext) => string | null;

/** 章节归属数组域：每章独立分片（`chapter-<id>-<slug>-NNN-<stamp>.json`）。 */
const CHAPTER_DOMAIN_RULES: Record<string, { slug: string; chapterKeyOf: ChapterKeyExtractor }> = {
  novelChapters: { slug: "novel-chapters", chapterKeyOf: (item) => recordField(item, "id") },
  storyboards: { slug: "storyboards", chapterKeyOf: (item) => recordField(item, "episodeId") },
  scriptPlans: { slug: "script-plans", chapterKeyOf: (item) => recordField(item, "episodeId") },
  episodeOutlines: { slug: "episode-outlines", chapterKeyOf: (item) => recordField(item, "episodeId") },
  mediaTasks: { slug: "media-tasks", chapterKeyOf: (item) => recordField(item, "episodeId") },
  productionTracks: { slug: "production-tracks", chapterKeyOf: (item) => recordField(item, "episodeId") },
  agentWorkData: { slug: "agent-work-data", chapterKeyOf: (item) => recordField(item, "episodeId") },
  entityExtractions: {
    slug: "entity-extractions",
    chapterKeyOf: (item) => recordField(item, "chapterId") ?? recordField(item, "episodeId"),
  },
  imageWorkflows: {
    slug: "image-workflows",
    chapterKeyOf: (item, context) => {
      const target = item && typeof item === "object"
        ? (item as Record<string, unknown>).target
        : null;
      if (!target || typeof target !== "object") return null;
      const record = target as Record<string, unknown>;
      if (record.kind !== "storyboard" || typeof record.id !== "string") return null;
      return context.episodeIdByStoryboardId.get(record.id) ?? null;
    },
  },
  videoCandidates: {
    slug: "video-candidates",
    chapterKeyOf: (item, context) => {
      const trackId = recordField(item, "trackId");
      return trackId ? context.episodeIdByTrackId.get(trackId) ?? null : null;
    },
  },
};

/** 非章节数组域：项目级数据，按大小批切（单片裸名、多片 -NNN）。 */
const ARRAY_DOMAIN_SLUGS: Record<string, string> = {
  agentRuns: "agent-runs",
  continuityAssetVersions: "assets-versions",
  materials: "materials",
};

function buildChapterAttributionContext(state: Record<string, unknown>): ChapterAttributionContext {
  const episodeIdByStoryboardId = new Map<string, string>();
  const storyboards = state.storyboards;
  if (Array.isArray(storyboards)) {
    for (const item of storyboards) {
      const id = recordField(item, "id");
      const episodeId = recordField(item, "episodeId");
      if (id && episodeId) episodeIdByStoryboardId.set(id, episodeId);
    }
  }
  const episodeIdByTrackId = new Map<string, string>();
  const tracks = state.productionTracks;
  if (Array.isArray(tracks)) {
    for (const item of tracks) {
      const id = recordField(item, "id");
      const episodeId = recordField(item, "episodeId");
      if (id && episodeId) episodeIdByTrackId.set(id, episodeId);
    }
  }
  return { episodeIdByStoryboardId, episodeIdByTrackId };
}

const encoder = new TextEncoder();

function utf8Bytes(input: string): number {
  return encoder.encode(input).length;
}

/** 内容 stamp：djb2 取前 8 hex。仅需跨代去重，无密码学要求。 */
export function shardContentStamp(content: string): string {
  let hash = 5381;
  for (let i = 0; i < content.length; i += 1) {
    hash = ((hash << 5) + hash + content.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * 分片最终内容（格式化多行，人可读）：
 * ```
 * {
 *   "state": {
 *     <inner>
 *   },
 *   "version": 10
 * }
 * ```
 * 512KB 预算按该最终形态的 UTF-8 字节精确计量（逐 part 增量累加，见 batchTotalBytes）。
 */
const SHARD_ENVELOPE_PREFIX = '{\n  "state": {\n';

function reindentJson(json: string, extraSpaces: number): string {
  if (extraSpaces <= 0) return json;
  return json.split("\n").join(`\n${" ".repeat(extraSpaces)}`);
}

function shardEnvelopePretty(inner: string, version: number): string {
  return `${SHARD_ENVELOPE_PREFIX}${inner}\n  },\n  "version": ${version}\n}`;
}

export function parseStudioWorkflowShardManifest(raw: string): StudioWorkflowShardManifest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const candidate = parsed as { layout?: unknown; version?: unknown; shards?: unknown };
  if (candidate.layout !== STUDIO_WORKFLOW_SHARD_LAYOUT) return null;
  if (typeof candidate.version !== "number" || !Number.isFinite(candidate.version)) return null;
  if (!Array.isArray(candidate.shards)) return null;
  const shards: string[] = [];
  for (const entry of candidate.shards) {
    if (typeof entry !== "string" || !isSafeShardFileName(entry)) return null;
    shards.push(entry);
  }
  return { layout: STUDIO_WORKFLOW_SHARD_LAYOUT, version: candidate.version, shards };
}

export interface StudioWorkflowShardPlan {
  manifest: StudioWorkflowShardManifest;
  files: StudioWorkflowShardPlanFile[];
  /** 超过单片预算但被迫独占一片的文件名（单章/单键豁免），供调用方告警。 */
  oversizedFiles: string[];
}

interface Batch {
  baseName: string;
  /** 已按落盘缩进渲染好的 part（数组域=item 多行 JSON；core=`"key": value` 多行） */
  parts: string[];
  /** Σ part UTF-8 字节，增量维护避免重复串接计量 */
  partsBytes: number;
  /** 数组域批的包裹前缀（`"key": [`），收尾时补 `\n    ]` */
  arrayWrapper?: string;
}

/** 精确试算：加入 candidatePart（可空）后整片格式化字节数。 */
function batchTotalBytes(batch: Batch, version: number, candidatePart?: string): number {
  const count = batch.parts.length + (candidatePart ? 1 : 0);
  const partsBytes = batch.partsBytes + (candidatePart ? utf8Bytes(candidatePart) : 0);
  const innerBytes = batch.arrayWrapper
    ? utf8Bytes(batch.arrayWrapper) + 1 + partsBytes + 2 * (count - 1) + utf8Bytes("\n    ]")
    : partsBytes + 2 * (count - 1);
  return utf8Bytes(SHARD_ENVELOPE_PREFIX) + innerBytes
    + utf8Bytes(`\n  },\n  "version": ${version}\n}`);
}

function closeBatch(
  batch: Batch,
  version: number,
  files: StudioWorkflowShardPlanFile[],
  oversizedFiles: string[],
  limitBytes: number,
): void {
  if (batch.parts.length === 0) return;
  const inner = batch.arrayWrapper
    ? `${batch.arrayWrapper}\n${batch.parts.join(",\n")}\n    ]`
    : batch.parts.join(",\n");
  const content = shardEnvelopePretty(inner, version);
  if (utf8Bytes(content) > limitBytes) oversizedFiles.push(batch.baseName);
  files.push({ name: `${batch.baseName}-${shardContentStamp(content)}.json`, content });
}

/**
 * 把 zustand persist 的完整落盘串（`{"state":{...},"version":N}`）拆成
 * manifest + 分片文件集。输入不是合法信封时抛 StudioWorkflowShardPlanError，
 * 调用方应回退旧单文件写，绝不静默丢数据。
 */
export function planStudioWorkflowShards(
  value: string,
  options: { limitBytes?: number } = {},
): StudioWorkflowShardPlan {
  const limitBytes = options.limitBytes ?? STUDIO_WORKFLOW_SHARD_LIMIT_BYTES;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new StudioWorkflowShardPlanError(`studio-workflow 分片输入无法解析: ${String(error)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new StudioWorkflowShardPlanError("studio-workflow 分片输入不是对象信封");
  }
  const envelope = parsed as { state?: unknown; version?: unknown };
  if (!envelope.state || typeof envelope.state !== "object" || Array.isArray(envelope.state)) {
    throw new StudioWorkflowShardPlanError("studio-workflow 分片输入缺少 state 对象");
  }
  const version = typeof envelope.version === "number" && Number.isFinite(envelope.version)
    ? envelope.version
    : 0;
  const state = envelope.state as Record<string, unknown>;

  const files: StudioWorkflowShardPlanFile[] = [];
  const oversizedFiles: string[] = [];

  // core：非数组域 + 空数组/非数组值的注册域 + 未知键，按键批切。
  let coreIndex = 0;
  let core: Batch | null = null;
  const openCore = (): Batch => {
    coreIndex += 1;
    core = {
      baseName: coreIndex === 1 ? "core" : `core-${String(coreIndex).padStart(3, "0")}`,
      parts: [],
      partsBytes: 0,
    };
    return core;
  };

  const attribution = buildChapterAttributionContext(state);
  // 章域文件按 (章节键, 域) 计数编号：chapters/<chapterId>/<slug>-NNN-<stamp>.json；
  // 无法归章条目落根层 <slug>-shared-NNN-<stamp>.json
  const chapterFileCount = new Map<string, number>();
  const nextChapterBase = (chapterKey: string | null, slug: string): string => {
    const base = chapterKey ? `chapters/${chapterKey}/${slug}` : `${slug}-shared`;
    const next = (chapterFileCount.get(base) ?? 0) + 1;
    chapterFileCount.set(base, next);
    return `${base}-${String(next).padStart(3, "0")}`;
  };

  for (const [key, domainValue] of Object.entries(state)) {
    const chapterRule = CHAPTER_DOMAIN_RULES[key];
    const flatSlug = ARRAY_DOMAIN_SLUGS[key];
    const isArray = Array.isArray(domainValue) && domainValue.length > 0;
    // 未注册的未知数组键按原子键进 core（防 undefined slug 文件名）
    if (!isArray || (!chapterRule && !flatSlug)) {
      const part = `    ${JSON.stringify(key)}: ${reindentJson(JSON.stringify(domainValue === undefined ? null : domainValue, null, 2), 4)}`;
      if (!core) openCore();
      const projected = batchTotalBytes(core!, version, part);
      if (projected > limitBytes && core!.parts.length > 0) {
        closeBatch(core!, version, files, oversizedFiles, limitBytes);
        openCore();
      }
      core!.parts.push(part);
      core!.partsBytes += utf8Bytes(part);
      continue;
    }

    const arrayKey = JSON.stringify(key);
    const items = domainValue as unknown[];

    if (chapterRule) {
      // 章优先分层：按「同章连续段(run)」切文件，run 内超预算续片；
      // manifest 顺序 = 数组原序 → 合并 concat 精确还原（章交错也保序）。
      let index = 0;
      while (index < items.length) {
        const chapterKey = chapterRule.chapterKeyOf(items[index], attribution);
        let end = index + 1;
        while (end < items.length && chapterRule.chapterKeyOf(items[end], attribution) === chapterKey) {
          end += 1;
        }
        let shard: Batch | null = null;
        const openShard = (): Batch => {
          shard = {
            baseName: nextChapterBase(chapterKey, chapterRule.slug),
            parts: [],
            partsBytes: 0,
            arrayWrapper: `    ${arrayKey}: [`,
          };
          return shard;
        };
        for (let position = index; position < end; position += 1) {
          const itemPart = `      ${reindentJson(JSON.stringify(items[position], null, 2), 6)}`;
          if (!shard) openShard();
          const projected = batchTotalBytes(shard!, version, itemPart);
          if (projected > limitBytes && shard!.parts.length > 0) {
            closeBatch(shard!, version, files, oversizedFiles, limitBytes);
            openShard();
          }
          shard!.parts.push(itemPart);
          shard!.partsBytes += utf8Bytes(itemPart);
        }
        if (shard) closeBatch(shard!, version, files, oversizedFiles, limitBytes);
        index = end;
      }
      continue;
    }

    // 非章节数组域：单片裸名、多片才编号。
    let shard: Batch | null = null;
    let shardNumber = 0;
    const openShard = (): Batch => {
      shardNumber += 1;
      const base = shardNumber === 1
        ? flatSlug!
        : `${flatSlug}-${String(shardNumber).padStart(3, "0")}`;
      shard = { baseName: base, parts: [], partsBytes: 0, arrayWrapper: `    ${arrayKey}: [` };
      return shard;
    };
    for (const item of items) {
      if (!shard) openShard();
      const itemPart = `      ${reindentJson(JSON.stringify(item, null, 2), 6)}`;
      const projected = batchTotalBytes(shard!, version, itemPart);
      if (projected > limitBytes && shard!.parts.length > 0) {
        closeBatch(shard!, version, files, oversizedFiles, limitBytes);
        openShard();
      }
      shard!.parts.push(itemPart);
      shard!.partsBytes += utf8Bytes(itemPart);
    }
    if (shard) closeBatch(shard!, version, files, oversizedFiles, limitBytes);
  }
  if (core) closeBatch(core, version, files, oversizedFiles, limitBytes);

  const manifest: StudioWorkflowShardManifest = {
    layout: STUDIO_WORKFLOW_SHARD_LAYOUT,
    version,
    shards: files.map((file) => file.name),
  };
  return { manifest, files, oversizedFiles };
}

export interface MergedStudioWorkflowEnvelope {
  state: Record<string, unknown>;
  version: number;
}

/**
 * 按 manifest 顺序合并分片信封：
 * - 同一数组键在多片出现 → concat（写端只有数组域会被切多片）
 * - 其余键后写覆盖先写（写端保证 core 与域分片键不重叠，覆盖分支仅为防御）
 * 任一分片不是 `{state: object}` 信封 → 抛错（调用方回退 legacy，绝不半合并）。
 */
export function mergeStudioWorkflowShards(
  shardContents: readonly string[],
): MergedStudioWorkflowEnvelope {
  const merged: Record<string, unknown> = {};
  let version = 0;
  let sawVersion = false;
  for (const raw of shardContents) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new StudioWorkflowShardPlanError(`studio-workflow 分片内容无法解析: ${String(error)}`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new StudioWorkflowShardPlanError("studio-workflow 分片内容不是对象信封");
    }
    const envelope = parsed as { state?: unknown; version?: unknown };
    if (!envelope.state || typeof envelope.state !== "object" || Array.isArray(envelope.state)) {
      throw new StudioWorkflowShardPlanError("studio-workflow 分片内容缺少 state 对象");
    }
    if (typeof envelope.version === "number" && Number.isFinite(envelope.version)) {
      if (!sawVersion || envelope.version > version) {
        version = envelope.version;
        sawVersion = true;
      }
    }
    for (const [key, value] of Object.entries(envelope.state as Record<string, unknown>)) {
      const existing = merged[key];
      if (Array.isArray(existing) && Array.isArray(value)) {
        merged[key] = [...existing, ...value];
      } else {
        merged[key] = value;
      }
    }
  }
  return { state: merged, version: sawVersion ? version : 0 };
}
