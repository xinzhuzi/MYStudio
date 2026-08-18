import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveLocalMediaPath,
  resolveProjectFileUrl,
  setProjectLocationResolver,
} from "@/electron/storage/storage-paths";
import {
  mergeStudioWorkflowShards,
  parseStudioWorkflowShardManifest,
} from "@/lib/storage/studio-workflow-shards";

const APP_PROCESS_NAME = "漫影工作室";
const requestedProjectName = () => process.env.CHAPTER_VIDEO_PROJECT_NAME?.trim() || "";

type JsonRecord = Record<string, unknown>;

function requireRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
  return value as JsonRecord;
}

function readJson(filePath: string): unknown {
  if (!fs.existsSync(filePath)) throw new Error(`JSON 文件不存在: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
}

function envPath(name: string) {
  const value = process.env[name]?.trim();
  return value ? path.resolve(value) : undefined;
}

function readStorageBasePathFromConfig(userDataDir: string) {
  const configPath = path.join(userDataDir, "storage-config.json");
  if (!fs.existsSync(configPath)) return undefined;
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const basePath = typeof config.basePath === "string" ? config.basePath.trim() : "";
  if (basePath) return path.resolve(basePath);
  const legacyProjectPath = typeof config.projectPath === "string" ? config.projectPath.trim() : "";
  return legacyProjectPath ? path.dirname(path.resolve(legacyProjectPath)) : undefined;
}

export function resolveUserDataDir(explicitUserDataDir?: string) {
  return (explicitUserDataDir?.trim() ? path.resolve(explicitUserDataDir) : undefined)
    || envPath("MYSTUDIO_USER_DATA_DIR")
    || path.join(os.homedir(), "Library", "Application Support", APP_PROCESS_NAME);
}

export function resolveRemotionRuntimeDir(userDataDir = resolveUserDataDir()) {
  return envPath("MYSTUDIO_REMOTION_RUNTIME_DIR") || path.join(userDataDir, "remotion-runtime");
}

export function resolveStorageBasePath(userDataDir = resolveUserDataDir()) {
  return envPath("MYSTUDIO_STORAGE_BASE_PATH")
    || readStorageBasePathFromConfig(userDataDir)
    || userDataDir;
}

export function resolveProjectId(storageBasePath = resolveStorageBasePath()) {
  const explicit = process.env.MYSTUDIO_PROJECT_ID?.trim();
  if (explicit) return explicit;
  const catalogPath = path.join(storageBasePath, "projects", "mystudio-project-store.json");
  const catalog = requireRecord(readJson(catalogPath), "project catalog");
  const state = requireRecord(catalog.state, "project catalog.state");
  const projects = Array.isArray(state.projects) ? state.projects : [];
  const wanted = requestedProjectName();
  const ids: string[] = [];
  for (const [index, value] of projects.entries()) {
    const project = requireRecord(value, `project catalog.projects[${index}]`);
    const id = typeof project.id === "string" ? project.id.trim() : "";
    const name = typeof project.name === "string" ? project.name.trim() : "";
    if (!id) continue;
    if (wanted) {
      if (name === wanted || name.includes(wanted)) return id;
    } else {
      ids.push(id);
    }
  }
  if (!wanted && ids.length === 1) return ids[0];
  if (!wanted && ids.length > 1) {
    throw new Error("项目索引包含多个项目；请设置 CHAPTER_VIDEO_PROJECT_NAME、MYSTUDIO_PROJECT_DIR 或 MYSTUDIO_PROJECT_ID");
  }
  throw new Error(
    `项目索引中未找到名称包含 ${wanted || "(未指定)"} 的项目；请设置 CHAPTER_VIDEO_PROJECT_NAME、MYSTUDIO_PROJECT_DIR 或 MYSTUDIO_PROJECT_ID`,
  );
}

// 项目外部位置注册表（<userData>/project-locations.json，主进程权威——main.ts 启动时
// 注入 setProjectLocationResolver）。CLI 侧同样必须遵循该表：App 迁移项目到外部目录后，
// 旧 _p/<pid> 布局不再持有数据，且 realpath 包含检查会拒绝符号链接垫片，唯一正解是
// 与主进程同源地按注册表解析。
let projectLocationsCache: Record<string, string> | undefined;

function registeredProjectLocation(userDataDir: string): Record<string, string> {
  if (projectLocationsCache) return projectLocationsCache;
  projectLocationsCache = {};
  try {
    const file = path.join(userDataDir, "project-locations.json");
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { locations?: unknown };
    const locations = parsed?.locations;
    if (locations && typeof locations === "object" && !Array.isArray(locations)) {
      for (const [pid, value] of Object.entries(locations as Record<string, unknown>)) {
        if (typeof value === "string" && value) projectLocationsCache[pid] = path.resolve(value);
      }
    }
  } catch {
    // 注册表缺失/损坏 → 空表，全链路回落旧行为
  }
  return projectLocationsCache;
}

let resolverInjected = false;

function ensureProjectLocationResolverInjected() {
  if (resolverInjected) return;
  resolverInjected = true;
  const locations = { ...registeredProjectLocation(resolveUserDataDir()) };
  if (Object.keys(locations).length > 0) {
    setProjectLocationResolver((projectId) => locations[projectId]);
  }
}

/** store 布局 v1：store/ 存在 = 应用已把 store 文件收进 store/（08-18-project-store-layout）。 */
function cliStoreBase(projectDir: string): string {
  const storeDir = path.join(projectDir, "store");
  return fs.existsSync(storeDir) ? storeDir : projectDir;
}

export function registeredProjectDir(projectId: string): string | undefined {
  ensureProjectLocationResolverInjected();
  const registered = registeredProjectLocation(resolveUserDataDir())[projectId];
  if (!registered) return undefined;
  // 分片化后旧单文件改名为 .bak-sharded-*，活跃数据在 studio-workflow/manifest.json；
  // store 布局 v1 后两者都在 <root>/store/ 下
  const base = cliStoreBase(registered);
  return fs.existsSync(path.join(base, "studio-workflow-store.json"))
    || fs.existsSync(path.join(base, "studio-workflow", "manifest.json"))
    ? registered
    : undefined;
}

/**
 * 读取项目 studio-workflow store 状态（CLI 侧统一入口）：
 * 分片布局（studio-workflow/manifest.json → 合并分片）优先，旧单文件兜底。
 * 返回 null = 两种布局都不存在；分片损坏/缺失时抛错（绝不半合并）。
 * raw：legacy=文件原文（保持旧哈希锚点稳定）；分片=合并重建的规范串。
 */
export function readStudioWorkflowStoreState(
  projectDir: string,
): { state: Record<string, unknown>; version: number; raw: string } | null {
  const base = cliStoreBase(projectDir);
  const manifestPath = path.join(base, "studio-workflow", "manifest.json");
  if (fs.existsSync(manifestPath)) {
    const manifest = parseStudioWorkflowShardManifest(fs.readFileSync(manifestPath, "utf-8"));
    if (!manifest) throw new Error(`studio-workflow manifest 无法解析: ${manifestPath}`);
    const contents: string[] = [];
    for (const shardName of manifest.shards) {
      const shardPath = path.join(base, "studio-workflow", shardName);
      if (!fs.existsSync(shardPath)) throw new Error(`studio-workflow 分片缺失: ${shardPath}`);
      contents.push(fs.readFileSync(shardPath, "utf-8"));
    }
    const merged = mergeStudioWorkflowShards(contents);
    return {
      state: merged.state,
      version: manifest.version,
      raw: JSON.stringify({ state: merged.state, version: manifest.version }),
    };
  }
  const legacyPath = path.join(base, "studio-workflow-store.json");
  if (!fs.existsSync(legacyPath)) return null;
  const raw = fs.readFileSync(legacyPath, "utf-8");
  const parsed = JSON.parse(raw) as {
    state?: Record<string, unknown>;
    version?: number;
  };
  return {
    state: parsed.state ?? {},
    version: typeof parsed.version === "number" ? parsed.version : 0,
    raw,
  };
}

export function resolveProjectDir() {
  if (process.env.MYSTUDIO_PROJECT_DIR?.trim()) {
    return path.resolve(process.env.MYSTUDIO_PROJECT_DIR);
  }
  const storageBasePath = resolveStorageBasePath();
  const projectId = resolveProjectId(storageBasePath);
  return registeredProjectDir(projectId)
    ?? path.join(storageBasePath, "projects", "_p", projectId);
}

export function deriveStorageRoots(projectDir: string) {
  // 外部位置项目：媒体/数据根仍由应用管理（<storageBase>/projects 与 <storageBase>/media），
  // project-file:// 解析已由注入的注册表 resolver 重定向到外部项目根。
  ensureProjectLocationResolverInjected();
  const projectId = resolveProjectId();
  const registered = registeredProjectLocation(resolveUserDataDir())[projectId];
  if (registered && path.resolve(projectDir) === path.resolve(registered)) {
    const storageBase = resolveStorageBasePath();
    return {
      projectId,
      dataRoot: path.join(storageBase, "projects"),
      mediaRoot: path.join(storageBase, "media"),
      renderRoot: path.join(storageBase, "media", "studio-render"),
    };
  }
  const projectBucket = path.dirname(projectDir);
  if (path.basename(projectBucket) !== "_p") {
    throw new Error(`项目目录必须位于 projects/_p/<projectId>: ${projectDir}`);
  }
  const dataRoot = path.dirname(projectBucket);
  if (path.basename(dataRoot) !== "projects") {
    throw new Error(`项目数据根目录必须命名为 projects: ${dataRoot}`);
  }
  const storageBase = path.dirname(dataRoot);
  return {
    projectId: path.basename(projectDir),
    dataRoot,
    mediaRoot: path.join(storageBase, "media"),
    renderRoot: path.join(storageBase, "media", "studio-render"),
  };
}

export function resolveTimelineSourcePath(input: {
  sourcePath: string;
  dataRoot: string;
  mediaRoot: string;
}) {
  ensureProjectLocationResolverInjected();
  let resolved: string;
  if (input.sourcePath.startsWith("file://")) {
    resolved = fileURLToPath(input.sourcePath);
  } else if (input.sourcePath.startsWith("project-file://")) {
    resolved = resolveProjectFileUrl(input.dataRoot, input.sourcePath);
  } else if (
    input.sourcePath.startsWith("local-image://")
    || input.sourcePath.startsWith("local-video://")
  ) {
    resolved = resolveLocalMediaPath(input.mediaRoot, input.sourcePath);
  } else {
    resolved = input.sourcePath;
  }
  if (!path.isAbsolute(resolved)) {
    throw new Error(`时间线素材路径不是绝对路径: ${input.sourcePath}`);
  }
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size <= 0) {
    throw new Error(`时间线素材不可读或为空: ${input.sourcePath}`);
  }
  fs.accessSync(resolved, fs.constants.R_OK);
  return resolved;
}
