import fs from "node:fs";
import path from "node:path";

/**
 * Main-process authority for per-project external locations.
 *
 * File: <userData>/project-locations.json — { "version": 1, "locations": { [pid]: absPath } }
 *
 * The renderer-side registry (`Project.location` in mystudio-project-store.json) is
 * display-only; every `_p/<pid>` path resolution in the main process is redirected
 * according to THIS table (see storage-paths.ts setProjectLocationResolver).
 */

export type ProjectLocationStore = {
  get: (projectId: string) => string | undefined;
  set: (projectId: string, dir: string) => void;
  delete: (projectId: string) => void;
  all: () => Record<string, string>;
  filePath: () => string;
};

type CreateProjectLocationStoreOptions = {
  userDataPath: string;
  /**
   * Application projects data root (<basePath>/projects). New locations must not
   * be registered inside it (and must not contain it). Optional so standalone
   * tests can construct the store without a storage manager.
   */
  getProjectsDataRoot?: () => string;
};

const FILE_VERSION = 1;

function samePath(left: string, right: string): boolean {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function containsPath(parent: string, child: string): boolean {
  const normalizedParent = path.resolve(parent).toLowerCase();
  const normalizedChild = path.resolve(child).toLowerCase();
  if (normalizedChild === normalizedParent) return true;
  return normalizedChild.startsWith(`${normalizedParent}${path.sep}`);
}

function isValidProjectId(projectId: string): boolean {
  return (
    typeof projectId === "string" &&
    projectId.length > 0 &&
    !projectId.includes("/") &&
    !projectId.includes("\\") &&
    !projectId.includes("\0")
  );
}

function parseLocationsFile(raw: string): Record<string, string> | null {
  try {
    const parsed = JSON.parse(raw) as { locations?: unknown };
    const locations = parsed?.locations;
    if (!locations || typeof locations !== "object" || Array.isArray(locations)) return null;
    const result: Record<string, string> = {};
    for (const [pid, value] of Object.entries(locations as Record<string, unknown>)) {
      if (typeof value === "string" && value) result[pid] = value;
    }
    return result;
  } catch {
    return null;
  }
}

export function createProjectLocationStore({
  userDataPath,
  getProjectsDataRoot,
}: CreateProjectLocationStoreOptions): ProjectLocationStore {
  const locationsFilePath = path.join(userDataPath, "project-locations.json");
  let locations: Record<string, string> = {};

  const load = () => {
    try {
      if (!fs.existsSync(locationsFilePath)) return;
      const parsed = parseLocationsFile(fs.readFileSync(locationsFilePath, "utf-8"));
      if (parsed) locations = parsed;
    } catch (error) {
      console.warn("Failed to load project locations:", error);
    }
  };
  load();

  const persist = () => {
    fs.mkdirSync(path.dirname(locationsFilePath), { recursive: true });
    const temporaryPath = `${locationsFilePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify({ version: FILE_VERSION, locations }), "utf-8");
    fs.renameSync(temporaryPath, locationsFilePath);
  };

  const set = (projectId: string, dir: string) => {
    if (!isValidProjectId(projectId)) throw new Error("项目 ID 无效");
    if (typeof dir !== "string" || !dir.trim()) throw new Error("项目位置不能为空");
    if (!path.isAbsolute(dir)) throw new Error("项目位置必须是绝对路径");
    const normalizedDir = path.resolve(dir.trim());

    const dataRoot = getProjectsDataRoot?.();
    if (dataRoot && containsPath(dataRoot, normalizedDir)) {
      throw new Error("项目位置不能位于应用数据目录内部");
    }
    if (dataRoot && containsPath(normalizedDir, dataRoot)) {
      throw new Error("项目位置不能包含应用数据目录");
    }

    for (const [otherPid, otherDir] of Object.entries(locations)) {
      if (otherPid === projectId) continue;
      if (samePath(otherDir, normalizedDir)) {
        throw new Error(`项目位置已被项目 ${otherPid} 使用`);
      }
      if (containsPath(otherDir, normalizedDir) || containsPath(normalizedDir, otherDir)) {
        throw new Error(`项目位置与项目 ${otherPid} 的位置存在嵌套`);
      }
    }

    locations[projectId] = normalizedDir;
    persist();
  };

  const remove = (projectId: string) => {
    if (!(projectId in locations)) return;
    delete locations[projectId];
    persist();
  };

  return {
    get: (projectId) => locations[projectId],
    set,
    delete: remove,
    all: () => ({ ...locations }),
    filePath: () => locationsFilePath,
  };
}
