import { getLocalImageToken } from "@/lib/ai/local-image-token";
import type { AssetType } from "@/lib/ai/prompt-polisher";
import { createOperationId, logEvent } from "@/lib/diagnostics/logger";
import type { ImageCategory } from "@/lib/media/image-storage";
import { readImageAsBase64 } from "@/lib/media/image-storage";
import { saveGeneratedAssetImage, updateStoreWithResult } from "./asset-generation-store-writers";
import { SHEET_CARD_FORMAT_DEFAULT, isSheetCardFormat, type SheetCardFormat } from "./asset-image-kind";
import type { AssetTypeShotProgress } from "./asset-type-shot";

/**
 * 资产库设定卡 B 线 i2i 件 App 侧客户端(1121,PRD .trellis/tasks/11-21-asset-sheet-bline-i2i)。
 *
 * 设定卡生成口换血:t2i 自由版式直射 → QwenImage2.1 域「道劫-角色设定卡-i2i.json」整链
 * (master 接人物多视图正视图[1122 用户令修正:须带装参考] → 五路编辑+武器/特效 t2i → head/表情×5 二级链 →
 * MySheetCardComposer 程序底框合成 4K 整卡)。本模块只做 App 层(R2+R3):sidecar
 * 任务接口调用 + 异步任务进度轮询(裁定B,复用按型出图既有 progress 线)+ 转移表
 * 全态 + 4K 卡收编替换守卫。
 *
 * 接口契约(对齐 sidecar 实现 image_gen/server.py「设定卡 B线 i2i」节;R1 同役落地):
 * - 提交 POST /v1/images/sheet-i2i,body = {model("qwen-image-2-1"), prompt(竖线字段式
 *   主体句), reference_image(master 角色图 b64/data URL), extra:{角名, sheet_format,
 *   sheet_bg}, taskId?(续跑=同 id 重发,已落盘子步跳过;参考图以盘上首存为准)}。
 * - 轮询 GET /v1/images/sheet-i2i/{id}:{taskId, status(running/partial-failed/
 *   cancelled/done), progress:{done,total,percent}, steps[], currentStep, resumable,
 *   resultReady?, error?}(盘上子步产物真源重建;非终态禁归 running——重启残账恒
 *   重建 partial-failed)。
 * - 取件 GET /v1/images/sheet-i2i/{id}/result:{data:[{b64_json}]}(仅 done;未完 409
 *   禁半卡)。
 * - 取消 POST /v1/images/sheet-i2i/{id}/cancel(引擎单发秒杀在途子步,已落盘保留)。
 *
 * 转移表(App 侧状态机,PRD「转移表」节逐行):
 * - idle→firing(lane 互斥+master 图在库+主体句非空);master 缺失=toast 引导不换态
 *   (守卫在派发层 studio-asset-detail-actions;本层 belt-and-braces 再拒一次);
 * - firing 子步账(进度=step i/14;server running+compose 相位=composing 派生态);
 *   任一子步失败→partial-failed(报错+续跑重入口);
 * - firing 全子步完→composing(程序合成秒级);合成失败→partial-failed(可续跑);
 * - composing 过 alpha/尺寸门禁→saving(4K 卡落盘);saving 收编完→done;
 * - saving 收编次序(1122 C 接线,多张化解禁 PRD 11-22-asset-sheet-multi):先收编
 *   验收→成功才清**该格式槽内**旧图(replaceSheetCardKindImageAfterAcceptance,
 *   由派发层 executeTypeShot 接线调用);收编失败=failed,全槽旧图原位不动
 *   (未过验收禁删;4K 整卡造价高,失败必须原位保留旧卡)。
 *   注:多张纪律=格式四档各一槽(同档再生成=槽内替换,异档并存零干预),设定卡
 *   已摘出 SINGLE_IMAGE_KINDS——本模块零清旧职责,清旧全在派发层守卫内;
 * - firing/composing 取消→cancelled(已落盘子步保留);
 * - App 重启/刷新:store 水合见非终态→partial-failed(poller 役「水合不归一 running」
 *   坑在档——非终态禁归 running,统一归一 partial-failed 保续跑口)。
 */

/** B 线换路的型名(1121 PRD R2:仅设定卡换路,其余 13 型路由零变化)。 */
export const SHEET_CARD_BLINE_KIND = "设定卡" as const;

