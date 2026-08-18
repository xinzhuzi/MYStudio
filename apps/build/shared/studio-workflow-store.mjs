// studio-workflow store 分片布局的 .mjs 侧读写孪生。
//
// 与 TS 权威实现 apps/frontend/lib/storage/studio-workflow-shards.ts 保持同一协议
// （布局/命名/合并语义逐条对齐；由 studio-workflow-store.test.mjs 对拍守卫）。
// 纯 node 脚本（smoke / 一次性迁移）无法 import TS 模块，故在此镜像最小实现。
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const SHARD_DIR = "studio-workflow";

// 权威模板（仓内 assets/docs/studio-workflow/README.md）；md5 校验守护项目侧副本
const README_TEMPLATE_PATH = new URL("../../frontend/assets/docs/studio-workflow/README.md", import.meta.url);
export const README_TEMPLATE = fs.readFileSync(README_TEMPLATE_PATH, "utf-8");
export const md5 = (text) => crypto.createHash("md5").update(text, "utf-8").digest("hex");

/**
 * store 布局 v1（08-18-project-store-layout）：<projectDir>/store 存在 = 已迁移，
 * store 文件在 store/ 下；否则旧平铺。与 TS 权威 project-store-layout.ts 同规则。
 */
export function resolveStoreBase(projectDir) {
  const storeDir = path.join(projectDir, "store");
  return fs.existsSync(storeDir) ? storeDir : projectDir;
}
export const SHARD_LAYOUT = "studio-workflow-shards-v1";
export const SHARD_LIMIT_BYTES = 512 * 1024;

const SAFE_CHAPTER_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// manifest 分片名安全形态：根层 <name>.json 或 chapters/<chapterId>/<name>.json
export function isSafeShardFileName(name) {
  if (!name || name.length > 200 || name.includes("\\")) return false;
  const segments = name.split("/");
  if (segments.length > 3) return false;
  return segments.every((segment) => SAFE_CHAPTER_KEY_RE.test(segment));
}

function recordField(item, field) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const value = item[field];
  return typeof value === "string" && SAFE_CHAPTER_KEY_RE.test(value) ? value : null;
}

