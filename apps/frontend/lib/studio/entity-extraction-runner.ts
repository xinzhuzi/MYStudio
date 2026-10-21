/**
 * 全书实体提取执行器 + 单章共用管线(C1 集成 Step 7/9;design §1/§4/§5/§6)。
 *
 * 两层结构:
 * - extractChapterEntities:单章共用管线(输入解析 D22 → 消息 → 模型 → 解析 →
 *   dedupe),单章 handleEntityExtraction 与全书 runner 同一函数——输入口径
 *   (scriptDraft > drama,不回落小说原文)与指纹公式在此单一真源。
 * - runEntityExtraction:逐章调度(有界并发 1–2,D5)、台账续跑(R2)、1308
 *   全局挂起到点续跑(D5/AC7)、transient 退避 2 次、fatal 记失败继续(R1)、
 *   单例防重入(主/旁路互斥)、模型漂移守卫(D26/AC17)、对比模式旁路
 *   (D20/AC14)。
 *
 * 写路径铁律(D17):章分片唯一正路=store action saveEntityExtraction(注入);
 * 严禁本模块自写 studio-workflow 分片文件(不在 manifest 会被孤儿清理删)。
 * 出场索引/台账家=store/extraction/(D18,studio-workflow 之外)。
 *
 * importance 披露(D23):出场索引 schema 支持 importance,但其真源=提取批
 * characters[].importance(types:737)——五列表输出格式没有重要度列,当前
 * 生产链无生产者,protagonist 晋升路径 dormant(≥2 章/已在三库两条路径先行);
 * 待模型契约扩展后自然点亮,本模块记录面已就绪。
 */

import { aiManager } from "@/lib/ai/ai-manager";
import { logEvent } from "@/lib/diagnostics/logger";
import {
  buildEntityExtractionMessages,
  dedupeEntities,
  parseAliasesFromNotes,
  parseEntityExtraction,
  type DedupedEntity,
  type EntityKind,
  type KnownEntity,
} from "@/lib/studio/entity-extraction";
import {
  diffScriptEntityHints,
  extractScriptEntityHints,
  type ScriptEntityHintDiff,
  type ScriptEntityHints,
} from "@/lib/studio/script-entity-hints";
import {
  classifyExtractionError,
  QUOTA_WINDOW_DEFAULT_RESUME_DELAY_MS,
  transientBackoffDelayMs,
} from "@/lib/studio/entity-extraction-errors";
import {
  chapterIdFromNumber,
  resolveExtractionChapterInput,
  type ReadDramaFile,
} from "@/lib/studio/entity-extraction-input";
import {
  APPEARANCE_INDEX_RELATIVE_PATH,
  appearanceKey,
  buildKnownEntityList,
  chapterNumberFromId,
  createAppearanceLookup,
  findAppearanceEntryKey,
  isPromotedForLibrary,
  mergeChapterAppearances,
  parseAppearanceIndex,
  serializeAppearanceIndex,
  type EntityAppearanceIndex,
} from "@/lib/studio/entity-appearances";
import {
  EXTRACTION_LEDGER_RELATIVE_PATH,
  createElectronLedgerStorage,
  createExtractionLedger,
  parseLedgerJson,
  recordChapter,
  serializeLedger,
  shouldSkipChapter,
  type ExtractionRunLedger,
  type LedgerChapterEntry,
  type LedgerStorage,
} from "@/lib/studio/entity-extraction-ledger";
import { getProjectFilesBridge } from "@/lib/bridge/project-files";
import {
  createMystudioSinks,
  syncExtractedEntities,
  type SyncSinks,
} from "@/lib/studio/entity-sync";
import {
  latestAgentWorkEntry,
  scriptPlanSourceFingerprint,
} from "@/components/panels/studio/workflow-helpers";
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import { usePropsLibraryStore } from "@/stores/library/props-library-store";
import { useSceneStore } from "@/stores/library/scene-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { EntityExtractionResult } from "@/types/studio";

