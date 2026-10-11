/**
 * scriptAsset 媒体任务执行体(10-11 pipeline-human-node-automation 批1,G6/G15/D5):
 * 把既有 generateAsset 编排链(润色→[道劫契约]→生图→保存)桥接进 MediaGenerationTask
 * 队列——orchestrator 零改,本模块只做包装:
 *   1. 一资产一任务:targetId={type}:{name} 资产键(与 assetLibraryRowKey 同形);
 *   2. 幂等:inputFingerprint=实体行内容+visualManualId 稳定串;同指纹+已 succeeded
 *      (或在途 running)=跳过不重跑(生图贵);
 *   3. 断言哨兵(核心新价值,禁静默成功):done≠成功——入库后经 App 桥
 *      studioAssets.getByName({type,name}) 核「行存在+filePath 非空」,不过=
 *      failed+errorReason="assertion:产物未落盘"。D5:禁直连 SQLite(根 assets.db
 *      是 0 字节假库),核验只走主进程桥;
 *   4. 进度回写:onProgress 阶段 → task.checkpointRef(phase 标记),终态收口。
 * 生成完成后自动接续「放入资产库」语义(桥 add,已有行不重复建)——「完成」的定义
 * =资产库行存在且图已落盘(PRD R1),不靠 toast 消失判断。
 * 注意:传入行须已落地本地资产(row.asset;缺本地行的确保逻辑沿用
 * useScriptAssetGenerationActions.ensureLocalAssetForRow,由调用方/批2 编排负责)。
 */
import { generateAsset } from "@/lib/studio/asset-generation-orchestrator";
import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";
import { getProjectFilesBridge } from "@/lib/bridge/project-files";
import { getAbsoluteImagePath } from "@/lib/media/image-storage";
import { createOperationId, logEvent } from "@/lib/diagnostics/logger";
import { eventBus } from "@/lib/events/event-bus";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import { useSceneStore } from "@/stores/library/scene-store";
import { usePropsLibraryStore } from "@/stores/library/props-library-store";
import type { MediaGenerationTask } from "@/types/studio";
import type { StudioAssetSummary } from "@/types/studio-assets";
import {
  getRowDescription,
  getRowPrompt,
  getRowReferenceImages,
  toGenerationTask,
  toRuntimeAssetType,
  type AssetRow,
} from "./script-asset-generation-model";

/** 断言失败的固定台账文案(批2 失败清单/重试据此分诊)。 */
export const SCRIPT_ASSET_ASSERTION_FAILURE = "assertion:产物未落盘";

export interface ScriptAssetTaskRunInput {
  /** 已落地本地资产(script-asset-generation-model 的行;须含 row.asset) */
  row: AssetRow;
  /** 视觉手册 id(生成口径的一部分,进指纹) */
  visualManualId: string;
  /** 项目 id;存在时生图落项目 workflow-images */
  projectId?: string | null;
  /** 章节/分集 id;衍生资产落章节目录,并绑进任务台账(D6 切章不中断) */
  chapterId?: string | null;
}

export type ScriptAssetTaskRunResult = {
  status: "success" | "failed" | "skipped";
  taskId: string;
  targetId: string;
  inputFingerprint: string;
  /** 成功=资产库 filePath;失败原因见 errorReason */
  outputRef?: string;
  errorReason?: string;
};

/** targetId 资产键:{type}:{name}(与 assetLibraryRowKey 同形,G15)。 */
export function scriptAssetTargetKey(row: Pick<AssetRow, "type" | "name">): string {
  return `${row.type}:${row.name}`;
}

/**
 * inputFingerprint:实体行内容+visualManualId 的稳定串(键排序 JSON,同
 * videoCandidateFingerprint/stableHash 口径)。data: 参考图只记长度标记——
 * 指纹要随任务持久化,整段 base64 进台账会把存储打爆。
 */
export function computeScriptAssetInputFingerprint(
  row: AssetRow,
  visualManualId: string,
): string {
  return stableStringify({
    fingerprintKind: "scriptAsset:v1",
    type: row.type,
    name: row.name,
    note: row.note ?? null,
    description: getRowDescription(row) ?? "",
    prompt: getRowPrompt(row) ?? "",
    identityAnchors:
      row.type === "character" ? row.asset?.identityAnchors ?? null : null,
    referenceImages: compactReferenceImageMarkers(getRowReferenceImages(row)),
    visualManualId,
  });
}

/**
 * 幂等/防重入查询:同 targetId+同指纹且已 succeeded 或在途 running 的
 * scriptAsset 任务。succeeded=跳过不重跑;running=并入在途(连点不重复发车)。
 */