// 章节归属数组域：每章独立分片（chapter-<id>-<slug>-NNN-<stamp>.json）
const CHAPTER_DOMAIN_RULES = {
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
      const target = item && typeof item === "object" ? item.target : null;
      if (!target || typeof target !== "object") return null;
      if (target.kind !== "storyboard" || typeof target.id !== "string") return null;
      return context.episodeIdByStoryboardId.get(target.id) ?? null;
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

// 非章节数组域：项目级数据，按大小批切（单片裸名、多片 -NNN）
const ARRAY_DOMAIN_SLUGS = {
  agentRuns: "agent-runs",
  continuityAssetVersions: "assets-versions",
  materials: "materials",
};

function buildChapterAttributionContext(state) {
  const episodeIdByStoryboardId = new Map();
  if (Array.isArray(state.storyboards)) {
    for (const item of state.storyboards) {
      const id = recordField(item, "id");
      const episodeId = recordField(item, "episodeId");
      if (id && episodeId) episodeIdByStoryboardId.set(id, episodeId);
    }
  }
  const episodeIdByTrackId = new Map();
  if (Array.isArray(state.productionTracks)) {
    for (const item of state.productionTracks) {
      const id = recordField(item, "id");
      const episodeId = recordField(item, "episodeId");
      if (id && episodeId) episodeIdByTrackId.set(id, episodeId);
    }
  }
  return { episodeIdByStoryboardId, episodeIdByTrackId };
}

const encoder = new TextEncoder();
const utf8Bytes = (input) => encoder.encode(input).length;

function stamp(content) {
  let hash = 5381;
  for (let i = 0; i < content.length; i += 1) {
    hash = ((hash << 5) + hash + content.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// 格式化多行信封（人可读）；512KB 预算按该最终形态精确计量
const SHARD_ENVELOPE_PREFIX = '{\n  "state": {\n';

const reindentJson = (json, extraSpaces) => {
  if (extraSpaces <= 0) return json;
  return json.split("\n").join(`\n${" ".repeat(extraSpaces)}`);
};

const shardEnvelopePretty = (inner, version) =>
  `${SHARD_ENVELOPE_PREFIX}${inner}\n  },\n  "version": ${version}\n}`;

function batchTotalBytes(batch, version, candidatePart) {
  const count = batch.parts.length + (candidatePart ? 1 : 0);
  const partsBytes = batch.partsBytes + (candidatePart ? utf8Bytes(candidatePart) : 0);
  const innerBytes = batch.arrayWrapper
    ? utf8Bytes(batch.arrayWrapper) + 1 + partsBytes + 2 * (count - 1) + utf8Bytes("\n    ]")
    : partsBytes + 2 * (count - 1);
  return utf8Bytes(SHARD_ENVELOPE_PREFIX) + innerBytes + utf8Bytes(`\n  },\n  "version": ${version}\n}`);
}

function parseManifest(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (parsed.layout !== SHARD_LAYOUT) return null;
  if (typeof parsed.version !== "number" || !Number.isFinite(parsed.version)) return null;
  if (!Array.isArray(parsed.shards)) return null;
  const shards = [];
  for (const entry of parsed.shards) {
    if (typeof entry !== "string" || !isSafeShardFileName(entry)) return null;
    shards.push(entry);
  }
  return { layout: SHARD_LAYOUT, version: parsed.version, shards };
}

function closeBatch(batch, version, files, oversized, limitBytes) {
  if (batch.parts.length === 0) return;
  const inner = batch.arrayWrapper
    ? `${batch.arrayWrapper}\n${batch.parts.join(",\n")}\n    ]`
    : batch.parts.join(",\n");
  const content = shardEnvelopePretty(inner, version);
  if (utf8Bytes(content) > limitBytes) oversized.push(batch.baseName);
  files.push({ name: `${batch.baseName}-${stamp(content)}.json`, content });
}

export function planStudioWorkflowShards(value, options = {}) {
  const limitBytes = options.limitBytes ?? SHARD_LIMIT_BYTES;
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("studio-workflow 分片输入不是对象信封");
  }
  if (!parsed.state || typeof parsed.state !== "object" || Array.isArray(parsed.state)) {
    throw new Error("studio-workflow 分片输入缺少 state 对象");
  }
  const version = typeof parsed.version === "number" && Number.isFinite(parsed.version) ? parsed.version : 0;
  const files = [];
  const oversized = [];

  let coreIndex = 0;
  let core = null;
  const openCore = () => {
    coreIndex += 1;
    core = { baseName: coreIndex === 1 ? "core" : `core-${String(coreIndex).padStart(3, "0")}`, parts: [], partsBytes: 0 };
    return core;
  };

  const attribution = buildChapterAttributionContext(parsed.state);
  const chapterFileCount = new Map();
  const nextChapterBase = (chapterKey, slug) => {
    const base = chapterKey ? `chapters/${chapterKey}/${slug}` : `${slug}-shared`;
    const next = (chapterFileCount.get(base) ?? 0) + 1;
    chapterFileCount.set(base, next);
    return `${base}-${String(next).padStart(3, "0")}`;
  };

  for (const [key, domainValue] of Object.entries(parsed.state)) {
    const chapterRule = CHAPTER_DOMAIN_RULES[key];
    const flatSlug = ARRAY_DOMAIN_SLUGS[key];
    const isArray = Array.isArray(domainValue) && domainValue.length > 0;
    // 未注册的未知数组键按原子键进 core（防 undefined slug 文件名）
    if (!isArray || (!chapterRule && !flatSlug)) {
      const part = `    ${JSON.stringify(key)}: ${reindentJson(JSON.stringify(domainValue === undefined ? null : domainValue, null, 2), 4)}`;
      if (!core) openCore();
      const projected = batchTotalBytes(core, version, part);
      if (projected > limitBytes && core.parts.length > 0) {
        closeBatch(core, version, files, oversized, limitBytes);
        openCore();
      }
      core.parts.push(part);
      core.partsBytes += utf8Bytes(part);
      continue;
    }
    const arrayKey = JSON.stringify(key);
    const items = domainValue;

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
        let shard = null;
        const openShard = () => {
          shard = { baseName: nextChapterBase(chapterKey, chapterRule.slug), parts: [], partsBytes: 0, arrayWrapper: `    ${arrayKey}: [` };
          return shard;
        };
        for (let position = index; position < end; position += 1) {
          const itemPart = `      ${reindentJson(JSON.stringify(items[position], null, 2), 6)}`;
          if (!shard) openShard();
          const projected = batchTotalBytes(shard, version, itemPart);
          if (projected > limitBytes && shard.parts.length > 0) {
            closeBatch(shard, version, files, oversized, limitBytes);
            openShard();
          }
          shard.parts.push(itemPart);
          shard.partsBytes += utf8Bytes(itemPart);
        }
        if (shard) closeBatch(shard, version, files, oversized, limitBytes);
        index = end;
      }
      continue;
    }

    // 非章节数组域：单片裸名、多片才编号。
    let shard = null;
    let shardNumber = 0;
    const openShard = () => {
      shardNumber += 1;
      const base = shardNumber === 1 ? flatSlug : `${flatSlug}-${String(shardNumber).padStart(3, "0")}`;
      shard = { baseName: base, parts: [], partsBytes: 0, arrayWrapper: `    ${arrayKey}: [` };
      return shard;
    };
    for (const item of items) {
      if (!shard) openShard();
      const itemPart = `      ${reindentJson(JSON.stringify(item, null, 2), 6)}`;
      const projected = batchTotalBytes(shard, version, itemPart);
      if (utf8Bytes(projected) > limitBytes && shard.parts.length > 0) {
        closeBatch(shard, version, files, oversized, limitBytes);
        openShard();
      }
      shard.parts.push(itemPart);
      shard.partsBytes += utf8Bytes(itemPart);
    }
    if (shard) closeBatch(shard, version, files, oversized, limitBytes);
  }
  if (core) closeBatch(core, version, files, oversized, limitBytes);

  return {
    manifest: { layout: SHARD_LAYOUT, version, shards: files.map((file) => file.name) },
    files,
    oversizedFiles: oversized,
  };
}

export function mergeStudioWorkflowShards(shardContents) {
  const merged = {};
  let version = 0;
  let sawVersion = false;
  for (const raw of shardContents) {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("studio-workflow 分片内容不是对象信封");
    }
    if (!parsed.state || typeof parsed.state !== "object" || Array.isArray(parsed.state)) {
      throw new Error("studio-workflow 分片内容缺少 state 对象");
    }
    if (typeof parsed.version === "number" && Number.isFinite(parsed.version)) {
      if (!sawVersion || parsed.version > version) {
        version = parsed.version;
        sawVersion = true;
      }
    }
    for (const [key, value] of Object.entries(parsed.state)) {
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

/**
 * 读取项目 studio-workflow store：分片优先，legacy 单文件兜底。
 * 返回 null = 两种布局都不存在；分片缺失/损坏抛错（绝不半合并）。
 */
export function readStudioWorkflowStore(projectDir) {
  const base = resolveStoreBase(projectDir);
  const manifestPath = path.join(base, SHARD_DIR, "manifest.json");
  if (fs.existsSync(manifestPath)) {
    const manifest = parseManifest(fs.readFileSync(manifestPath, "utf8"));
    if (!manifest) throw new Error(`studio-workflow manifest 无法解析: ${manifestPath}`);
    const contents = [];
    for (const shardName of manifest.shards) {
      const shardPath = path.join(base, SHARD_DIR, shardName);
      if (!fs.existsSync(shardPath)) throw new Error(`studio-workflow 分片缺失: ${shardPath}`);
      contents.push(fs.readFileSync(shardPath, "utf8"));
    }
    const merged = mergeStudioWorkflowShards(contents);
    return {
      state: merged.state,
      version: manifest.version,
      raw: JSON.stringify({ state: merged.state, version: manifest.version }),
      sharded: true,
    };
  }
  const legacyPath = path.join(base, "studio-workflow-store.json");
  if (!fs.existsSync(legacyPath)) return null;
  const raw = fs.readFileSync(legacyPath, "utf8");
  const parsed = JSON.parse(raw);
  return {
    state: parsed.state ?? {},
    version: typeof parsed.version === "number" ? parsed.version : 0,
    raw,
    sharded: false,
  };
}

/**
 * 把完整信封串按分片布局写入 `<projectDir>/studio-workflow/`（smoke 克隆写回用）。
 * 协议与渲染进程一致：先写分片 → manifest 最后换新 → legacy 单文件改名保留 → 清孤儿。
 */
export function writeStudioWorkflowStore(projectDir, envelopeRaw) {
  const plan = planStudioWorkflowShards(envelopeRaw);
  const shardDir = path.join(resolveStoreBase(projectDir), SHARD_DIR);
  fs.mkdirSync(shardDir, { recursive: true });
  const writeAtomic = (targetPath, content) => {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
    try {
      fs.writeFileSync(tempPath, content, "utf8");
      fs.renameSync(tempPath, targetPath);
    } finally {
      if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
    }
  };
  for (const file of plan.files) {
    writeAtomic(path.join(shardDir, file.name), file.content);
  }
  writeAtomic(path.join(shardDir, "manifest.json"), JSON.stringify(plan.manifest, null, 2));
  const legacyPath = path.join(resolveStoreBase(projectDir), "studio-workflow-store.json");
  let legacyBackupPath = null;
  if (fs.existsSync(legacyPath)) {
    legacyBackupPath = `${legacyPath}.bak-sharded-${Date.now()}`;
    fs.renameSync(legacyPath, legacyBackupPath);
  }
  const listed = new Set([...plan.manifest.shards, "manifest.json"]);
  const pruneDir = (dirPath) => {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        pruneDir(fullPath);
      } else if (entry.name.endsWith(".json")
        && !listed.has(path.relative(shardDir, fullPath).split(path.sep).join("/"))) {
        fs.rmSync(fullPath, { force: true });
      }
    }
    if (path.resolve(dirPath) !== path.resolve(shardDir) && fs.readdirSync(dirPath).length === 0) {
      fs.rmdirSync(dirPath);
    }
  };
  pruneDir(shardDir);

  // 目录自述文档守护：与仓内权威模板逐字一致（md5 校验，漂移即覆盖）
  try {
    const readmePath = path.join(shardDir, "README.md");
    const current = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, "utf-8") : null;
    if (current !== README_TEMPLATE) {
      if (current !== null) {
        console.warn(`[studio-workflow] README.md 与权威模板不一致(md5: 现场=${md5(current)} 模板=${md5(README_TEMPLATE)})，覆盖修复`);
      }
      fs.writeFileSync(readmePath, README_TEMPLATE, "utf-8");
    }
  } catch {
    // best-effort：下次写盘再修
  }

  return { shardNames: plan.manifest.shards, legacyBackupPath };
}

/** smoke 克隆用：把源项目的分片 store 目录原样拷到目标项目目录。 */
export function copyStudioWorkflowStoreDir(sourceProjectDir, targetProjectDir) {
  const sourceShardDir = path.join(resolveStoreBase(sourceProjectDir), SHARD_DIR);
  if (!fs.existsSync(path.join(sourceShardDir, "manifest.json"))) return false;
  const targetShardDir = path.join(resolveStoreBase(targetProjectDir), SHARD_DIR);
  const copyJsonTree = (sourceDir, targetDir) => {
    fs.mkdirSync(targetDir, { recursive: true });
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
      const sourcePath = path.join(sourceDir, entry.name);
      const targetPath = path.join(targetDir, entry.name);
      if (entry.isDirectory()) copyJsonTree(sourcePath, targetPath);
      else if (entry.name.endsWith(".json")) fs.copyFileSync(sourcePath, targetPath);
    }
  };
  copyJsonTree(sourceShardDir, targetShardDir);
  return true;
}