// ── 1013 修 RC-9:模型原始输出分段落盘 helper(自 useNovelPipelineActions 迁入,
// 管线化后单章与 runner 共用同一段落盘逻辑) ────────────────────────────────
const DIAGNOSTIC_CHUNK_CHAR_LIMIT = 1000;
const DIAGNOSTIC_CHUNK_MAX = 20;

function chunkTextForDiagnostics(text: string): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    if (chunks.length >= DIAGNOSTIC_CHUNK_MAX) return chunks;
    if (line.length >= DIAGNOSTIC_CHUNK_CHAR_LIMIT) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      chunks.push(line);
      continue;
    }
    const withLine = current ? `${current}\n${line}` : line;
    if (withLine.length > DIAGNOSTIC_CHUNK_CHAR_LIMIT) {
      chunks.push(current);
      current = line;
    } else {
      current = withLine;
    }
  }
  if (current && chunks.length < DIAGNOSTIC_CHUNK_MAX) chunks.push(current);
  return chunks;
}

// ── 单章共用管线 ───────────────────────────────────────────────────────────

/** 提取调用超时(design §4:复用 SCRIPT_STAGE_STREAM_TIMEOUT_MS 量级)。 */
export const ENTITY_EXTRACTION_TIMEOUT_MS = 600_000;

/** 模型调用通道(注入;生产=createDefaultEntityModelCall 包装 aiManager.text)。 */
export type EntityModelCallResult = {
  success: boolean;
  text?: string;
  error?: unknown;
  usage?: { inputTokens?: number; outputTokens?: number };
};

export type EntityModelCall = (input: {
  messages: { role: "system" | "user"; content: string }[];
  model?: string;
  timeoutMs?: number;
}) => Promise<EntityModelCallResult>;

/** 生产模型通道:binding=entityExtraction(含 universalAi 回退链),温度 0.2、
 * 结构化任务关思考(1013 口径原样迁入);D20 model 覆写只换 model 名。 */
export function createDefaultEntityModelCall(): EntityModelCall {
  return async ({ messages, model, timeoutMs }) => {
    const result = await aiManager.text({
      binding: { agent: "entityExtraction" },
      messages,
      temperature: 0.2,
      disableThinking: true,
      ...(model ? { model } : {}),
      ...(timeoutMs ? { timeoutMs } : {}),
    });
    return {
      success: result.success,
      text: result.text,
      error: result.error,
      ...(result.usage
        ? {
            usage: {
              inputTokens: result.usage.inputTokens,
              outputTokens: result.usage.outputTokens,
            },
          }
        : {}),
    };
  };
}

export interface ExtractChapterEntitiesInput {
  episodeId: string;
  /** 预解析正文(runner 先行指纹/续跑判定后传入);缺省走 D22 就地解析。 */
  scriptText?: string;
  inputSource?: "scriptDraft" | "drama";
  /** D22 就地解析:该章最新剧本草稿(agentWorkData)。 */
  scriptDraft?: string | null;
  /** D22 就地解析:drama 读取通道(生产=electronAPI.projectFiles.readText)。 */
  readDramaFile?: ReadDramaFile;
  /** 已知实体清单(prompt 引导;D4 控长由调用方负责)。 */
  knownEntities?: KnownEntity[];
  /** dedupe 专用已知集(缺省=knownEntities;runner 传三库真 id+全量索引)。 */
  dedupeKnownEntities?: KnownEntity[];
  bibleContext?: string;
  modelCall: EntityModelCall;
  /** D20:显式模型覆写。 */
  model?: string;
  timeoutMs?: number;
}

export type ExtractChapterEntitiesResult =
  | { status: "no_input" }
  | { status: "input_truncated" }
  /** error=原始错误(unknown):单章 throw 位深串化(R6/R4),runner 分类器消费。 */
  | { status: "call_failed"; error: unknown }
  | { status: "empty_parse" }
  | {
      status: "success";
      scriptText: string;
      inputSource: "scriptDraft" | "drama";
      /** 1011 提取盖戳(公式=scriptPlanSourceFingerprint,零新造)。 */
      scriptFingerprint: string;
      entities: DedupedEntity[];
      parseErrors: string[];
      scriptHints: ScriptEntityHints;
      hintDiff: ScriptEntityHintDiff;
      usage?: { inputTokens?: number; outputTokens?: number };
    };

