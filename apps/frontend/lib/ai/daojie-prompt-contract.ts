import runtimeContractJson from "../../assets/studio-manuals/art_skills/daojie_ink_guofeng/ma_sync/runtime-contract.json";
import {
  buildDaojiePaletteModuleText,
  daojiePaletteModuleId,
  resolveDaojiePaletteScheme,
  type DaojiePaletteScheme,
} from "./daojie-palette";
import { sha256CanonicalJson } from "../studio/remotion/canonical-json";

export type DaojieLibraryAssetType = "role" | "scene" | "tool";
export type DaojieRuntimeTrack = "character" | "scene" | "prop";
export type DaojieMaTrack = "person" | "scene" | "prop";

export interface DaojieTrackMapping {
  libraryType: DaojieLibraryAssetType;
  runtimeTrack: DaojieRuntimeTrack;
  maTrack: DaojieMaTrack;
}

interface DaojieContractSource {
  path: string;
  sha256: string;
  responsibility?: string;
  anchor?: string;
}

interface DaojieContractModule {
  moduleId: string;
  text: string;
  required: boolean;
  singletonKey: string;
  requires?: string[];
  source: DaojieContractSource;
}

export interface DaojieRuntimeContract {
  contractVersion: "ma-gongbi-v1";
  contractSha256: string;
  syncedAt: string;
  maSources: DaojieContractSource[];
  trackMappings: Record<DaojieLibraryAssetType, { runtimeTrack: DaojieRuntimeTrack; maTrack: DaojieMaTrack }>;
  moduleOrder: string[];
  /** 核心题材模块(题材/配色/底座/轨道)间隔符,对齐 MA composer 的 " ".join。 */
  moduleSeparator: " ";
  /** 传输锁(成片/参考图)追加间隔符,对齐 MA finish_locks 的 "\n{lock}" 追加。 */
  transportLockSeparator: "\n";
  /** 负面词条连接符,对齐 MA merge_universal_negative 的 ", ".join。 */
  negativeSeparator: ", ";
  avoidSeparator: "\nAvoid: ";
  length: { warningBelow: 300; min: 300; max: 800 };
  modules: Record<string, DaojieContractModule>;
}

export type DaojiePromptContractErrorCode =
  | "unsupported_asset_type"
  | "unsupported_track"
  | "invalid_contract"
  | "invalid_subject"
  | "length_exceeded";

export class DaojiePromptContractError extends Error {
  readonly code: DaojiePromptContractErrorCode;
  readonly input: unknown;

  readonly details: Record<string, unknown>;

  constructor(code: DaojiePromptContractErrorCode, input: unknown, details: Record<string, unknown> = {}) {
    super(`${code}: ${String(input)}`);
    this.name = "DaojiePromptContractError";
    this.code = code;
    this.input = input;
    this.details = details;
  }
}

