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
  /** 章节轻索引（窗口化 v1）：全章元数据条目（无 sourceText）。缺省=旧代全量布局（读端走全量路径） */
  chapterIndex?: Array<Record<string, unknown>>;
  /** 激活章（窗口装载对象）；null=未定（读端回退索引首章） */
  activeChapterId?: string | null;
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
  sceneSegments: {
    slug: "scene-segments",
    chapterKeyOf: (item) => recordField(item, "chapterId"),
  },
};

/** 章节条目是否带全文（窗口化：带 sourceText 的才是完整章，落章分片；无=轻索引项，不落片） */
export function isFullNovelChapter(item: unknown): boolean {
  return Boolean(item && typeof item === "object" && typeof (item as Record<string, unknown>).sourceText === "string");
}

/** 窗口装载/共享保留用的归属判定导出（渲染进程 switchChapter 使用） */
export function buildAttributionContextFromState(state: Record<string, unknown>) {
  return buildChapterAttributionContext(state);
}
export function chapterKeyOfDomainItem(domainKey: string, item: unknown, context: unknown): string | null {
  const rule = CHAPTER_DOMAIN_RULES[domainKey];
  if (!rule) return null;
  return rule.chapterKeyOf(item, context as ReturnType<typeof buildChapterAttributionContext>);
}

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
  const candidate = parsed as { layout?: unknown; version?: unknown; shards?: unknown; chapterIndex?: unknown; activeChapterId?: unknown };
  if (candidate.layout !== STUDIO_WORKFLOW_SHARD_LAYOUT) return null;
  if (typeof candidate.version !== "number" || !Number.isFinite(candidate.version)) return null;
  if (!Array.isArray(candidate.shards)) return null;
  const shards: string[] = [];
  for (const entry of candidate.shards) {
    if (typeof entry !== "string" || !isSafeShardFileName(entry)) return null;
    shards.push(entry);
  }
  let chapterIndex: Array<Record<string, unknown>> | undefined;
  if (candidate.chapterIndex !== undefined) {
    if (!Array.isArray(candidate.chapterIndex)) return null;
    chapterIndex = [];
    for (const entry of candidate.chapterIndex) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      const record = entry as Record<string, unknown>;
      if (typeof record.id !== "string" || !record.id) return null;
      chapterIndex.push(record);
    }
  }
  let activeChapterId: string | null | undefined;
  if (candidate.activeChapterId !== undefined) {
    if (candidate.activeChapterId !== null && typeof candidate.activeChapterId !== "string") return null;
    activeChapterId = candidate.activeChapterId;
  }
  return { layout: STUDIO_WORKFLOW_SHARD_LAYOUT, version: candidate.version, shards, chapterIndex, activeChapterId };
}

export interface StudioWorkflowShardPlan {
  manifest: StudioWorkflowShardManifest;
  files: StudioWorkflowShardPlanFile[];
  /** 超过单片预算但被迫独占一片的文件名（单章/单键豁免），供调用方告警。 */
  oversizedFiles: string[];
  /** 增量规划统计（未启用增量时为全零）：测试与基准观测用。 */
  stats: { reusedDomains: string[]; serializedItems: number; reusedItems: number };
}

/** 域级增量缓存条目：上一代该域的 live 数组引用 + 其分片（名+内容）。 */
export interface StudioWorkflowDomainGeneration {
  ref: unknown;
  files: StudioWorkflowShardPlanFile[];
}

export interface PlanStudioWorkflowShardsOptions {
  limitBytes?: number;
  /** 读取 store 当前 state（live 引用）；域引用相等 ⇒ 与上一代序列化内容一致（zustand 不可变约定）。 */
  getLiveState?: () => unknown;
  /** 条目 → 格式化串缓存（键=live 条目对象）。域引用未变时整域复用，命中不到才用。 */
  itemCache?: WeakMap<object, string>;
  /** 域级复用缓存（适配器按 pid 持有并传入；规划器负责登记/复用）。 */
  domainCache?: Map<string, StudioWorkflowDomainGeneration>;
  /** 强制全量：跳过域复用与条目缓存读（写仍回填）——原地突变自愈用；域缓存照常登记新代。 */
  refreshItemCache?: boolean;
  /** 窗口化 v1：把 state 的 novelChapters 派生为 manifest.chapterIndex（剥 sourceText）并写 activeChapterId */
  emitChapterIndex?: boolean;
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
  options: PlanStudioWorkflowShardsOptions = {},
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

  const liveRaw = options.getLiveState?.();
  const liveState = liveRaw && typeof liveRaw === "object" && !Array.isArray(liveRaw)
    ? (liveRaw as Record<string, unknown>)
    : undefined;
  const stats = { reusedDomains: [] as string[], serializedItems: 0, reusedItems: 0 };
  const serializeItem = (item: object): string => {
    if (!options.refreshItemCache) {
      const hit = options.itemCache?.get(item);
      if (hit !== undefined) {
        stats.reusedItems += 1;
        return hit;
      }
    }
    const rendered = `      ${reindentJson(JSON.stringify(item, null, 2), 6)}`;
    options.itemCache?.set(item, rendered);
    stats.serializedItems += 1;
    return rendered;
  };

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
    const liveRef = liveState?.[key];
    // 域级复用：live 数组引用与上一代一致 ⇒ 序列化内容一致，直接复用其分片（零序列化）。
    // refreshItemCache（周期全量自愈）时跳过复用——原地突变引用不变，必须在域层就强制重算
    if (!options.refreshItemCache && isArray && (chapterRule || flatSlug) && options.domainCache && liveState) {
      const prev = options.domainCache.get(key);
      if (prev && prev.ref === liveRef) {
        files.push(...prev.files);
        stats.reusedDomains.push(key);
        continue;
      }
    }
    // 条目源优先取 live 数组（条目对象跨保存保引用，WeakMap 缓存才可能命中）
    const items: unknown[] = isArray && liveState && Array.isArray(liveRef)
      ? (liveRef as unknown[])
      : (domainValue as unknown[]);
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