/** 单章共用管线:输入解析(D22)→ 消息 → 模型 → 解析 → dedupe。 */
export async function extractChapterEntities(
  input: ExtractChapterEntitiesInput,
): Promise<ExtractChapterEntitiesResult> {
  let scriptText = input.scriptText;
  let inputSource = input.inputSource;
  if (scriptText === undefined) {
    const resolved = await resolveExtractionChapterInput({
      chapterNumber: chapterNumberFromId(input.episodeId),
      scriptDraft: input.scriptDraft,
      readDramaFile:
        input.readDramaFile ?? (async () => ({ success: false, error: "no drama channel" })),
    });
    if (resolved.status !== "ok") return { status: resolved.status };
    scriptText = resolved.text;
    inputSource = resolved.source;
  }

  const scriptHints = extractScriptEntityHints(scriptText);
  const knownEntities = input.knownEntities ?? [];
  const messages = buildEntityExtractionMessages({
    episodeId: input.episodeId,
    scriptText,
    knownEntities,
    ...(input.bibleContext ? { bibleContext: input.bibleContext } : {}),
    scriptHints,
  });
  const timeoutMs = input.timeoutMs ?? ENTITY_EXTRACTION_TIMEOUT_MS;
  const result = await input.modelCall({
    messages: [
      { role: "system", content: messages.system },
      { role: "user", content: messages.user },
    ],
    ...(input.model ? { model: input.model } : {}),
    timeoutMs,
  });
  if (!result.success || !result.text) {
    return { status: "call_failed", error: result.error };
  }

  const parsed = parseEntityExtraction(result.text, input.episodeId);
  // 1013 修 RC-9:模型原始输出+解析错误持久化 diagnostics(自单章路径迁入,共用)
  void logEvent({
    level: parsed.errors.length ? "warn" : "info",
    category: "workflow",
    message: "entityExtraction.modelOutput",
    context: {
      episodeId: input.episodeId,
      rawOutputLength: result.text.length,
      rawOutputChunks: chunkTextForDiagnostics(result.text),
      parseErrors: parsed.errors,
      extractedCounts: {
        character: parsed.entities.filter((entity) => entity.kind === "character").length,
        scene: parsed.entities.filter((entity) => entity.kind === "scene").length,
        prop: parsed.entities.filter((entity) => entity.kind === "prop").length,
      },
    },
  });
  const { entities } = dedupeEntities(
    parsed.entities,
    input.dedupeKnownEntities ?? knownEntities,
  );
  if (!entities.length) {
    return { status: "empty_parse" };
  }
  return {
    status: "success",
    scriptText,
    inputSource: inputSource ?? "drama",
    scriptFingerprint: scriptPlanSourceFingerprint(input.episodeId, scriptText),
    entities,
    parseErrors: parsed.errors,
    scriptHints,
    hintDiff: diffScriptEntityHints(scriptHints, parsed.entities),
    ...(result.usage
      ? {
          usage: {
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
          },
        }
      : {}),
  };
}

/**
 * 台账输入指纹(R2 续跑跳过比对):正文+来源的确定性 16-hex(双道 FNV-1a)。
 * design §2 草拟「sha 截 16」——此处取同步确定性哈希:跳过比对只需低碰撞,
 * 非加密威胁模型;同步实现让 jsdom/单测零依赖(crypto.subtle 异步且环境不定)。
 */
export function computeInputFingerprint(text: string): string {
  const fnv1a = (seed: number): string => {
    let hash = seed;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  };
  return `${fnv1a(0x811c9dc5)}${fnv1a(0x9747b28c)}`;
}

// ── 执行器 ─────────────────────────────────────────────────────────────────

/** 三库条目(runner 晋升判定与 dedupe 的 id 真源)。 */
export interface RunnerLibraryEntity {
  id: string;
  kind: EntityKind;
  name: string;
  aliases: string[];
}