const LIBRARY_TYPES: readonly DaojieLibraryAssetType[] = ["role", "scene", "tool"];
const RUNTIME_TRACKS: readonly DaojieRuntimeTrack[] = ["character", "scene", "prop"];
const MA_TRACKS: readonly DaojieMaTrack[] = ["person", "scene", "prop"];
const EXPECTED_TRACK_MAPPINGS: DaojieRuntimeContract["trackMappings"] = {
  role: { runtimeTrack: "character", maTrack: "person" },
  scene: { runtimeTrack: "scene", maTrack: "scene" },
  tool: { runtimeTrack: "prop", maTrack: "prop" },
};
const EXPECTED_MODULE_ORDER = [
  "subject.body",
  "palette.source-facts-only",
  "style.gongbi-base",
  "style.gongbi-track.{maTrack}",
  "finish.quality",
  "reference.denoise",
  "negative.universal",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function invalidContract(input: unknown, reason: string): DaojiePromptContractError {
  return new DaojiePromptContractError("invalid_contract", input, { reason });
}

export function validateDaojieRuntimeContract(value: unknown): DaojieRuntimeContract {
  if (!isRecord(value) || value.contractVersion !== "ma-gongbi-v1" || !isSha256(value.contractSha256)) {
    throw invalidContract(value, "contractVersion");
  }
  if (typeof value.syncedAt !== "string" || !Array.isArray(value.maSources) || value.maSources.length < 3) {
    throw invalidContract(value, "syncedAt/maSources");
  }
  for (const source of value.maSources) {
    if (!isRecord(source) || typeof source.path !== "string" || !isSha256(source.sha256)) {
      throw invalidContract(value, "maSources");
    }
  }
  if (!isRecord(value.trackMappings)) throw invalidContract(value, "trackMappings");
  if (Object.keys(value.trackMappings).sort().join(",") !== [...LIBRARY_TYPES].sort().join(",")) {
    throw invalidContract(value, "trackMappings keys");
  }
  for (const libraryType of LIBRARY_TYPES) {
    const mapping = value.trackMappings[libraryType];
    if (!isRecord(mapping) || !RUNTIME_TRACKS.includes(mapping.runtimeTrack as DaojieRuntimeTrack)
      || !MA_TRACKS.includes(mapping.maTrack as DaojieMaTrack)
      || mapping.runtimeTrack !== EXPECTED_TRACK_MAPPINGS[libraryType].runtimeTrack
      || mapping.maTrack !== EXPECTED_TRACK_MAPPINGS[libraryType].maTrack) {
      throw invalidContract(value, `trackMappings.${libraryType}`);
    }
  }
  if (JSON.stringify(value.moduleOrder) !== JSON.stringify(EXPECTED_MODULE_ORDER)) {
    throw invalidContract(value, "moduleOrder");
  }
  if (
    value.moduleSeparator !== " "
    || value.transportLockSeparator !== "\n"
    || value.negativeSeparator !== ", "
    || value.avoidSeparator !== "\nAvoid: "
  ) {
    throw invalidContract(value, "separators");
  }
  if (!isRecord(value.length) || value.length.warningBelow !== 300 || value.length.min !== 300 || value.length.max !== 800) {
    throw invalidContract(value, "length");
  }
  if (!isRecord(value.modules)) throw invalidContract(value, "modules");
  const sourceHashes = new Map(
    value.maSources.map((source) => [(source as Record<string, unknown>).path, (source as Record<string, unknown>).sha256]),
  );
  const requiredIds = [
    "palette.source-facts-only",
    "style.gongbi-base",
    "style.gongbi-track.person",
    "style.gongbi-track.scene",
    "style.gongbi-track.prop",
    "finish.quality",
    "reference.denoise",
    "negative.universal",
  ];
  for (const moduleId of requiredIds) {
    const module = value.modules[moduleId];
    if (!isRecord(module) || module.moduleId !== moduleId || typeof module.text !== "string" || !module.text.trim() || module.required !== true
      || typeof module.singletonKey !== "string" || !module.singletonKey.trim() || !isRecord(module.source)
      || typeof module.source.path !== "string" || !isSha256(module.source.sha256)
      || sourceHashes.get(module.source.path) !== module.source.sha256) {
      throw invalidContract(value, `modules.${moduleId}`);
    }
    if (moduleId !== "negative.universal" && /Avoid:/i.test(module.text)) {
      throw invalidContract(value, `modules.${moduleId}.text`);
    }
  }
  return value as unknown as DaojieRuntimeContract;
}

export const DAOJIE_RUNTIME_CONTRACT = validateDaojieRuntimeContract(runtimeContractJson);

let verifiedContractSha256: Promise<string> | undefined;

function getVerifiedContractSha256(): Promise<string> {
  if (!verifiedContractSha256) {
    const { contractSha256, ...fingerprintMaterial } = DAOJIE_RUNTIME_CONTRACT;
    verifiedContractSha256 = sha256CanonicalJson(fingerprintMaterial).then((actual) => {
      if (actual !== contractSha256) {
        throw invalidContract(DAOJIE_RUNTIME_CONTRACT, `contractSha256 ${actual}`);
      }
      return actual;
    });
  }
  return verifiedContractSha256;
}

export function mapDaojieLibraryAssetType(input: unknown): DaojieTrackMapping {
  if (typeof input !== "string" || !LIBRARY_TYPES.includes(input as DaojieLibraryAssetType)) {
    throw new DaojiePromptContractError("unsupported_asset_type", input);
  }
  const libraryType = input as DaojieLibraryAssetType;
  const mapping = DAOJIE_RUNTIME_CONTRACT.trackMappings[libraryType];
  return { libraryType, ...mapping };
}

export function mapDaojieRuntimeTrack(input: unknown): { runtimeTrack: DaojieRuntimeTrack; maTrack: DaojieMaTrack } {
  if (typeof input !== "string" || !RUNTIME_TRACKS.includes(input as DaojieRuntimeTrack)) {
    throw new DaojiePromptContractError("unsupported_track", input);
  }
  const runtimeTrack = input as DaojieRuntimeTrack;
  const mapping = Object.values(DAOJIE_RUNTIME_CONTRACT.trackMappings).find(
    (entry) => entry.runtimeTrack === runtimeTrack,
  );
  if (!mapping) throw new DaojiePromptContractError("unsupported_track", input);
  return { runtimeTrack, maTrack: mapping.maTrack };
}

export interface DaojieStoryboardFramePromptInput {
  /** 分镜帧已装配正文(画面/构图/阵营色/风格 token;模板选择归分镜链,编译器不改写)。 */
  positive: string;
  /**
   * 分镜帧负面(手册 storyboard-frame-negative 块等)。提供时它即本作业负面唯一所有者
   * (去重后直接使用,不再叠加通用负面——手册帧负面已是 ma-gongbi-v1 对齐的五类全集,
   * 叠加违反负面唯一所有者且必然超 800 门);未提供时回退合同通用负面。
   */
  negativeTerms?: string | readonly string[];
}

/**
 * 分镜帧 ma-gongbi-v1 传输编译:不套静态资产七段、不追加轨道锁,
 * 只共享唯一 Avoid 段、负面唯一所有者、300-800 长度门与合同指纹,产物以 raw 策略直传 provider。
 */
export async function compileDaojieStoryboardFramePrompt(
  input: DaojieStoryboardFramePromptInput,
): Promise<CompiledDaojiePrompt> {
  const positive = input.positive.trim();
  if (!positive) {
    throw new DaojiePromptContractError("invalid_subject", input.positive);
  }
  if (/Avoid:/i.test(positive)) {
    throw new DaojiePromptContractError("invalid_subject", positive, { reason: "storyboard positive owns no terminal negative section" });
  }
  const hasOwnNegative = input.negativeTerms !== undefined
    && (typeof input.negativeTerms === "string" ? input.negativeTerms.trim() : input.negativeTerms.length > 0);
  const negative = hasOwnNegative
    ? mergeNegativeTerms(input.negativeTerms, "")
    : mergeNegativeTerms(DAOJIE_RUNTIME_CONTRACT.modules["negative.universal"].text, "");
  const length = evaluateDaojiePromptLength(positive, negative);
  const moduleLengths: Record<string, number> = {
    "storyboard.frame": unicodeLength(positive),
    "negative.universal": unicodeLength(negative),
  };
  if (length.status === "over_limit") {
    throw new DaojiePromptContractError("length_exceeded", length.totalChars, {
      totalChars: length.totalChars,
      moduleLengths,
    });
  }
  return {
    track: "scene",
    maTrack: "scene",
    positive,
    negative,
    providerPrompt: `${positive}${DAOJIE_RUNTIME_CONTRACT.avoidSeparator}${negative}`,
    moduleIds: ["storyboard.frame", "negative.universal"],
    moduleLengths,
    moduleAudit: [
      { moduleId: "storyboard.frame", required: true, singletonKey: "storyboard_frame", chars: moduleLengths["storyboard.frame"]! },
      { moduleId: "negative.universal", required: true, singletonKey: "universal_negative", chars: moduleLengths["negative.universal"]! },
    ],
    totalChars: length.totalChars,
    status: length.status,
    contractVersion: DAOJIE_RUNTIME_CONTRACT.contractVersion,
    contractSha256: await getVerifiedContractSha256(),
  };
}

export interface DaojiePromptInput {
  runtimeTrack: DaojieRuntimeTrack;
  subjectBody: string;
  negativeTerms?: string | readonly string[];
  hasReferenceImage?: boolean;
  /**
   * 三轨配色方案 id(ma-gongbi-palette-v1,如 "person.02")。
   * 提供时配色模块输出 MA 同构的五职责色配方(palette.<id>);缺省走 source-facts-only。
   * 未知/跨轨方案 fail-closed(对齐 MA _resolve_palette_roles)。
   */
  paletteSchemeId?: string;
}

export interface DaojiePromptLengthResult {
  positiveChars: number;
  negativeChars: number;
  separatorChars: number;
  totalChars: number;
  status: "warning" | "ok" | "over_limit";
  ok: boolean;
}

export interface CompiledDaojiePrompt {
  track: DaojieRuntimeTrack;
  maTrack: DaojieMaTrack;
  positive: string;
  negative: string;
  providerPrompt: string;
  moduleIds: string[];
  moduleLengths: Record<string, number>;
  moduleAudit: Array<{
    moduleId: string;
    required: true;
    singletonKey: string;
    chars: number;
  }>;
  totalChars: number;
  status: "warning" | "ok";
  contractVersion: "ma-gongbi-v1";
  contractSha256: string;
}

function unicodeLength(value: string): number {
  return Array.from(value).length;
}

export function evaluateDaojiePromptLength(positive: string, negative: string): DaojiePromptLengthResult {
  const positiveChars = unicodeLength(positive);
  const negativeChars = unicodeLength(negative);
  const separatorChars = negative ? unicodeLength(DAOJIE_RUNTIME_CONTRACT.avoidSeparator) : 0;
  const totalChars = positiveChars + separatorChars + negativeChars;
  const status = totalChars > DAOJIE_RUNTIME_CONTRACT.length.max
    ? "over_limit"
    : totalChars < DAOJIE_RUNTIME_CONTRACT.length.warningBelow ? "warning" : "ok";
  return { positiveChars, negativeChars, separatorChars, totalChars, status, ok: status !== "over_limit" };
}

function splitNegativeTerms(value: string): string[] {
  const cleaned = value.replace(/Avoid:\s*/gi, "");
  // 对齐 MA merge_universal_negative:仅按 、;；, 切分(不切全角逗号),词条边缘剥 ,;，；
  return cleaned
    .split(/[、;；,]/)
    .map((term) => term.trim().replace(/^[,;，；]+|[,;，；]+$/g, ""))
    .filter(Boolean);
}

/**
 * 负面合并,逐条对齐 MA merge_universal_negative:
 * 先作业负面后通用负面;精确小写去重;新词若是任一已收词的子串(或等长互含)则抑制;
 * 最终以 ", " 连接(MA transport 方言)。
 */
function mergeNegativeTerms(input: DaojiePromptInput["negativeTerms"], universal: string): string {
  const values = typeof input === "string" ? [input] : input ? [...input] : [];
  const terms: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string): void => {
    const value = raw;
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    for (const prior of seen) {
      if ((key.includes(prior) || prior.includes(key)) && key.length <= prior.length) return;
    }
    seen.add(key);
    terms.push(value);
  };
  for (const value of [...values.flatMap(splitNegativeTerms), ...splitNegativeTerms(universal)]) {
    add(value);
  }
  return terms.join(DAOJIE_RUNTIME_CONTRACT.negativeSeparator);
}

