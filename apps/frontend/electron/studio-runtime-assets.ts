import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  StudioAssetKind,
  StudioAssetListRequest,
  StudioAssetListResponse,
  StudioAssetSummary,
} from "../types/studio-assets";

const execFileAsync = promisify(execFile);

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".mkv", ".avi"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"]);
const DB_ASSET_TYPES = new Set<StudioAssetKind>(["role", "scene", "tool", "audio"]);
const FILE_ASSET_CACHE_TTL_MS = 30_000;

type FileAssetCacheEntry = {
  createdAt: number;
  items: StudioAssetSummary[];
};

type RuntimeAssetRow = {
  id?: number | string;
  assetsId?: number | string | null;
  name?: string;
  type?: StudioAssetKind;
  prompt?: string;
  describe?: string;
  remark?: string;
  filePath?: string;
  state?: string;
  flowId?: number | string | null;
  childrenCount?: number;
  projectId?: number | string;
};

const fileAssetCache = new Map<StudioAssetKind, FileAssetCacheEntry>();

export function getToonflowDataRoot() {
  return path.join(os.homedir(), "Library", "Application Support", "toonflow", "data");
}

export function getToonflowOssRoot() {
  return path.join(getToonflowDataRoot(), "oss");
}

export function resolveToonflowAssetPath(requestUrl: string) {
  const url = new URL(requestUrl);
  const relativePath = [
    url.hostname,
    ...url.pathname.split("/").filter(Boolean),
  ]
    .map((part) => decodeURIComponent(part))
    .join("/");
  const ossRoot = path.resolve(getToonflowOssRoot());
  const filePath = path.resolve(ossRoot, relativePath.replace(/^oss[\\/]/, ""));
  if (filePath !== ossRoot && !filePath.startsWith(ossRoot + path.sep)) {
    throw new Error("Toonflow asset path escapes storage root");
  }
  return filePath;
}

export async function listStudioRuntimeAssets(request: StudioAssetListRequest): Promise<StudioAssetListResponse> {
  const type = normalizeAssetKind(request.type);
  const search = (request.search ?? "").trim();
  const offset = clampInteger(request.offset, 0, 200000, 0);
  const limit = clampInteger(request.limit, 1, 500, 120);

  try {
    const response = DB_ASSET_TYPES.has(type)
      ? await listAssetsFromSqlite({ type, search, offset, limit })
      : await listAssetsFromFiles({ type, search, offset, limit, refresh: Boolean(request.refresh) });
    return {
      ...response,
      roots: {
        toonflowDataRoot: getToonflowDataRoot(),
        toonflowOssRoot: getToonflowOssRoot(),
      },
    };
  } catch (error) {
    const fallback = await listAssetsFromFiles({ type, search, offset, limit, refresh: Boolean(request.refresh) }).catch((fallbackError) => ({
      success: false,
      items: [],
      total: 0,
      error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
    }));
    return {
      ...fallback,
      error: fallback.success
        ? undefined
        : error instanceof Error
          ? error.message
          : String(error),
      roots: {
        toonflowDataRoot: getToonflowDataRoot(),
        toonflowOssRoot: getToonflowOssRoot(),
      },
    };
  }
}

async function listAssetsFromSqlite(input: {
  type: StudioAssetKind;
  search: string;
  offset: number;
  limit: number;
}): Promise<Omit<StudioAssetListResponse, "roots">> {
  const dbPath = path.join(getToonflowDataRoot(), "db2.sqlite");
  if (!fs.existsSync(dbPath)) {
    return listAssetsFromFiles(input);
  }

  const typeCondition = `a.type = ${sqlString(input.type)}`;
  const searchCondition = input.search
    ? ` and (a.name like ${sqlString(`%${input.search}%`)} or a.describe like ${sqlString(`%${input.search}%`)})`
    : "";
  const where = `${typeCondition}${searchCondition}`;
  const query = `
    select
      a.id,
      a.assetsId,
      a.name,
      a.type,
      a.prompt,
      a.describe,
      a.remark,
      a.projectId,
      a.flowId,
      i.filePath,
      i.state,
      (
        select count(*)
        from o_assets child
        where child.assetsId = a.id
      ) as childrenCount
    from o_assets a
    left join o_image i on a.imageId = i.id
    where ${where}
    order by a.id asc
    limit ${input.limit}
    offset ${input.offset};
  `;
  const countQuery = `select count(*) as total from o_assets a where ${where};`;

  const [itemsOutput, countOutput] = await Promise.all([
    runSqliteJson<RuntimeAssetRow[]>(dbPath, query),
    runSqliteJson<Array<{ total?: number }>>(dbPath, countQuery),
  ]);
  return {
    success: true,
    items: itemsOutput
      .map((row) => mapRuntimeAssetRowForTest(row, input.type))
      .filter((item): item is StudioAssetSummary => Boolean(item)),
    total: Number(countOutput[0]?.total ?? 0),
  };
}