export interface EntityExtractionRunnerDeps {
  projectId: string;
  projectName: string;
  /** 台账/索引/旁路结果的读写通道(生产=createElectronLedgerStorage)。 */
  storage: LedgerStorage;
  readDramaFile: ReadDramaFile;
  modelCall: EntityModelCall;
  /** 该章最新剧本草稿(内存→磁盘兜底;D1 优先级)。 */
  getScriptDraft(chapterId: string): Promise<string | null>;
  /** D17:章分片唯一写路(store action)。 */
  saveEntityExtraction(result: EntityExtractionResult): void;
  createSinks(): SyncSinks;
  getLibraryEntities(): RunnerLibraryEntity[];
  /** 实际生效模型(entityExtraction→universalAi 解析链;D20 覆写时=覆写名)。 */
  getResolvedModel(): string | null;
  getChapterIdentity(chapterId: string): { sourceId?: string; revision?: number } | null;
  sleep?(ms: number): Promise<void>;
  now?(): number;
}

export interface RunEntityExtractionOptions {
  range: [number, number];
  /** 有界并发 1–2(D5);缺省 1(串行,索引/晋升语义最稳)。 */
  concurrency?: 1 | 2;
  /** D20:显式模型覆写(对比模式 glm-5.3-flash)。 */
  model?: string;
  /** D20:旁路 sink——不落章分片/三库/主台账/主索引,写 store/extraction/bypass/<runId>/。 */
  sink?: "main" | "bypass";
  runId?: string;
  /** 弃既有台账新起 run(D14 强制重提)。 */
  forceNew?: boolean;
  /** 续跑时把 failed 章重置为 pending(D14 仅重跑失败)。 */
  retryFailed?: boolean;
}

export interface EntityExtractionRunSummary {
  runId: string;
  status: "running" | "paused" | "quota_wait" | "done";
  /** D26 漂移信息(挂起原因;null=无漂移)。 */
  drift: { chapterId: string; model: string } | null;
  counts: { success: number; failed: number; skipped: number; pending: number };
  ledgerPath: string;
}

/** 模块级单例:主跑与旁路互斥,重复 start 拒绝。 */
let activeRun: { paused: boolean } | null = null;

export function isEntityExtractionInFlight(): boolean {
  return activeRun !== null;
}