/** B 线布局名(PRD R1;sidecar 端点即 B 线路,本常量为诊断对账锚)。 */
export const SHEET_CARD_BLINE_LAYOUT = "qwen21-sheet-i2i";

/** 提交模型名(server start_task 校验=qwen21.MODEL_NAME,与按型出图同渠道)。 */
export const SHEET_CARD_BLINE_MODEL = "qwen-image-2-1";

/**
 * Composer 旋钮(1122 格式入参化,裁定D 后续令到岗):sheet_format 改 runSheetCardBLine
 * 入参(四档真源 SHEET_CARD_FORMATS/缺省全卡住 asset-image-kind;UI 四选一见设定卡节
 * 生成入口),本模块不再钉死常量;sheet_bg 一期仍固定纯白(bg 轴未开)。
 */
export const SHEET_CARD_BG = "纯白";

/** 子步总数口径(server GENERATION_STEP_COUNT=14,转移表进度分母;轮询回报优先)。 */
export const SHEET_CARD_TOTAL_STEPS = 14;

/** 本地生图 sidecar 固定口(run-uncloth 同款先例;remote 引擎仍由 sidecar 转发)。 */
const LOCAL_IMAGE_BASE_URL = "http://127.0.0.1:17595";

const SUBMIT_PATH = "/v1/images/sheet-i2i";
const taskPath = (taskId: string) => `/v1/images/sheet-i2i/${encodeURIComponent(taskId)}`;
const resultPath = (taskId: string) => `${taskPath(taskId)}/result`;
const cancelPath = (taskId: string) => `${taskPath(taskId)}/cancel`;

/** server compose 相位标记(qwen21_sheet.COMPOSE_TAG;compose 不占子步号,落 final.png)。 */
const COMPOSE_STEP_TAG = "compose";

/** 任务态(App 侧状态机;done 不入持久记录——完成即清,无续跑价值)。 */
export type SheetCardBLineTaskStatus =
  | "firing"
  | "composing"
  | "saving"
  | "partial-failed"
  | "cancelled"
  | "failed";

/** 非终态集合(水合归一基准:重启后见非终态→partial-failed,禁归 running)。 */
const NON_TERMINAL_STATUSES: ReadonlySet<SheetCardBLineTaskStatus> = new Set(["firing", "composing", "saving"]);

/**
 * 持久记录合法态域(≠server 任务态词表):firing/composing/saving/partial-failed/
 * cancelled/failed。running/saving 域外词(如 server 的 running)恒拒——poller 役坑
 * 「水合不归一 running」的第一道闸(记录层根本不许 running 入册)。
 */
const RECORD_STATUSES: ReadonlySet<string> = new Set([
  "firing",
  "composing",
  "saving",
  "partial-failed",
  "cancelled",
  "failed",
]);

/** server 任务态宽容归一(镜像 image-task-poller statusMap 纪律:同义词收编,未知拒收)。 */
const STATUS_ALIASES: Readonly<Record<string, SheetCardBLineTaskStatus | "done">> = {
  running: "firing",
  firing: "firing",
  processing: "firing",
  in_progress: "firing",
  pending: "firing",
  queued: "firing",
  "partial-failed": "partial-failed",
  partial_failed: "partial-failed",
  partialfailed: "partial-failed",
  interrupted: "partial-failed",
  failed: "partial-failed",
  error: "partial-failed",
  cancelled: "cancelled",
  canceled: "cancelled",
  done: "done",
  completed: "done",
  succeeded: "done",
  success: "done",
};

/** 持久任务记录(单资产一槽;localStorage,坏记录水合丢弃不炸)。 */
export interface SheetCardBLineTaskRecord {
  assetId: string;
  taskId: string;
  status: SheetCardBLineTaskStatus;
  step: number;
  totalSteps: number;
  updatedAt: number;
}

const RECORDS_STORAGE_KEY = "manying.asset-sheet-card-bline.tasks.v1";
/** 记录表上限(防长期堆积;超出按 updatedAt 淘汰最旧)。 */
const MAX_RECORDS = 8;

type RecordStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

let storageForTests: RecordStorage | null = null;

/** 测试注入位(照 local-image-token 范式;node 环境无 localStorage)。 */
export function setSheetCardBLineStorageForTests(storage: RecordStorage | null): void {
  storageForTests = storage;
}