/**
 * 题材正文不得携带自动层属主标记(对齐 MA _assert_clean_primary/OWNER_MARKERS):
 * 防止把已编译产物再次当题材输入导致锁重复装配。
 */
const SUBJECT_OWNER_MARKERS = [
  "avoid:",
  "style lock",
  "风格底座",
  "track=",
  "轨道=",
  "成片质量（硬",
  "参考图降噪",
  "配料方案",
] as const;

function assertSubjectOwnsNoAutomaticLayer(subjectBody: string): void {
  const lowered = subjectBody.toLowerCase();
  for (const marker of SUBJECT_OWNER_MARKERS) {
    if (lowered.includes(marker)) {
      throw new DaojiePromptContractError("invalid_subject", subjectBody, {
        reason: `subject body contains automatic owner marker: ${marker}`,
      });
    }
  }
}

export async function compileDaojiePrompt(input: DaojiePromptInput): Promise<CompiledDaojiePrompt> {
  const { runtimeTrack, maTrack } = mapDaojieRuntimeTrack(input.runtimeTrack);
  if (typeof input.subjectBody !== "string" || !input.subjectBody.trim()) {
    throw new DaojiePromptContractError("invalid_subject", input.subjectBody);
  }
  const subjectBody = input.subjectBody.trim();
  assertSubjectOwnsNoAutomaticLayer(subjectBody);
  const trackModuleId = `style.gongbi-track.${maTrack}`;
  const paletteScheme: DaojiePaletteScheme | null = input.paletteSchemeId
    ? resolveDaojiePaletteScheme(input.paletteSchemeId, maTrack)
    : null;
  const paletteModuleId = paletteScheme ? daojiePaletteModuleId(paletteScheme) : "palette.source-facts-only";
  const paletteText = paletteScheme
    ? buildDaojiePaletteModuleText(paletteScheme)
    : DAOJIE_RUNTIME_CONTRACT.modules["palette.source-facts-only"].text;
  const positiveModuleIds = [
    "subject.body",
    paletteModuleId,
    "style.gongbi-base",
    trackModuleId,
    "finish.quality",
    ...(input.hasReferenceImage ? ["reference.denoise"] : []),
  ];
  // MA 两阶段形态:composer 空格连接题材/配色/底座/轨道;transport 以换行追加成片与参考图锁
  const corePositive = [
    subjectBody,
    paletteText,
    DAOJIE_RUNTIME_CONTRACT.modules["style.gongbi-base"].text,
    DAOJIE_RUNTIME_CONTRACT.modules[trackModuleId].text,
  ].join(DAOJIE_RUNTIME_CONTRACT.moduleSeparator);
  const positive = [
    corePositive,
    DAOJIE_RUNTIME_CONTRACT.modules["finish.quality"].text,
    ...(input.hasReferenceImage ? [DAOJIE_RUNTIME_CONTRACT.modules["reference.denoise"].text] : []),
  ].join(DAOJIE_RUNTIME_CONTRACT.transportLockSeparator);
  const negative = mergeNegativeTerms(input.negativeTerms, DAOJIE_RUNTIME_CONTRACT.modules["negative.universal"].text);
  const length = evaluateDaojiePromptLength(positive, negative);
  const moduleLengths: Record<string, number> = { "subject.body": unicodeLength(subjectBody) };
  for (const moduleId of positiveModuleIds.slice(1)) {
    moduleLengths[moduleId] = moduleId === paletteModuleId
      ? unicodeLength(paletteText)
      : unicodeLength(DAOJIE_RUNTIME_CONTRACT.modules[moduleId].text);
  }
  moduleLengths["negative.universal"] = unicodeLength(negative);
  const moduleIds = [...positiveModuleIds, "negative.universal"];
  const moduleAudit = moduleIds.map((moduleId) => ({
    moduleId,
    required: true as const,
    singletonKey: moduleId === "subject.body"
      ? "subject_body"
      : moduleId === paletteModuleId
        ? "gongbi_palette_scheme"
        : DAOJIE_RUNTIME_CONTRACT.modules[moduleId].singletonKey,
    chars: moduleLengths[moduleId],
  }));
  if (length.status === "over_limit") {
    throw new DaojiePromptContractError("length_exceeded", length.totalChars, { totalChars: length.totalChars, moduleLengths });
  }
  return {
    track: runtimeTrack,
    maTrack,
    positive,
    negative,
    providerPrompt: `${positive}${DAOJIE_RUNTIME_CONTRACT.avoidSeparator}${negative}`,
    moduleIds,
    moduleLengths,
    moduleAudit,
    totalChars: length.totalChars,
    status: length.status,
    contractVersion: DAOJIE_RUNTIME_CONTRACT.contractVersion,
    contractSha256: await getVerifiedContractSha256(),
  };
}