/** 暂停当前 run(当前章完成后停,台账置 paused;D14)。 */
export function pauseEntityExtraction(): boolean {
  if (!activeRun) return false;
  activeRun.paused = true;
  return true;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function writeTextAtomically(
  storage: LedgerStorage,
  relativePath: string,
  value: string,
): Promise<void> {
  const tmp = `${relativePath}.tmp`;
  await storage.writeText(tmp, value);
  await storage.move(tmp, relativePath);
}

/** bypass 旁路目录(D20):store/extraction/bypass/<runId>/。 */
function bypassDirOf(runId: string): string {
  return `store/extraction/bypass/${runId}`;
}

export async function runEntityExtraction(
  deps: EntityExtractionRunnerDeps,
  options: RunEntityExtractionOptions,
): Promise<EntityExtractionRunSummary> {
  if (activeRun) {
    throw new Error("全书提取已在运行中(单例防重入;主跑与旁路互斥)");
  }
  const run = { paused: false };
  activeRun = run;
  try {
    return await executeRun(deps, options, run);
  } finally {
    activeRun = null;
  }
}

/** 管线成功态(runner 内部消费的字段子集来源)。 */
type SuccessExtraction = Extract<ExtractChapterEntitiesResult, { status: "success" }>;

async function executeRun(
  deps: EntityExtractionRunnerDeps,
  options: RunEntityExtractionOptions,
  run: { paused: boolean },
): Promise<EntityExtractionRunSummary> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const bypass = (options.sink ?? "main") === "bypass";
  const concurrency = options.concurrency ?? 1;
  const resolvedRunModel = options.model ?? deps.getResolvedModel();
  if (!resolvedRunModel) {
    throw new Error("未配置可用模型(entityExtraction/universalAi 均未绑定),无法开始全书提取");
  }

  const runId = options.runId ?? `run-${now()}`;
  const ledgerPath = bypass
    ? `${bypassDirOf(runId)}/extraction-run.json`
    : EXTRACTION_LEDGER_RELATIVE_PATH;

  // 台账:续跑(同 range)or 新建
  let ledger: ExtractionRunLedger | null = null;
  if (!options.forceNew) {
    const raw = await deps.storage.readText(ledgerPath);
    ledger = raw === null ? null : parseLedgerJson(raw);
  }
  if (ledger && (ledger.range[0] !== options.range[0] || ledger.range[1] !== options.range[1])) {
    ledger = null; // 范围变化=新 run
  }
  if (ledger && ledger.model !== resolvedRunModel) {
    throw new Error(
      `台账模型 ${ledger.model} 与当前解析模型 ${resolvedRunModel} 不一致(D9 全书统一;确要换模型请 forceNew 重提)`,
    );
  }
  if (!ledger) {
    ledger = createExtractionLedger({ runId, model: resolvedRunModel, range: options.range });
  } else if (options.retryFailed) {
    for (const [chapterId, entry] of Object.entries(ledger.chapters)) {
      if (entry.state === "failed") {
        ledger = recordChapter(ledger, chapterId, { state: "pending", error: null });
      }
    }
  }

  // 出场索引(主跑专用):读盘续接
  let index: EntityAppearanceIndex = {};
  if (!bypass) {
    const rawIndex = await deps.storage.readText(APPEARANCE_INDEX_RELATIVE_PATH);
    if (rawIndex !== null) index = parseAppearanceIndex(rawIndex);
  }

  let drift: { chapterId: string; model: string } | null = null;
  let driftHit = false;

  // 串行化落盘链(并发 2 时防 tmp/move 同名竞态;快照在入链时捕获)
  let persistChain: Promise<void> = Promise.resolve();
  const persistLedger = () => {
    const snapshot = ledger!;
    persistChain = persistChain.then(() =>
      writeTextAtomically(deps.storage, ledgerPath, serializeLedger(snapshot)),
    );
  };
  const persistIndex = () => {
    const snapshot = index;
    persistChain = persistChain.then(() =>
      writeTextAtomically(
        deps.storage,
        APPEARANCE_INDEX_RELATIVE_PATH,
        serializeAppearanceIndex(snapshot),
      ),
    );
  };

  ledger = { ...ledger, status: "running", resumeAt: null };
  persistLedger();

  const processChapter = async (chapterNumber: number): Promise<void> => {
    const chapterId = chapterIdFromNumber(chapterNumber);

    // D26 漂移守卫:每章开跑前核 resolved model(覆写恒定,不会自漂)
    const resolvedModel = options.model ?? deps.getResolvedModel();
    if (resolvedModel && resolvedModel !== ledger!.model) {
      drift = { chapterId, model: resolvedModel };
      driftHit = true;
      ledger = recordChapter(ledger!, chapterId, {
        state: "pending",
        error: `model_drift:${ledger!.model}→${resolvedModel}`,
      });
      ledger = { ...ledger!, status: "paused" };
      persistLedger();
      return;
    }

    const startedAt = now();
    // D22 输入解析(与单章同一函数):scriptDraft > drama
    const draft = await deps.getScriptDraft(chapterId);
    const resolvedInput = await resolveExtractionChapterInput({
      chapterNumber,
      scriptDraft: draft,
      readDramaFile: deps.readDramaFile,
    });
    const at = () => new Date(now()).toISOString();
    if (resolvedInput.status === "no_input") {
      if (ledger!.chapters[chapterId]?.state !== "skipped") {
        ledger = recordChapter(ledger!, chapterId, { state: "skipped", error: "no_input", at: at() });
        persistLedger();
      }
      return;
    }
    if (resolvedInput.status === "input_truncated") {
      ledger = recordChapter(ledger!, chapterId, {
        state: "failed",
        error: "input_truncated",
        at: at(),
      });
      persistLedger();
      return;
    }

    // R2 续跑:success 且指纹未变 → 零调用
    const fingerprint = computeInputFingerprint(resolvedInput.text);
    if (shouldSkipChapter(ledger!, chapterId, fingerprint)) return;

    // 已知清单(D4/design §3):prompt=索引近 30 章∪protagonist(控长);
    // dedupe=三库真 id + 全量索引(id 空串→首晋升走 add 路径)
    const promptKnown: KnownEntity[] = buildKnownEntityList(index, {
      currentChapterNumber: chapterNumber,
    }).map((item) => ({ id: "", kind: item.kind, name: item.name, aliases: item.aliases }));
    const libraryEntities = deps.getLibraryEntities();
    const libraryKeys = new Set(
      libraryEntities.flatMap((entity) =>
        [entity.name, ...entity.aliases].map((value) => appearanceKey(entity.kind, value)),
      ),
    );
    const dedupeKnown: KnownEntity[] = [
      ...libraryEntities.map((entity) => ({
        id: entity.id,
        kind: entity.kind,
        name: entity.name,
        aliases: entity.aliases,
      })),
      ...Object.values(index)
        .filter((entry) => !libraryKeys.has(appearanceKey(entry.kind, entry.name)))
        .map((entry) => ({
          id: "",
          kind: entry.kind,
          name: entry.name,
          aliases: entry.aliases,
        })),
    ];

    let attempts = 0;
    let transientRetries = 0;
    let extraction: SuccessExtraction | null = null;
    let failReason: string | null = null;
    for (;;) {
      attempts += 1;
      const result = await extractChapterEntities({
        episodeId: chapterId,
        scriptText: resolvedInput.text,
        inputSource: resolvedInput.source,
        knownEntities: promptKnown,
        dedupeKnownEntities: dedupeKnown,
        modelCall: deps.modelCall,
        ...(options.model ? { model: options.model } : {}),
      });
      if (result.status === "call_failed") {
        const classified = classifyExtractionError(result.error, now());
        if (classified.kind === "quota_window") {
          // D5:1308 全局挂起,不计失败;到点自动续跑同章(类型面 resumeAt 可空,
          // 实现在 quota 分支恒有值,空值兜底默认复探窗口)
          const resumeAt = classified.resumeAt ?? now() + QUOTA_WINDOW_DEFAULT_RESUME_DELAY_MS;
          ledger = { ...ledger!, status: "quota_wait", resumeAt };
          persistLedger();
          await sleep(Math.max(0, resumeAt - now()));
          ledger = { ...ledger!, status: "running", resumeAt: null };
          persistLedger();
          continue;
        }
        if (classified.kind === "transient") {
          const delay = transientBackoffDelayMs(transientRetries + 1);
          if (delay !== null) {
            transientRetries += 1;
            await sleep(delay);
            continue;
          }
        }
        failReason = classified.message;
        break;
      }
      if (result.status === "empty_parse") {
        failReason = "未解析出任何实体(模型输出无可解析行)";
        break;
      }
      if (result.status !== "success") {
        // 预解析正文下 no_input/input_truncated 不可达(前置已判);兜底记失败防吞
        failReason = `unexpected:${result.status}`;
        break;
      }
      extraction = result;
      break;
    }

    const baseRecord: Partial<LedgerChapterEntry> = {
      fingerprint,
      attempts,
      at: at(),
      ...(resolvedModel ? { model: resolvedModel } : {}),
      ...(extraction?.usage
        ? {
            tokensIn: extraction.usage.inputTokens ?? 0,
            tokensOut: extraction.usage.outputTokens ?? 0,
          }
        : {}),
    };

    if (!extraction) {
      ledger = recordChapter(ledger!, chapterId, {
        ...baseRecord,
        state: "failed",
        error: failReason ?? "unknown",
        ms: now() - startedAt,
      });
      persistLedger();
      return;
    }

    if (bypass) {
      // D20 旁路:全实体标记未晋升 → sync 只产批(伪 id)零库写;结果落旁路目录
      const inertSinks: SyncSinks = {
        characterSink: {
          addCharacter: () => {
            throw new Error("bypass 不得写三库");
          },
          updateCharacter: () => {
            throw new Error("bypass 不得写三库");
          },
          getOrCreateProjectFolder: () => {
            throw new Error("bypass 不得写三库");
          },
        },
        sceneSink: {
          addScene: () => {
            throw new Error("bypass 不得写三库");
          },
          updateScene: () => {
            throw new Error("bypass 不得写三库");
          },
          getOrCreateProjectFolder: () => {
            throw new Error("bypass 不得写三库");
          },
        },
      };
      const marked = extraction.entities.map((entity) => ({ ...entity, promoted: false }));
      const { result: batch } = syncExtractedEntities(
        { episodeId: chapterId, entities: marked, projectId: deps.projectId, projectName: deps.projectName },
        inertSinks,
      );
      const batchRecord = {
        ...batch,
        scriptFingerprint: extraction.scriptFingerprint,
      };
      await persistChain;
      await deps.storage.writeText(
        `${bypassDirOf(ledger!.runId)}/chapters/${chapterId}.json`,
        JSON.stringify(batchRecord),
      );
      ledger = recordChapter(ledger!, chapterId, { ...baseRecord, state: "success", ms: now() - startedAt });
      persistLedger();
      return;
    }

    // 主跑:出场索引累积 → 晋升判定 → 三库 → 章分片(D17 唯一正路)
    index = mergeChapterAppearances(
      index,
      chapterId,
      extraction.entities.map((entity) => ({
        kind: entity.kind,
        name: entity.name,
        aliases: entity.aliases,
      })),
    );
    const appearanceLookup = createAppearanceLookup(index);
    const marked = extraction.entities.map((entity) => {
      const key = findAppearanceEntryKey(
        index,
        {
          kind: entity.kind,
          name: entity.name,
          aliases: entity.aliases,
        },
        appearanceLookup,
      );
      const entry = key ? index[key] : undefined;
      const promoted = entry ? isPromotedForLibrary(entry, { libraryKeys }) : false;
      return {
        ...entity,
        ...(entry ? { firstEpisodeId: entry.firstChapterId } : {}),
        ...(promoted ? {} : { promoted: false }),
      };
    });
    const sinks = deps.createSinks();
    const { result: batch } = syncExtractedEntities(
      { episodeId: chapterId, entities: marked, projectId: deps.projectId, projectName: deps.projectName },
      sinks,
    );
    const identity = deps.getChapterIdentity(chapterId);
    deps.saveEntityExtraction({
      ...batch,
      sourceId: identity?.sourceId ?? chapterId,
      revision: identity?.revision ?? 1,
      scriptFingerprint: extraction.scriptFingerprint,
    });
    persistIndex();
    ledger = recordChapter(ledger!, chapterId, { ...baseRecord, state: "success", ms: now() - startedAt });
    persistLedger();
  };

  const chapterNumbers: number[] = [];
  for (let n = options.range[0]; n <= options.range[1]; n += 1) chapterNumbers.push(n);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      if (run.paused || driftHit) return;
      const chapterNumber = chapterNumbers[cursor];
      cursor += 1;
      if (chapterNumber === undefined) return;
      await processChapter(chapterNumber);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  await persistChain;

  if (run.paused && !driftHit) {
    ledger = { ...ledger!, status: "paused" };
  } else if (!driftHit && ledger!.status !== "paused") {
    ledger = { ...ledger!, status: "done" };
  }
  await writeTextAtomically(deps.storage, ledgerPath, serializeLedger(ledger!));

  const counts = { success: 0, failed: 0, skipped: 0, pending: 0 };
  for (const entry of Object.values(ledger!.chapters)) {
    if (entry.state === "success") counts.success += 1;
    else if (entry.state === "failed") counts.failed += 1;
    else if (entry.state === "skipped") counts.skipped += 1;
    else counts.pending += 1;
  }
  return {
    runId: ledger!.runId,
    status: ledger!.status,
    drift,
    counts,
    ledgerPath,
  };
}