function getRecordStorage(): RecordStorage | null {
  if (storageForTests) return storageForTests;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** 持久记录形状校验(坏记录回落 null,不炸水合;storyboard 会话 sanitize 同款纪律)。 */
export function sanitizeSheetCardBLineRecord(raw: unknown): SheetCardBLineTaskRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Partial<SheetCardBLineTaskRecord>;
  if (
    typeof record.assetId !== "string"
    || typeof record.taskId !== "string"
    || typeof record.status !== "string"
    || !RECORD_STATUSES.has(record.status)
    || typeof record.step !== "number"
    || typeof record.totalSteps !== "number"
    || typeof record.updatedAt !== "number"
  ) {
    return null;
  }
  return {
    assetId: record.assetId,
    taskId: record.taskId,
    status: record.status as SheetCardBLineTaskStatus,
    step: record.step,
    totalSteps: record.totalSteps,
    updatedAt: record.updatedAt,
  };
}

/**
 * 水合归一(poller 役坑在档:非终态禁归 running):读取即归一——非终态
 * (firing/composing/saving)一律改判 partial-failed 并回写,续跑口保留;
 * App 侧在跑任务的记录由本轮 promise 持有真值,水合归一只发生在重启后的陈旧记录上。
 */
function readAllRecordsHydrated(): Record<string, SheetCardBLineTaskRecord> {
  const storage = getRecordStorage();
  if (!storage) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(storage.getItem(RECORDS_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object") return {};
  const source = parsed as Record<string, unknown>;
  const hydrated: Record<string, SheetCardBLineTaskRecord> = {};
  let rewrote = false;
  for (const [assetId, raw] of Object.entries(source)) {
    const record = sanitizeSheetCardBLineRecord(raw);
    if (!record || record.assetId !== assetId) {
      rewrote = true;
      continue;
    }
    if (NON_TERMINAL_STATUSES.has(record.status)) {
      hydrated[assetId] = { ...record, status: "partial-failed" };
      rewrote = true;
    } else {
      hydrated[assetId] = record;
    }
  }
  if (rewrote) writeAllRecords(storage, hydrated);
  return hydrated;
}

function writeAllRecords(storage: RecordStorage, records: Record<string, SheetCardBLineTaskRecord>): void {
  try {
    storage.setItem(RECORDS_STORAGE_KEY, JSON.stringify(records));
  } catch {
    /* 持久化尽力而为:写失败不阻断在跑任务(内存态由本轮 promise 持有) */
  }
}

/** 读该资产的持久任务记录(读取即水合归一:非终态→partial-failed)。 */
export function readSheetCardBLineRecord(assetId: string): SheetCardBLineTaskRecord | null {
  return readAllRecordsHydrated()[assetId] ?? null;
}

/** 写/更新该资产的任务记录(容量超限时按 updatedAt 淘汰最旧)。 */
export function writeSheetCardBLineRecord(record: SheetCardBLineTaskRecord): void {
  const storage = getRecordStorage();
  if (!storage) return;
  const all = readAllRecordsHydrated();
  all[record.assetId] = { ...record, updatedAt: Date.now() };
  const entries = Object.values(all);
  if (entries.length > MAX_RECORDS) {
    for (const stale of entries.sort((a, b) => a.updatedAt - b.updatedAt).slice(0, entries.length - MAX_RECORDS)) {
      delete all[stale.assetId];
    }
  }
  writeAllRecords(storage, all);
}

/** 清该资产任务记录(自然完成=无续跑价值)。 */
export function clearSheetCardBLineRecord(assetId: string): void {
  const storage = getRecordStorage();
  if (!storage) return;
  const all = readAllRecordsHydrated();
  delete all[assetId];
  writeAllRecords(storage, all);
}

// ─── 轮询节律(测试可注入提速) ───────────────────────────────────────────

const DEFAULT_TIMINGS = {
  pollIntervalMs: 2_000,
  /** 轮询总窗 40min(整卡 14 路×40 步编辑预计 5-15min,留裕量;超窗≠任务死——账在盘上可续跑)。 */
  maxPollDurationMs: 40 * 60 * 1_000,
  /** 连续轮询失败熔断(瞬时网络抖动不误杀;超限=partial-failed 可续跑)。 */
  maxConsecutivePollFailures: 10,
};

let timings = { ...DEFAULT_TIMINGS };

export function setSheetCardBLineTimingsForTests(
  override: Partial<typeof DEFAULT_TIMINGS> | null,
): void {
  timings = { ...DEFAULT_TIMINGS, ...(override ?? {}) };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

// ─── sidecar HTTP 腿(契约=image_gen/server.py「设定卡 B线 i2i」节) ────────

/** server 任务态文档(task_status 返回面;提交响应同面)。 */
interface SheetCardTaskDoc {
  taskId?: string;
  task_id?: string;
  status?: string;
  progress?: { done?: number; total?: number; percent?: number };
  currentStep?: string | null;
  resumable?: boolean;
  resultReady?: boolean;
  error?: string;
}

interface SheetCardResultDoc {
  data?: Array<{ b64_json?: string; b64?: string; url?: string }>;
  b64_json?: string;
  error?: { message?: string };
}

async function fetchSheetCardJson(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<Record<string, unknown>> {
  const response = await fetch(`${LOCAL_IMAGE_BASE_URL}${path}`, {
    method: init.method,
    headers: {
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      Authorization: `Bearer ${await getLocalImageToken()}`,
      ...(init.method === "GET" ? { "Cache-Control": "no-cache" } : {}),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const message = (json as { error?: { message?: string } } | null)?.error?.message;
    throw new Error(message || `设定卡B线请求失败(HTTP ${response.status})`);
  }
  return json ?? {};
}

/** 轮询地址带 _ts 防缓存(image-task-poller 同款纪律)。 */
async function getSheetCardTaskDoc(taskId: string): Promise<SheetCardTaskDoc> {
  const url = new URL(`${LOCAL_IMAGE_BASE_URL}${taskPath(taskId)}`);
  url.searchParams.set("_ts", Date.now().toString());
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${await getLocalImageToken()}`,
      "Cache-Control": "no-cache",
    },
  });
  const json = (await response.json().catch(() => null)) as SheetCardTaskDoc | null;
  if (!response.ok) {
    const message = (json as { error?: { message?: string } } | null)?.error?.message;
    throw new Error(message || `设定卡B线任务查询失败(HTTP ${response.status})`);
  }
  return json ?? {};
}

/** done 态终卡取件(GET /result;仅 done,未完 409 禁半卡)。 */
async function fetchSheetCardResult(taskId: string): Promise<string | null> {
  const doc = (await fetchSheetCardJson(resultPath(taskId), { method: "GET" })) as SheetCardResultDoc;
  const candidates = [doc.data?.[0]?.b64_json, doc.data?.[0]?.b64, doc.data?.[0]?.url, doc.b64_json];
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    if (candidate.startsWith("data:")) return candidate;
    if (/^https?:\/\//i.test(candidate)) return candidate;
    return `data:image/png;base64,${candidate}`;
  }
  return null;
}

/** 终卡门禁采样面:宽高+透明占比+灰度方差(PRD 转移表 composing→saving 守卫)。 */
export interface SheetCardGateSample {
  width: number;
  height: number;
  /** 透明像素占比(0-1;alpha<250 记透明)。 */
  transparentRatio: number;
  /** 采样灰度方差(近乎空白≈0)。 */
  grayVariance: number;
}

/** 终卡 alpha/尺寸门禁判定(纯函数):返回拒绝理由;null=过。
 * 阈值锚实弹基线:3840×2160 不透明卡灰度方差 6648(1122 实弹)。 */
export function evaluateSheetCardGate(sample: SheetCardGateSample): string | null {
  if (sample.width < 3400 || sample.height < 1900) {
    return `终卡尺寸异常 ${sample.width}×${sample.height}(期望 4K 档 3840×2160)`;
  }
  if (sample.transparentRatio > 0.01) {
    return `终卡透明占比 ${(sample.transparentRatio * 100).toFixed(2)}%>1%(设定卡应为不透明卡面)`;
  }
  if (sample.grayVariance < 30) {
    return `终卡画面近乎空白(灰度方差 ${sample.grayVariance.toFixed(1)})`;
  }
  return null;
}

let gateSamplerForTests: ((source: string) => Promise<SheetCardGateSample>) | null = null;

/** 测试注入口(同 setSheetCardBLineTimingsForTests 范式);null=恢复默认 canvas 采样。 */
export function setSheetCardBLineGateSamplerForTests(
  sampler: ((source: string) => Promise<SheetCardGateSample>) | null,
): void {
  gateSamplerForTests = sampler;
}

/** 浏览器 canvas 采样(96×54 网格);采样失败=fail-closed 拒(禁半卡)。 */
async function sampleSheetCardImage(source: string): Promise<SheetCardGateSample> {
  const sampler = gateSamplerForTests;
  if (sampler) return sampler(source);
  if (typeof document === "undefined") {
    throw new Error("终卡门禁采样环境无 document(非渲染层禁收编)");
  }
  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("终卡解码失败"));
    img.src = source;
  });
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 54;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("终卡门禁画布不可用");
  ctx.drawImage(img, 0, 0, 96, 54);
  const data = ctx.getImageData(0, 0, 96, 54).data;
  const n = 96 * 54;
  let transparent = 0;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i += 1) {
    if (data[i * 4 + 3] < 250) transparent += 1;
    const gray = (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3;
    sum += gray;
    sumSq += gray * gray;
  }
  return {
    width: img.naturalWidth,
    height: img.naturalHeight,
    transparentRatio: transparent / n,
    grayVariance: sumSq / n - (sum / n) ** 2,
  };
}
async function toMasterDataUrl(source: string): Promise<string | null> {
  if (source.startsWith("data:")) return source;
  const bridge = (globalThis as {
    studioAssets?: { readUrlDataUrl?: (url: string) => Promise<string | null> };
  }).studioAssets;
  if (bridge?.readUrlDataUrl) {
    try {
      const viaBridge = await bridge.readUrlDataUrl(source);
      if (viaBridge) return viaBridge;
    } catch {
      /* 桥失败回落 readImageAsBase64 */
    }
  }
  return readImageAsBase64(source);
}

// ─── 主体执行件 ───────────────────────────────────────────────────────────

export interface SheetCardBLineRunInput {
  assetId: string;
  assetName: string;
  /** 竖线字段式主体句(降级链已在派发层解析:设定卡槽优先,空=assets.prompt 立绘主体句透传)。 */
  subjectText: string;
  /** master 参考图(人物多视图节正视图 url;1122 修正裁定:带装参考)。 */
  masterImageUrl: string;
  /**
   * 格式档(1122 格式入参化,裁定A 四档各一槽):全卡/简版/竖版/无装备;缺省=全卡
   * (真源首键缺省档契约)。透传 extra.sheet_format,并随派发层命名进格式段
   * (`_设定卡_{格式}_中文日期`)与槽内替换过滤轴。
   */
  sheetFormat?: SheetCardFormat;
  projectId?: string;
  chapterId?: string;
  isDerivative?: boolean;
  /** 诊断贯通 id(调用方造;缺省自造兜底)。 */
  operationId?: string;
  /** 取消口(firing/composing 取消→cancelled,已落盘子步保留)。 */
  signal?: AbortSignal;
  /** 落盘目标(调用方 TRACK_SAVE_TARGETS 单源:设定卡恒 role→character/characters)。 */
  assetType: AssetType;
  category: ImageCategory;
}

function describeSheetCardProgress(doc: SheetCardTaskDoc, record: SheetCardBLineTaskRecord): string {
  if (record.status === "composing") {
    return `设定卡B线 ${record.totalSteps}/${record.totalSteps} 子步完成,正在合成 4K 整卡...`;
  }
  const tag = typeof doc.currentStep === "string" && doc.currentStep ? `(${doc.currentStep})` : "";
  return `设定卡B线子步 ${record.step}/${record.totalSteps}${tag}...`;
}

/**
 * 设定卡 B 线整链执行(提交→轮询→取件→收编):进度走按型出图既有 progress 线
 * (firing/composing→generating+saving 相位,子步账进 message);产物落盘走
 * saveGeneratedAssetImage + updateStoreWithResult(与通用路同款);库内格式槽清旧
 * 由派发层在收编验收后执行(替换守卫 replaceSheetCardKindImageAfterAcceptance,
 * 1122 C 接线——本层零清旧职责)。
 */
export async function runSheetCardBLine(
  input: SheetCardBLineRunInput,
  onProgress?: (progress: AssetTypeShotProgress) => void,
): Promise<AssetTypeShotProgress> {
  const operationId = input.operationId ?? createOperationId("asset-sheet-card-bline");
  // 格式档缺省全卡(真源首键契约);野值 fail-closed 落缺省(UI 边界已四选一约束)
  const sheetFormat: SheetCardFormat = isSheetCardFormat(input.sheetFormat)
    ? input.sheetFormat
    : SHEET_CARD_FORMAT_DEFAULT;
  // 守卫(belt-and-braces:派发层已拦,service 层再拒一次——禁发车口径单一)
  if (!input.masterImageUrl) {
    return { phase: "failed", error: "设定卡B线缺少正视图 master 图——请先生成或补充人物多视图(正视图)" };
  }
  if (!input.subjectText.trim()) {
    return { phase: "failed", error: "设定卡B线缺少主体句(设定卡槽或资产提示词)" };
  }
  try {
    const masterDataUrl = await toMasterDataUrl(input.masterImageUrl);
    if (!masterDataUrl) {
      return {
        phase: "failed",
        error: `设定卡B线 master 图无法读取(${input.masterImageUrl.slice(0, 40)}…)`,
      };
    }
    // sidecar 自愈(普通生成链同款):缺席/僵尸时先拉起,裸 fetch 会连接拒绝
    const { ensureLocalImageSidecarRunning } = await import("@/lib/ai/image-generation-engine");
    if (!(await ensureLocalImageSidecarRunning())) {
      return { phase: "failed", error: "本地生图运行时未就绪,请在 设置→本地配置 点「准备运行时」后重试" };
    }
    // 续跑重入口:该资产存在持久任务记录(水合已归一:非终态/partial-failed/cancelled/
    // failed 皆可续跑)→ 同 taskId 重发,sidecar 按盘上子步账跳步(参考图以盘上首存为准)
    const priorRecord = readSheetCardBLineRecord(input.assetId);
    const resumeTaskId = priorRecord?.taskId;
    onProgress?.({
      phase: "generating",
      message: `正在提交 ${input.assetName} 的设定卡B线任务${resumeTaskId ? "(续跑)" : ""}...`,
    });
    void logEvent({
      level: "info",
      category: "ai",
      operationId,
      message: "Sheet card B-line task submitting",
      context: {
        layout: SHEET_CARD_BLINE_LAYOUT,
        assetId: input.assetId,
        assetName: input.assetName,
        ...(resumeTaskId ? { resumeTaskId } : {}),
        sheetFormat,
        subjectChars: input.subjectText.length,
        subjectFull: input.subjectText,
      },
    });
    const submitDoc = (await fetchSheetCardJson(SUBMIT_PATH, {
      method: "POST",
      body: {
        model: SHEET_CARD_BLINE_MODEL,
        prompt: input.subjectText,
        reference_image: masterDataUrl,
        extra: {
          角名: input.assetName,
          sheet_format: sheetFormat,
          sheet_bg: SHEET_CARD_BG,
        },
        ...(resumeTaskId ? { taskId: resumeTaskId } : {}),
      },
    })) as SheetCardTaskDoc;
    const taskId = submitDoc.taskId ?? submitDoc.task_id;
    if (!taskId) {
      return { phase: "failed", error: "设定卡B线任务提交未返回任务号" };
    }
    void logEvent({
      level: "info",
      category: "ai",
      operationId,
      message: "Sheet card B-line task submitted",
      context: { layout: SHEET_CARD_BLINE_LAYOUT, assetId: input.assetId, taskId, ...(resumeTaskId ? { resumedFrom: resumeTaskId } : {}) },
    });

    // 轮询主体(转移表:firing 子步账→composing→done 取件;partial-failed/cancelled/失败落点)
    const submittedAt = Date.now();
    let consecutivePollFailures = 0;
    let record: SheetCardBLineTaskRecord = {
      assetId: input.assetId,
      taskId,
      status: "firing",
      step: 0,
      totalSteps: SHEET_CARD_TOTAL_STEPS,
      updatedAt: Date.now(),
    };
    writeSheetCardBLineRecord(record);
    for (;;) {
      if (input.signal?.aborted) {
        return await settleCancelled(record, operationId);
      }
      let doc: SheetCardTaskDoc;
      try {
        doc = await getSheetCardTaskDoc(taskId);
        consecutivePollFailures = 0;
      } catch (err: unknown) {
        consecutivePollFailures += 1;
        if (consecutivePollFailures >= timings.maxConsecutivePollFailures) {
          return settlePartialFailed(
            record,
            `设定卡B线任务轮询连续失败 ${consecutivePollFailures} 次:${err instanceof Error ? err.message : String(err)}`,
            operationId,
          );
        }
        await sleep(timings.pollIntervalMs, input.signal);
        continue;
      }
      const rawStatus = String(doc.status ?? "");
      const normalized = STATUS_ALIASES[rawStatus.toLowerCase()];
      if (!normalized) {
        return settlePartialFailed(
          record,
          `sidecar 返回未知设定卡B线任务态「${rawStatus}」(契约面漂移,fail-closed)`,
          operationId,
        );
      }
      // done 优先于超窗(1122 复审 low 根修):窗口刚过后的首次轮询若已 done,
      // 先取件收编,防把已完成任务误报为可续跑失败(超窗仅拦仍在跑的任务)
      if (normalized !== "done" && Date.now() - submittedAt > timings.maxPollDurationMs) {
        return settlePartialFailed(
          record,
          `设定卡B线任务轮询超窗(${Math.round(timings.maxPollDurationMs / 60_000)}min)——任务在 sidecar 侧续存,可续跑`,
          operationId,
        );
      }
      const done = typeof doc.progress?.done === "number" && doc.progress.done >= 0 ? doc.progress.done : record.step;
      const total = typeof doc.progress?.total === "number" && doc.progress.total > 0 ? doc.progress.total : record.totalSteps;
      if (normalized === "firing" || normalized === "composing") {
        // composing 派生(转移表 firing 全子步完→composing):server running 相位下
        // currentStep=compose 或 14 子步全落盘=程序合成中(秒级)
        const composing = normalized === "composing"
          || doc.currentStep === COMPOSE_STEP_TAG
          || (total > 0 && done >= total);
        record = {
          ...record,
          status: composing ? "composing" : "firing",
          step: done,
          totalSteps: total,
        };
        writeSheetCardBLineRecord(record);
        onProgress?.({
          phase: "generating",
          message: describeSheetCardProgress(doc, record),
        });
      } else if (normalized === "done") {
        const image = await fetchSheetCardResult(taskId);
        if (!image) {
          return settlePartialFailed(record, "设定卡B线任务已完成但终卡取件无产物(禁半卡)", operationId);
        }
        // 转移表 composing→saving 守卫:alpha/尺寸门禁(1122 复审 medium 根修)
        let gateRejection: string | null;
        try {
          gateRejection = evaluateSheetCardGate(await sampleSheetCardImage(image));
        } catch (err) {
          gateRejection = err instanceof Error ? err.message : String(err);
        }
        if (gateRejection) {
          return settlePartialFailed(
            record,
            `设定卡B线终卡未过门禁:${gateRejection}(禁半卡,可续跑重合成)`,
            operationId,
          );
        }
        record = { ...record, status: "saving", step: total, totalSteps: total };
        writeSheetCardBLineRecord(record);
        onProgress?.({ phase: "saving", message: `正在保存 ${input.assetName} 的设定卡(4K)...` });
        const localPath = await saveGeneratedAssetImage({
          source: image,
          assetType: input.assetType,
          assetId: input.assetId,
          assetName: input.assetName,
          projectId: input.projectId,
          isDerivative: input.isDerivative ?? false,
          chapterId: input.chapterId,
          category: input.category,
        });
        updateStoreWithResult(input.assetId, input.assetType, { imageLocalPath: localPath });
        clearSheetCardBLineRecord(input.assetId);
        void logEvent({
          level: "info",
          category: "asset",
          operationId,
          message: "Sheet card B-line image saved",
          context: {
            assetId: input.assetId,
            assetName: input.assetName,
            taskId,
            imageLocalPath: localPath,
          },
        });
        return { phase: "done", imageLocalPath: localPath, taskId };
      } else if (normalized === "partial-failed") {
        return settlePartialFailed(
          record,
          doc.error || "设定卡B线子步失败(已落盘子步保留,可续跑)",
          operationId,
        );
      } else {
        // cancelled
        return await settleCancelled(record, operationId, doc.error);
      }
      await sleep(timings.pollIntervalMs, input.signal);
    }
  } catch (err: unknown) {
    void logEvent({
      level: "error",
      category: "asset",
      operationId,
      message: "Sheet card B-line failed",
      context: { assetId: input.assetId, assetName: input.assetName },
      error: err,
    });
    return {
      phase: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** partial-failed 落点(转移表:任一子步/合成失败=任务级失败可续跑,禁半卡收编)。 */
function settlePartialFailed(
  record: SheetCardBLineTaskRecord,
  reason: string,
  operationId: string,
): AssetTypeShotProgress {
  writeSheetCardBLineRecord({ ...record, status: "partial-failed" });
  void logEvent({
    level: "error",
    category: "asset",
    operationId,
    message: "Sheet card B-line partial-failed (resumable)",
    context: { assetId: record.assetId, taskId: record.taskId, step: record.step, totalSteps: record.totalSteps, reason },
  });
  return { phase: "failed", error: `${reason}(重发设定卡生成即从已落盘子步续跑)`, resumable: true, taskId: record.taskId };
}

/** cancelled 落点(转移表:取消=引擎单发纪律,已落盘子步保留,续跑口保留)。 */
async function settleCancelled(
  record: SheetCardBLineTaskRecord,
  operationId: string,
  serverReason?: string,
): Promise<AssetTypeShotProgress> {
  // 服务端真取消(network.ts 停止根修同款语义):fire-and-forget,失败不阻断落态
  try {
    await fetchSheetCardJson(cancelPath(record.taskId), { method: "POST", body: {} });
  } catch {
    /* 取消通知尽力而为(服务端已自取消/不可达均照落 cancelled) */
  }
  writeSheetCardBLineRecord({ ...record, status: "cancelled" });
  void logEvent({
    level: "warn",
    category: "asset",
    operationId,
    message: "Sheet card B-line cancelled (landed sub-steps kept)",
    context: { assetId: record.assetId, taskId: record.taskId, step: record.step, ...(serverReason ? { serverReason } : {}) },
  });
  return {
    phase: "cancelled",
    error: serverReason || "已取消——已落盘子步保留,重发设定卡生成即续跑",
    taskId: record.taskId,
  };
}

// ─── R3 替换守卫(1122 C 接线:executeTypeShot 设定卡路生产调用)────────────

/**
 * 设定卡格式槽替换守卫(R3,转移表 saving 行;1122 多张化解禁接线转正):新卡
 * 合成+验收后才清旧——先收编(写资产库主图),收编成功才逐条清**该格式槽内**
 * 旧图(槽过滤轴在调用方:sheetCardSlotReplacementFilePaths,同档清/异档零干预);
 * 收编失败=全槽旧图原位不动(未过验收禁删)。单条旧图删除失败不阻断(新卡已入库,
 * 残留旧图下轮再生成时再清——通用路同款纪律)。与通用路(先清旧再收编)次序相反:
 * 4K 整卡造价高,失败时旧卡必须原位保留。
 * stalePaths 两形态:数组=派发前算定的静态清单;函数=收编验收**后**惰性求值
 * (PRD R3「按刷新库重算」——replace-image 收编会把旧主图归档进 images[] 且归档
 * 名可带 `_2`,按收编后的刷新库名轴重算防漂移;求值仅发生在验收通过分支,
 * 收编失败零求值零删除)。
 */
export async function replaceSheetCardKindImageAfterAcceptance(input: {
  stalePaths: readonly string[] | (() => Promise<readonly string[]> | readonly string[]);
  saveToLibrary: () => Promise<boolean>;
  removeStale: (imageFilePath: string) => Promise<unknown>;
}): Promise<boolean> {
  const savedToLibrary = await input.saveToLibrary();
  if (!savedToLibrary) {
    // 替换守卫:未过验收(收编失败)禁删旧图
    return false;
  }
  const stalePaths = typeof input.stalePaths === "function" ? await input.stalePaths() : input.stalePaths;
  for (const stalePath of stalePaths) {
    try {
      await input.removeStale(stalePath);
    } catch {
      /* 单条删除失败不阻断:新卡已入库,残留旧图下轮再生成时再清 */
    }
  }
  return true;
}