export function findReusableScriptAssetTask(
  targetId: string,
  inputFingerprint: string,
): MediaGenerationTask | undefined {
  const tasks = useStudioStore.getState().mediaTasks;
  for (let i = tasks.length - 1; i >= 0; i -= 1) {
    const task = tasks[i];
    if (
      task.kind === "scriptAsset" &&
      task.targetId === targetId &&
      task.inputFingerprint === inputFingerprint &&
      (task.status === "success" || task.status === "running")
    ) {
      return task;
    }
  }
  return undefined;
}

/**
 * 单资产任务执行入口:创建 scriptAsset 媒体任务 → generateAsset 编排链 →
 * 自动入库 → 断言哨兵 → 终态收口。不抛异常,一切失败以结果/台账可见。
 */
export async function runScriptAssetMediaTask(
  input: ScriptAssetTaskRunInput,
): Promise<ScriptAssetTaskRunResult> {
  const { row, visualManualId } = input;
  const targetId = scriptAssetTargetKey(row);
  const inputFingerprint = computeScriptAssetInputFingerprint(row, visualManualId);
  const store = useStudioStore.getState();

  const reusable = findReusableScriptAssetTask(targetId, inputFingerprint);
  if (reusable) {
    return {
      status: "skipped",
      taskId: reusable.id,
      targetId,
      inputFingerprint,
      outputRef: reusable.outputRef,
    };
  }

  const previousFailed = latestFailedScriptAssetTask(targetId, inputFingerprint);
  const taskId = store.startMediaTask({
    kind: "scriptAsset",
    targetId,
    episodeId: input.chapterId ?? undefined,
    inputFingerprint,
    checkpointRef: "phase:queued",
    retryOf: previousFailed?.id,
  });

  const bridge = getStudioAssetsBridge();
  if (!bridge?.getByName || !bridge.add) {
    const reason = "资产库接口仅在桌面应用中可用,无法入库核验";
    store.failMediaTask(taskId, reason, "phase:bridge");
    return { status: "failed", taskId, targetId, inputFingerprint, errorReason: reason };
  }

  const generationTask = toGenerationTask(
    row,
    visualManualId,
    input.projectId,
    input.chapterId,
  );
  if (!generationTask) {
    const reason = !row.asset
      ? `缺少可生成的本地资产:${targetId}(须先落地本地资产再入队)`
      : `资产已有图片,无需再生成:${targetId}`;
    store.failMediaTask(taskId, reason, "phase:prepared");
    return { status: "failed", taskId, targetId, inputFingerprint, errorReason: reason };
  }

  let result;
  try {
    result = await generateAsset(generationTask, (progress) => {
      writeScriptAssetCheckpoint(taskId, progress.phase);
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    store.failMediaTask(taskId, message, "phase:thrown");
    return { status: "failed", taskId, targetId, inputFingerprint, errorReason: message };
  }
  if (result.phase !== "done" || !result.imageLocalPath) {
    const reason = result.error ?? "资产生成失败";
    store.failMediaTask(taskId, reason, `phase:${result.phase}`);
    return { status: "failed", taskId, targetId, inputFingerprint, errorReason: reason };
  }

  // ── 自动入库(接续手动「放入资产库」语义;已有行不重复建,add 只回填空字段) ──
  writeScriptAssetCheckpoint(taskId, "storing");
  const assetType = toRuntimeAssetType(row.type);
  let storeError: string | undefined;
  try {
    const existing = await bridge.getByName({ type: assetType, name: row.name });
    if (!existing) {
      const fresh = readFreshScriptAssetRow(row);
      const description = getRowDescription(fresh) || row.note || row.name;
      const prompt =
        result.polishResult?.status === "success"
          ? result.polishResult.prompt
          : getRowPrompt(fresh) || description;
      const sourceFilePath = await resolveScriptAssetSourceFilePath(
        result.imageLocalPath,
      );
      const created = await bridge.add({
        type: assetType,
        name: row.name,
        ...(sourceFilePath ? { sourceFilePath } : {}),
        description,
        prompt,
        setting: scriptAssetLibrarySetting(fresh),
      });
      if (created) {
        eventBus.emit("asset:updated", { id: created.id, type: created.type });
      }
    }
  } catch (err) {
    storeError = err instanceof Error ? err.message : String(err);
  }

  // ── 断言哨兵:done≠成功,经 App 桥核「行存在+filePath 非空」(D5 禁直连 SQLite) ──
  writeScriptAssetCheckpoint(taskId, "asserting");
  let asserted: StudioAssetSummary | null = null;
  try {
    asserted = await bridge.getByName({ type: assetType, name: row.name });
  } catch (err) {
    const reason = `assertion:产物核验桥异常:${err instanceof Error ? err.message : String(err)}`;
    store.failMediaTask(taskId, reason, "phase:assertion");
    return { status: "failed", taskId, targetId, inputFingerprint, errorReason: reason };
  }
  const assertionPass = Boolean(
    asserted &&
      typeof asserted.filePath === "string" &&
      asserted.filePath.trim() !== "",
  );
  if (!assertionPass || !asserted) {
    // 台账用固定文案(批2 分诊锚);入库异常细节落诊断 jsonl,不静默
    void logEvent({
      level: "error",
      category: "asset",
      operationId: createOperationId("script-asset-task"),
      message: "scriptAsset assertion failed: asset row missing or filePath empty",
      context: {
        targetId,
        assetType,
        assetName: row.name,
        storeError: storeError ?? null,
        generatedImageLocalPath: result.imageLocalPath,
      },
    });
    store.failMediaTask(taskId, SCRIPT_ASSET_ASSERTION_FAILURE, "phase:assertion");
    return {
      status: "failed",
      taskId,
      targetId,
      inputFingerprint,
      errorReason: SCRIPT_ASSET_ASSERTION_FAILURE,
    };
  }

  store.finishMediaTask(taskId, {
    outputRef: asserted.filePath,
    checkpointRef: "phase:done",
  });
  return {
    status: "success",
    taskId,
    targetId,
    inputFingerprint,
    outputRef: asserted.filePath,
  };
}

// ── 内部辅助 ─────────────────────────────────────────────────────────────

function latestFailedScriptAssetTask(
  targetId: string,
  inputFingerprint: string,
): MediaGenerationTask | undefined {
  const tasks = useStudioStore.getState().mediaTasks;
  for (let i = tasks.length - 1; i >= 0; i -= 1) {
    const task = tasks[i];
    if (
      task.kind === "scriptAsset" &&
      task.targetId === targetId &&
      task.inputFingerprint === inputFingerprint &&
      task.status === "failed"
    ) {
      return task;
    }
  }
  return undefined;
}

/**
 * onProgress 阶段 → task.checkpointRef 直写(phase 标记)。只动 checkpointRef
 * 字段,不碰状态机(queued/running/success/failed 仍由队列 action 收口)。
 */
function writeScriptAssetCheckpoint(taskId: string, phase: string) {
  useStudioStore.setState((state) => ({
    mediaTasks: state.mediaTasks.map((task) =>
      task.id === taskId
        ? { ...task, checkpointRef: `phase:${phase}`, updatedAt: Date.now() }
        : task,
    ),
  }));
}

/** 生成完成后按 id 重读本地行(add payload 用新鲜内容:润色产物已写回 store)。 */
function readFreshScriptAssetRow(row: AssetRow): AssetRow {
  const assetId = row.asset?.id ?? row.id;
  if (row.type === "character") {
    const asset = useCharacterLibraryStore.getState().getCharacterById(assetId);
    return asset ? { ...row, asset } : row;
  }
  if (row.type === "scene") {
    const asset = useSceneStore.getState().getSceneById(assetId);
    return asset ? { ...row, asset } : row;
  }
  const asset = usePropsLibraryStore.getState().getPropById(assetId);
  return asset ? { ...row, asset } : row;
}

/** 入库 setting(对齐 useScriptAssetGenerationActions.getAssetLibrarySetting 口径)。 */
function scriptAssetLibrarySetting(row: AssetRow): string {
  if (row.note) return row.note;
  if (row.type === "character") {
    return [row.asset?.role, row.asset?.traits, row.asset?.personality, row.asset?.notes]
      .filter(Boolean)
      .join("。");
  }
  if (row.type === "scene") {
    return [row.asset?.location, row.asset?.time, row.asset?.atmosphere, row.asset?.notes]
      .filter(Boolean)
      .join("。");
  }
  return row.asset?.category ?? "";
}

/**
 * 生成产物地址 → 资产库 add 需要的受源路径白名单约束的绝对路径
 * (对齐 useScriptAssetGenerationActions.resolveAssetSourceFilePath 口径)。
 */
async function resolveScriptAssetSourceFilePath(
  image: string,
): Promise<string | undefined> {
  if (image.startsWith("local-image://")) {
    return (await getAbsoluteImagePath(image)) ?? undefined;
  }
  if (image.startsWith("project-file://")) {
    // 生图产物落项目 workflow-images,须经主进程桥解析绝对路径后才能入库拷贝
    return (await getProjectFilesBridge()?.getAbsolutePath(image)) ?? undefined;
  }
  if (image.startsWith("file://")) {
    try {
      return decodeURIComponent(new URL(image).pathname);
    } catch {
      return undefined;
    }
  }
  if (image.startsWith("/")) return image;
  return undefined;
}

/** data: 参考图只记长度(变更敏感),其余 URL 原样进指纹。 */
function compactReferenceImageMarkers(images: string[] | undefined): string[] {
  return (images ?? []).map((image) =>
    image.startsWith("data:")
      ? `data-url:${image.length}`
      : image,
  );
}

/** 键排序稳定串(同 studio-store-continuity-helpers.stableHash 口径)。 */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, nested) => {
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) return nested;
    return Object.keys(nested)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = (nested as Record<string, unknown>)[key];
        return acc;
      }, {});
  });
}
