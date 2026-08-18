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
  // store 布局 v1 后根目录列举兜底失效,editing/self-media 此前全靠该兜底——
  // 显式登记后新旧布局都不再依赖目录列举(08-18-project-store-layout 回归修复)
  "editing",
  "self-media",
  // 概览元数据独立落盘(08-18-seriesmeta-store-split)
  "overview",
  // 剧本 store 中文名(08-18 改名裁定);保留 script 兼容未迁移旧项目
  "剧本",
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

  copiedCount += await copyStudioWorkflowShards(
    storage,
    sourceProjectId,
    targetProjectId,
  );

  return copiedCount;
}

/**
 * studio-workflow store 分片持久化后，数据住在 `_p/{pid}/studio-workflow/`
 * （manifest + 域分片），listKeys 只列顶层 .json 看不见子目录——按 manifest
 * 逐片拷贝到目标项目。分片内容不含 projectId，按原文搬运即可。
 */
async function copyStudioWorkflowShards(
  storage: ProjectFileStorageCopyApi,
  sourceProjectId: string,
  targetProjectId: string,
): Promise<number> {
  const sourceDirKey = `_p/${sourceProjectId}/studio-workflow`;
  const manifestRaw = await storage.getItem(`${sourceDirKey}/manifest`);
  if (!manifestRaw) return 0;

  let shardNames: string[] = [];
  try {
    const manifest = JSON.parse(manifestRaw) as { shards?: unknown };
    if (Array.isArray(manifest.shards)) {
      // 根层 <name>.json 或章节目录 chapters/<chapterId>/<name>.json
      shardNames = manifest.shards.filter(
        (name): name is string => typeof name === "string"
          && /^(?:[^/\\]+|chapters\/[^/\\]+\/[^/\\]+)\.json$/.test(name),
      );
    }
  } catch {
    // manifest 损坏 → 单文件兜底拷贝（若存在）已被主循环覆盖
  }

  let copiedCount = 0;
  for (const key of [
    `${sourceDirKey}/manifest`,
    ...shardNames.map((name) => `${sourceDirKey}/${name.replace(/\.json$/, "")}`),
  ]) {
    const rawData = await storage.getItem(key);
    if (!rawData) continue;
    const targetKey = key.replace(
      `_p/${sourceProjectId}`,
      `_p/${targetProjectId}`,
    );
    const saved = await storage.setItem(targetKey, rawData);
    if (!saved) {
      throw new Error(`项目数据写入失败: ${targetKey}`);
    }
    copiedCount += 1;
  }
  return copiedCount;
}
