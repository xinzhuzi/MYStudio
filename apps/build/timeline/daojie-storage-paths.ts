import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveLocalMediaPath,
  resolveProjectFileUrl,
} from "@/electron/storage/storage-paths";

const APP_PROCESS_NAME = "漫影工作室";
const DAOJIE_PROJECT_NAME = "道劫";

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
    || envPath("MYSTUDIO_DAOJIE_USER_DATA_DIR")
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
  const explicit = process.env.MYSTUDIO_DAOJIE_PROJECT_ID?.trim();
  if (explicit) return explicit;
  const catalogPath = path.join(storageBasePath, "projects", "mystudio-project-store.json");
  const catalog = requireRecord(readJson(catalogPath), "project catalog");
  const state = requireRecord(catalog.state, "project catalog.state");
  const projects = Array.isArray(state.projects) ? state.projects : [];
  for (const [index, value] of projects.entries()) {
    const project = requireRecord(value, `project catalog.projects[${index}]`);
    const id = typeof project.id === "string" ? project.id.trim() : "";
    const name = typeof project.name === "string" ? project.name.trim() : "";
    if (id && (name === DAOJIE_PROJECT_NAME || name.includes(DAOJIE_PROJECT_NAME))) return id;
  }
  throw new Error(
    `项目索引中未找到名称包含 ${DAOJIE_PROJECT_NAME} 的项目；请设置 MYSTUDIO_DAOJIE_PROJECT_DIR 或 MYSTUDIO_DAOJIE_PROJECT_ID`,
  );
}

export function resolveProjectDir() {
  if (process.env.MYSTUDIO_DAOJIE_PROJECT_DIR?.trim()) {
    return path.resolve(process.env.MYSTUDIO_DAOJIE_PROJECT_DIR);
  }
  const storageBasePath = resolveStorageBasePath();
  return path.join(storageBasePath, "projects", "_p", resolveProjectId(storageBasePath));
}

export function deriveStorageRoots(projectDir: string) {
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