// ── 生产装配(渲染层;C2 控制面板接线用) ───────────────────────────────────

/** drama 读取通道:electronAPI.projectFiles.readText(项目相对路径,D12 前置核实)。 */
export function createProjectReadDramaFile(projectId: string | undefined): ReadDramaFile {
  return async (relativePath) => {
    const bridge = getProjectFilesBridge();
    if (!projectId || !bridge?.readText) {
      return { success: false, error: "projectFiles.readText 不可用(无激活项目或环境不支持)" };
    }
    return bridge.readText({ projectId, relativePath });
  };
}

/** scriptDraft 读取:内存窗口优先,窗外章落盘兜底(loadStudioChapterWorkspace)。 */
async function defaultGetScriptDraft(
  projectId: string,
  chapterId: string,
): Promise<string | null> {
  const inMemory = latestAgentWorkEntry(
    useStudioStore.getState().agentWorkData,
    "scriptDraft",
    chapterId,
  )?.data;
  if (inMemory?.trim()) return inMemory;
  try {
    const { loadStudioChapterWorkspace } = await import("@/lib/storage/project-storage");
    const workspace = await loadStudioChapterWorkspace(projectId, chapterId);
    const entries = (workspace?.domains?.agentWorkData ?? []) as Array<{
      key?: string;
      episodeId?: string;
      data?: string;
      updatedAt?: number;
    }>;
    const latest = entries
      .filter(
        (entry) =>
          entry.key === "scriptDraft" &&
          entry.episodeId === chapterId &&
          (entry.data ?? "").trim(),
      )
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
    return latest?.data ?? null;
  } catch {
    return null;
  }
}