    if (chapterRule) {
      const domainFilesStart = files.length;
      // 章优先分层：按「同章连续段(run)」切文件，run 内超预算续片；
      // manifest 顺序 = 数组原序 → 合并 concat 精确还原（章交错也保序）。
      // novelChapters 特例（窗口化 v1）：轻索引项（无 sourceText）不落章分片——
      // 索引进 manifest.chapterIndex，全文只存激活/曾激活章的既有分片。
      const plannableItems = key === "novelChapters"
        ? items.filter(isFullNovelChapter)
        : items;
      let index = 0;
      while (index < plannableItems.length) {
        const chapterKey = chapterRule.chapterKeyOf(plannableItems[index], attribution);
        let end = index + 1;
        while (end < plannableItems.length && chapterRule.chapterKeyOf(plannableItems[end], attribution) === chapterKey) {
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
          const raw = plannableItems[position];
          const itemPart = raw && typeof raw === "object" ? serializeItem(raw as object) : `      ${reindentJson(JSON.stringify(raw, null, 2), 6)}`;
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
      options.domainCache?.set(key, { ref: liveRef ?? domainValue, files: files.slice(domainFilesStart) });
      continue;
    }

    // 非章节数组域：单片裸名、多片才编号。
    const domainFilesStart = files.length;
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
      const itemPart = item && typeof item === "object" ? serializeItem(item) : `      ${reindentJson(JSON.stringify(item, null, 2), 6)}`;
      const projected = batchTotalBytes(shard!, version, itemPart);
      if (projected > limitBytes && shard!.parts.length > 0) {
        closeBatch(shard!, version, files, oversizedFiles, limitBytes);
        openShard();
      }
      shard!.parts.push(itemPart);
      shard!.partsBytes += utf8Bytes(itemPart);
    }
    if (shard) closeBatch(shard!, version, files, oversizedFiles, limitBytes);
    options.domainCache?.set(key, { ref: liveRef ?? domainValue, files: files.slice(domainFilesStart) });
  }
  if (core) closeBatch(core, version, files, oversizedFiles, limitBytes);

  const manifest: StudioWorkflowShardManifest = {
    layout: STUDIO_WORKFLOW_SHARD_LAYOUT,
    version,
    shards: files.map((file) => file.name),
  };
  if (options.emitChapterIndex && Array.isArray(state.novelChapters)) {
    manifest.chapterIndex = (state.novelChapters as unknown[]).map((chapter) => {
      if (!chapter || typeof chapter !== "object") return { id: String(chapter) };
      const { sourceText: _dropped, ...rest } = chapter as Record<string, unknown>;
      return rest;
    });
    const activeRaw = state.activeChapterId;
    manifest.activeChapterId = typeof activeRaw === "string" && activeRaw
      ? activeRaw
      : ((state.novelChapters as unknown[]).find(isFullNovelChapter) as { id?: unknown } | undefined)?.id as string | null
        ?? null;
  }
  return { manifest, files, oversizedFiles, stats };
}

/**
 * 纯 TS MD5（RFC 1321，UTF-8 输入）——渲染进程无 node:crypto，README 模板
 * md5 校验依赖此实现；正确性由对拍 node:crypto 的单测守卫。
 */
const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const MD5_K = new Uint32Array(64);
for (let i = 0; i < 64; i += 1) {
  MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
}

export function md5Utf8(input: string): string {
  const bytes = encoder.encode(input);
  const bitLength = bytes.length * 8;
  const paddedWords = (((bytes.length + 8) >>> 6) + 1) << 4;
  const words = new Uint32Array(paddedWords);
  new Uint8Array(words.buffer).set(bytes);
  words[bytes.length >> 2] |= 0x80 << ((bytes.length % 4) * 8);
  words[paddedWords - 2] = bitLength >>> 0;
  words[paddedWords - 1] = Math.floor(bitLength / 0x100000000);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89 | 0;
  let c0 = 0x98badcfe | 0;
  let d0 = 0x10325476;
  for (let chunk = 0; chunk < words.length; chunk += 16) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i += 1) {
      let f: number, g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const temp = (f + a + MD5_K[i] + words[chunk + g]) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((temp << MD5_S[i]) | (temp >>> (32 - MD5_S[i])))) >>> 0;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  const leHex = (word: number) => (
    ((word << 24) | ((word << 8) & 0xff0000) | ((word >>> 8) & 0xff00) | (word >>> 24)) >>> 0
  ).toString(16).padStart(8, "0");
  return leHex(a0) + leHex(b0) + leHex(c0) + leHex(d0);
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
