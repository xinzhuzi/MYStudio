import runtimeContractJson from "../../assets/studio-manuals/art_skills/daojie_ink_guofeng/ma_sync/runtime-contract.json";
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
  moduleSeparator: string;
  negativeSeparator: string;
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
  if (value.moduleSeparator !== " " || value.negativeSeparator !== "、" || value.avoidSeparator !== "\nAvoid: ") {
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
  /** 分镜帧负面(手册 storyboard-frame-negative 块等),与通用负面合并去重。 */
  negativeTerms?: string | readonly string[];
}

/**
 * 分镜帧 ma-gongbi-v1 传输编译:不套静态资产七段、不追加轨道锁,
 * 只共享唯一 Avoid 段、通用负面、300-800 长度门与合同指纹,产物以 raw 策略直传 provider。
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
  const negative = mergeNegativeTerms(
    input.negativeTerms,
    DAOJIE_RUNTIME_CONTRACT.modules["negative.universal"].text,
  );
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
  return cleaned
    .split(/[、,，;；]/)
    .map((term) => term.trim())
    .filter(Boolean);
}

function mergeNegativeTerms(input: DaojiePromptInput["negativeTerms"], universal: string): string {
  const values = typeof input === "string" ? [input] : input ? [...input] : [];
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const value of [...values.flatMap(splitNegativeTerms), ...splitNegativeTerms(universal)]) {
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      terms.push(value);
    }
  }
  return terms.join(DAOJIE_RUNTIME_CONTRACT.negativeSeparator);
}

export async function compileDaojiePrompt(input: DaojiePromptInput): Promise<CompiledDaojiePrompt> {
  const { runtimeTrack, maTrack } = mapDaojieRuntimeTrack(input.runtimeTrack);
  if (typeof input.subjectBody !== "string" || !input.subjectBody.trim()) {
    throw new DaojiePromptContractError("invalid_subject", input.subjectBody);
  }
  const subjectBody = input.subjectBody.trim();
  if (/Avoid:/i.test(subjectBody)) {
    throw new DaojiePromptContractError("invalid_subject", subjectBody, { reason: "subject owns no terminal negative section" });
  }
  const trackModuleId = `style.gongbi-track.${maTrack}`;
  const positiveModuleIds = [
    "subject.body",
    "palette.source-facts-only",
    "style.gongbi-base",
    trackModuleId,
    "finish.quality",
    ...(input.hasReferenceImage ? ["reference.denoise"] : []),
  ];
  const positiveParts = [
    subjectBody,
    DAOJIE_RUNTIME_CONTRACT.modules["palette.source-facts-only"].text,
    DAOJIE_RUNTIME_CONTRACT.modules["style.gongbi-base"].text,
    DAOJIE_RUNTIME_CONTRACT.modules[trackModuleId].text,
    DAOJIE_RUNTIME_CONTRACT.modules["finish.quality"].text,
    ...(input.hasReferenceImage ? [DAOJIE_RUNTIME_CONTRACT.modules["reference.denoise"].text] : []),
  ];
  const positive = positiveParts.join(DAOJIE_RUNTIME_CONTRACT.moduleSeparator);
  const negative = mergeNegativeTerms(input.negativeTerms, DAOJIE_RUNTIME_CONTRACT.modules["negative.universal"].text);
  const length = evaluateDaojiePromptLength(positive, negative);
  const moduleLengths: Record<string, number> = { "subject.body": unicodeLength(subjectBody) };
  for (const moduleId of positiveModuleIds.slice(1)) {
    moduleLengths[moduleId] = unicodeLength(DAOJIE_RUNTIME_CONTRACT.modules[moduleId].text);
  }
  moduleLengths["negative.universal"] = unicodeLength(negative);
  const moduleIds = [...positiveModuleIds, "negative.universal"];
  const moduleAudit = moduleIds.map((moduleId) => ({
    moduleId,
    required: true as const,
    singletonKey: moduleId === "subject.body"
      ? "subject_body"
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
