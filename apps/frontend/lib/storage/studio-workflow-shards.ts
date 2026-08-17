// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * studio-workflow store 分片持久化——纯拆分/合并逻辑（无 Electron/Node 依赖）。
 *
 * 布局（项目根 `studio-workflow/`，经 `_p/{pid}/studio-workflow/<name>` 虚拟键路由）：
 * - `manifest.json`：{layout, version, shards}——唯一读盘清单，读写均 manifest 驱动
 * - `core-<stamp>.json`（溢出续 `core-002-<stamp>.json`…）：小域 + 空数组 + 未知键
 * - `<slug>-<stamp>.json` / `<slug>-NNN-<stamp>.json`：数组域分片；novel-chapters 恒编号
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

/** 数组域 → 分片文件名 slug。小域（config/两圣经/事件图/记忆/实体提取等）落 core。 */
const ARRAY_DOMAIN_SLUGS: Record<string, string> = {
  novelChapters: "novel-chapters",
  scriptPlans: "script-plans",
  storyboards: "storyboards",
  mediaTasks: "media-tasks",
  agentRuns: "agent-runs",
  imageWorkflows: "image-workflows",
  continuityAssetVersions: "assets-versions",
  agentWorkData: "agent-work-data",
  productionTracks: "production-tracks",
  materials: "materials",
  episodeOutlines: "episode-outlines",
  videoCandidates: "video-candidates",
};

/** 正文域即使单片也带编号（novel-chapters-001-<stamp>.json），与 PRD 命名一致。 */
const ALWAYS_NUMBERED_DOMAINS = new Set(["novelChapters"]);

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

/** 分片最终内容：`{"state":{<inner>},"version":<version>}`；字节量随之精确可得。 */
function shardEnvelope(inner: string, version: number): string {
  return `{"state":{${inner}},"version":${version}}`;
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
    if (typeof entry !== "string" || !entry || entry.includes("/") || entry.includes("\\")) return null;
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
  /** core 批：已拼好的 `"key":value` 片段；数组域批：item JSON 片段 */
  parts: string[];
  /** 数组域批的包裹前缀（如 `"novelChapters":[`），收尾时补 `]` */
  arrayWrapper?: string;
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
    ? `${batch.arrayWrapper}${batch.parts.join(",")}]`
    : batch.parts.join(",");
  const content = shardEnvelope(inner, version);
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
    };
    return core;
  };

  for (const [key, domainValue] of Object.entries(state)) {
    const slug = ARRAY_DOMAIN_SLUGS[key];
    const isSplittableArray = Boolean(slug) && Array.isArray(domainValue) && domainValue.length > 0;
    if (!isSplittableArray) {
      const part = `${JSON.stringify(key)}:${JSON.stringify(domainValue === undefined ? null : domainValue)}`;
      if (!core) openCore();
      const projected = shardEnvelope([...core!.parts, part].join(","), version);
      if (utf8Bytes(projected) > limitBytes && core!.parts.length > 0) {
        closeBatch(core!, version, files, oversizedFiles, limitBytes);
        openCore();
      }
      core!.parts.push(part);
      continue;
    }

    // 数组域分片：保持条目顺序，单片预算内尽量多装；命名规则：
    // novel-chapters 恒编号；其余域单片裸名、多片才编号。
    const arrayKey = JSON.stringify(key);
    const items = domainValue as unknown[];
    let shard: Batch | null = null;
    let shardNumber = 0;
    const openShard = (): Batch => {
      shardNumber += 1;
      const base = ALWAYS_NUMBERED_DOMAINS.has(key)
        ? `${slug}-${String(shardNumber).padStart(3, "0")}`
        : shardNumber === 1
          ? slug!
          : `${slug}-${String(shardNumber).padStart(3, "0")}`;
      shard = { baseName: base, parts: [], arrayWrapper: `${arrayKey}:[` };
      return shard;
    };
    for (const item of items) {
      if (!shard) openShard();
      const itemPart = JSON.stringify(item);
      // 试算：`"key":[已有items..., 新item]`
      const innerCandidate = `${arrayKey}:[${[...shard!.parts, itemPart].join(",")}]`;
      const projected = shardEnvelope(innerCandidate, version);
      if (utf8Bytes(projected) > limitBytes && shard!.parts.length > 0) {
        closeBatch(shard!, version, files, oversizedFiles, limitBytes);
        openShard();
      }
      shard!.parts.push(itemPart);
    }
    if (shard) closeBatch(shard, version, files, oversizedFiles, limitBytes);
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