/** 三库条目(晋升判定与 dedupe 的 id 真源;别名走 notes 首行守门解析)。 */
function defaultGetLibraryEntities(projectId: string): RunnerLibraryEntity[] {
  const characters = useCharacterLibraryStore
    .getState()
    .characters.filter((item) => item.projectId === projectId)
    .map((item) => ({
      id: item.id,
      kind: "character" as const,
      name: item.name,
      aliases: parseAliasesFromNotes(item.notes),
    }));
  const scenes = useSceneStore
    .getState()
    .scenes.filter((item) => item.projectId === projectId)
    .map((item) => ({
      id: item.id,
      kind: "scene" as const,
      name: item.name,
      aliases: parseAliasesFromNotes(item.notes),
    }));
  const props = usePropsLibraryStore
    .getState()
    .items.filter((item) => item.projectId === projectId)
    .map((item) => ({ id: item.id, kind: "prop" as const, name: item.name, aliases: [] }));
  return [...characters, ...scenes, ...props];
}

/** 生产 deps(渲染层;C2 面板/C3 分段执行接线)。 */
export function createRunnerDeps(init: {
  projectId: string;
  projectName: string;
}): EntityExtractionRunnerDeps {
  const bridge = getProjectFilesBridge();
  if (!bridge) {
    throw new Error("项目文件桥不可用,无法装配全书提取执行器");
  }
  return {
    projectId: init.projectId,
    projectName: init.projectName,
    storage: createElectronLedgerStorage(init.projectId, bridge),
    readDramaFile: createProjectReadDramaFile(init.projectId),
    modelCall: createDefaultEntityModelCall(),
    getScriptDraft: (chapterId) => defaultGetScriptDraft(init.projectId, chapterId),
    saveEntityExtraction: (result) => useStudioStore.getState().saveEntityExtraction(result),
    createSinks: () => createMystudioSinks(),
    getLibraryEntities: () => defaultGetLibraryEntities(init.projectId),
    getResolvedModel: () =>
      aiManager.resolve({ agent: "entityExtraction" })?.model ??
      aiManager.resolve({ agent: "universalAi" })?.model ??
      null,
    getChapterIdentity: (chapterId) => {
      const chapter = useStudioStore
        .getState()
        .novelChapters.find((item) => item.id === chapterId);
      return chapter
        ? { sourceId: chapter.sourceId, revision: chapter.revision }
        : null;
    },
  };
}
