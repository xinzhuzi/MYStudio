export interface ProjectFileStorageCopyApi {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<boolean>;
  listKeys?: (prefix: string) => Promise<string[]>;
}

export const PROJECT_SCOPED_STORE_NAMES = [
  "director",
  "script",
  "sclass",
  "timeline",
  "tts",
  "studio-workflow-store",
  "characters",
  "media",
  "scenes",
  "props",
] as const;

export function buildProjectStoreKeys(
  projectId: string,
  listedKeys: string[],
): string[] {
  const prefix = `_p/${projectId}/`;
  return [
    ...new Set([
      ...listedKeys.filter((key) => key.startsWith(prefix)),
      ...PROJECT_SCOPED_STORE_NAMES.map((storeName) => `${prefix}${storeName}`),
    ]),
  ];
}

export function rewriteProjectScopedPayload(
  rawData: string,
  sourceProjectId: string,
  targetProjectId: string,
): string {
  const parsed = JSON.parse(rawData) as {
    state?: Record<string, unknown>;
  } & Record<string, unknown>;
  const state = (parsed.state ?? parsed) as Record<string, unknown>;
  if (state.activeProjectId === sourceProjectId) {
    state.activeProjectId = targetProjectId;
  }
  const projects = state.projects;
  if (
    projects &&
    typeof projects === "object" &&
    !Array.isArray(projects) &&
    Object.prototype.hasOwnProperty.call(projects, sourceProjectId)
  ) {
    const projectRecord = projects as Record<string, unknown>;
    projectRecord[targetProjectId] = projectRecord[sourceProjectId];
    delete projectRecord[sourceProjectId];
  }
  return JSON.stringify(parsed);
}

export async function waitForProjectStoreFile(
  storage: Pick<ProjectFileStorageCopyApi, "getItem">,
  key: string,
  timeoutMs = 3000,
): Promise<string> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (true) {
    const value = await storage.getItem(key);
    if (value) return value;
    if (Date.now() >= deadline) {
      throw new Error(`等待项目数据写入超时: ${key}`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
}

export async function copyProjectScopedStoreFiles(
  storage: ProjectFileStorageCopyApi,
  sourceProjectId: string,
  targetProjectId: string,
): Promise<number> {
  const listedKeys =
    (await storage.listKeys?.(`_p/${sourceProjectId}`)) ?? [];
  const keysToCopy = buildProjectStoreKeys(sourceProjectId, listedKeys);
  let copiedCount = 0;

  for (const key of keysToCopy) {
    const rawData = await storage.getItem(key);
    if (!rawData) continue;
    let dataToWrite = rawData;
    try {
      dataToWrite = rewriteProjectScopedPayload(
        rawData,
        sourceProjectId,
        targetProjectId,
      );
    } catch {
      // Non-JSON project data is copied byte-for-byte.
    }
    const targetKey = key.replace(
      `_p/${sourceProjectId}`,
      `_p/${targetProjectId}`,
    );
    const saved = await storage.setItem(targetKey, dataToWrite);
    if (!saved) {
      throw new Error(`项目数据写入失败: ${targetKey}`);
    }
    copiedCount += 1;
  }

  return copiedCount;
}