async function listAssetsFromFiles(input: {
  type: StudioAssetKind;
  search: string;
  offset: number;
  limit: number;
  refresh?: boolean;
}): Promise<Omit<StudioAssetListResponse, "roots">> {
  const entries = collectCachedFileAssets(input.type, Boolean(input.refresh));
  const keyword = input.search.toLocaleLowerCase("zh-Hans-CN");
  const filtered = keyword
    ? entries.filter((item) => {
      const haystack = `${item.name} ${item.description ?? ""} ${item.sourcePath ?? ""}`.toLocaleLowerCase("zh-Hans-CN");
      return haystack.includes(keyword);
    })
    : entries;
  return {
    success: true,
    items: filtered.slice(input.offset, input.offset + input.limit),
    total: filtered.length,
  };
}

function collectCachedFileAssets(type: StudioAssetKind, refresh: boolean) {
  const cached = fileAssetCache.get(type);
  if (!refresh && cached && Date.now() - cached.createdAt < FILE_ASSET_CACHE_TTL_MS) {
    return cached.items;
  }
  const items = collectFileAssets(type);
  fileAssetCache.set(type, { createdAt: Date.now(), items });
  return items;
}

function collectFileAssets(type: StudioAssetKind) {
  const ossRoot = getToonflowOssRoot();
  if (!fs.existsSync(ossRoot)) return [];

  const projectDirs = fs.readdirSync(ossRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  const entries: StudioAssetSummary[] = [];
  for (const projectId of projectDirs) {
    for (const relDir of getFileAssetDirs(type)) {
      const absoluteDir = path.join(ossRoot, projectId, relDir);
      if (!fs.existsSync(absoluteDir)) continue;
      const files = fs.readdirSync(absoluteDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && isSupportedAssetExtension(type, entry.name))
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));

      for (const filename of files) {
        const relPath = joinOssRelative(projectId, relDir, filename);
        const sourcePath = path.join(ossRoot, relPath);
        const name = path.basename(filename, path.extname(filename));
        const thumbnailRelPath = resolveThumbnailRelPath(relPath, type);
        entries.push({
          id: `toonflow-file:${type}:${relPath}`,
          source: "toonflow-runtime",
          type,
        name,
        description: `本地 ${type === "clip" ? "视频" : "素材"}文件`,
        setting: sourcePath,
        thumbnailUrl: thumbnailRelPath ? toToonflowAssetUrl(thumbnailRelPath) : undefined,
        previewUrl: toToonflowAssetUrl(relPath),
        filePath: `/${relPath}`,
          sourcePath,
          state: "success",
        });
      }
    }
  }

  if (type === "clip") {
    entries.push(...collectStaticClipAssets());
  }
  return entries;
}

function collectStaticClipAssets() {
  const assetsRoot = path.join(getToonflowDataRoot(), "assets");
  if (!fs.existsSync(assetsRoot)) return [];
  return fs.readdirSync(assetsRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isSupportedAssetExtension("clip", entry.name))
    .map<StudioAssetSummary>((entry) => {
      const sourcePath = path.join(assetsRoot, entry.name);
      const name = path.basename(entry.name, path.extname(entry.name));
      return {
        id: `toonflow-static-clip:${entry.name}`,
        source: "toonflow-runtime",
        type: "clip",
        name,
        description: "本地视频素材",
        setting: sourcePath,
        previewUrl: `file://${sourcePath}`,
        filePath: sourcePath,
        sourcePath,
        state: "success",
      };
    });
}

export function mapRuntimeAssetRowForTest(row: RuntimeAssetRow, fallbackType: StudioAssetKind): StudioAssetSummary | null {
  const type = normalizeAssetKind(row.type ?? fallbackType);
  const filePath = normalizeOssRelativePath(row.filePath);
  const thumbnailPath = filePath ? resolveThumbnailRelPath(filePath, type) : undefined;
  const previewPath = filePath;
  const name = String(row.name ?? "").trim() || (filePath ? path.basename(filePath, path.extname(filePath)) : "未命名素材");

  return {
    id: `toonflow-db:${row.id ?? `${type}:${filePath || name}`}`,
    source: "toonflow-runtime",
    type,
    name,
    description: normalizeDescription(row.describe),
    setting: normalizeDescription(row.remark || row.describe),
    remark: normalizeDescription(row.remark),
    prompt: row.prompt || undefined,
    thumbnailUrl: thumbnailPath ? toToonflowAssetUrl(thumbnailPath) : undefined,
    previewUrl: previewPath ? toToonflowAssetUrl(previewPath) : undefined,
    filePath: filePath ? `/${filePath}` : undefined,
    sourcePath: filePath ? path.join(getToonflowOssRoot(), filePath) : undefined,
    state: row.state,
    imageWorkflowId: row.flowId == null ? undefined : String(row.flowId),
    parentAssetId: row.assetsId == null ? undefined : `toonflow-db:${row.assetsId}`,
    toonflowAssetId: normalizeNumber(row.id),
    toonflowParentAssetId: normalizeNumber(row.assetsId),
    childrenCount: Number(row.childrenCount ?? 0),
  };
}

function normalizeNumber(value: number | string | null | undefined) {
  if (value == null || value === "") return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

async function runSqliteJson<T>(dbPath: string, query: string): Promise<T> {
  const { stdout } = await execFileAsync("sqlite3", ["-json", dbPath, query], {
    maxBuffer: 20 * 1024 * 1024,
  });
  const trimmed = stdout.trim();
  if (!trimmed) return [] as T;
  return JSON.parse(trimmed) as T;
}

function getFileAssetDirs(type: StudioAssetKind) {
  switch (type) {
    case "role":
      return ["assets/role", "role"];
    case "scene":
      return ["assets/scene", "scene"];
    case "tool":
      return ["assets/tool", "props"];
    case "audio":
      return ["audio"];
    case "clip":
      return ["video", "assets"];
  }
}

function resolveThumbnailRelPath(relPath: string, type: StudioAssetKind) {
  if (type !== "role" && type !== "scene" && type !== "tool") return undefined;
  const smallImagePath = joinOssRelative("smallImage", relPath);
  return fs.existsSync(path.join(getToonflowOssRoot(), smallImagePath)) ? smallImagePath : relPath;
}

function isSupportedAssetExtension(type: StudioAssetKind, filename: string) {
  const extension = path.extname(filename).toLowerCase();
  if (type === "audio") return AUDIO_EXTENSIONS.has(extension);
  if (type === "clip") return VIDEO_EXTENSIONS.has(extension) || IMAGE_EXTENSIONS.has(extension);
  return IMAGE_EXTENSIONS.has(extension);
}

function toToonflowAssetUrl(relPath: string) {
  return `toonflow-asset://oss/${relPath.split(/[\\/]+/).map((part) => encodeURIComponent(part)).join("/")}`;
}

function joinOssRelative(...parts: string[]) {
  return parts
    .flatMap((part) => part.split(/[\\/]+/))
    .filter(Boolean)
    .join("/");
}

function normalizeOssRelativePath(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^[\\/]+/, "").replace(/\\/g, "/");
}

function normalizeDescription(value: unknown) {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim();
  if (!cleaned) return undefined;
  const parts = cleaned.split("|").filter(Boolean);
  return parts.length > 1 ? parts.slice(1).join(" / ") : cleaned;
}

function normalizeAssetKind(value: unknown): StudioAssetKind {
  if (value === "role" || value === "scene" || value === "tool" || value === "clip" || value === "audio") {
    return value;
  }
  return "tool";
}

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(numberValue)));
}

function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}
