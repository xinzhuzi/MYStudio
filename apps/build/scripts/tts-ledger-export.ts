/**
 * TTS 台账导出(派生只读审计工具,方案 A 落地)
 *
 * 定位:把 Remotion 工作流里分散的 TTS 指纹链(chapters/<id>.json 封印 manifest、
 * audio/<chapter>/shots/<shotId>/voice/<sha256>.wav 内容寻址音频、store 分镜文本、
 * store/tts.json 音色档案)聚合成一份人类可读 + 机器可读的台账,落到项目侧
 * remotion/tts-ledger/<chapterId>.json + .md。
 *
 * 铁律(与 storyboard-data-lint 同族):
 * - 台账是派生物,永远不回读:不进 store、不参与任何校验链、不改封印文件。
 * - 只写 remotion/tts-ledger/ 目录;应用侧对 remotion/ 工作区按固定槽位读写,
 *   唯一目录枚举在 jobs/shot/<chapterId>/ 下,对新增同级目录零感知。
 * - 逐镜校验四件事:manifest 封印 / binding 封印 / 音频内容 sha256 / 音色档案回溯。
 * - 校验失败(封印断/音频缺失/哈希不符)→ exitCode 1,可当体检门禁用。
 *
 * Usage:
 *   cd apps && npx vite-node --config build/timeline/vite-node.config.ts \
 *     build/scripts/tts-ledger-export.ts --project /path/to/project [--chapter chapter-001] [--check]
 *   (--project 缺省走 MYSTUDIO_PROJECT_DIR / 注册表推导;--check 只校验不落盘)
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { sha256CanonicalJson } from "@/lib/studio/remotion/canonical-json";
import { createStoryboardTtsInputFingerprint } from "@/lib/studio/storyboard-tts-runner";
import type { RemotionShotAudioBindingV2 } from "@/types/remotion-workspace";
import type { StoryboardItem } from "@/types/studio";
import type { VoiceProfile } from "@/types/tts";
import {
  readStudioWorkflowStoreState,
  resolveProjectDir,
  resolveStorageBasePath,
} from "../timeline/storage-paths";
import {
  resolveAssetFilePath as resolveManagedAssetFile,
} from "../../frontend/electron/storage/storage-paths";

const LEDGER_SCHEMA_VERSION = 1;
const GENERATOR = "tts-ledger-export@1";

// ────────────────────────────── 台账数据模型 ──────────────────────────────

export interface TtsLedgerShotChecks {
  /** binding 记录去掉 bindingFingerprint 后重算 canonical SHA-256 是否一致 */
  bindingSeal: boolean;
  /** bindingId = voice:<shotId>:<ttsInputFingerprint> 三段是否自洽 */
  bindingIdConsistent: boolean;
  /** 封印指向的音频文件在项目内是否存在 */
  audioPresent: boolean;
  /** 文件字节 sha256 是否等于 sourceFingerprint / contentSha256 / 文件名 */
  audioSha256Match: boolean;
}

export interface TtsLedgerShotProvenance {
  /** 封印指纹的来源链:TTS 生成链(文本+档案) / 配音室导入链(音频内容身份) / 未定 */
  chain: "tts-generated" | "voice-import" | "unresolved";
  /** 对应链公式能否复现封印的 ttsInputFingerprint */
  verified: boolean;
  /** tts-generated 链命中的音色档案 id */
  profileIds: string[];
  /** 未复现时的解释线索 */
  hints: string[];
}

export interface TtsLedgerShotRecord {
  shotId: string;
  manifestIndex: number;
  shotRevision: number;
  storyboardFound: boolean;
  /** 分镜当前 outputVersion 与封印 shotRevision 是否一致(null=无分镜可对) */
  storyboardRevisionAligned: boolean | null;
  speaker: string | null;
  speakerId: string | null;
  emotion: string | null;
  voiceStyle: string | null;
  ttsSpokenText: string | null;
  line: string | null;
  durationUs: number | null;
  bindingId: string | null;
  ttsInputFingerprint: string | null;
  bindingFingerprint: string | null;
  audio: { relativePath: string; bytes: number; sha256: string } | null;
  checks: TtsLedgerShotChecks;
  provenance: TtsLedgerShotProvenance;
  liveTtsJob: Pick<
    StoryboardTtsJobV1,
    "status" | "attempt" | "generationId" | "inputFingerprint" | "updatedAt"
  > | null;
  /** 同 voice/ 目录下未被 manifest 引用的其他生成代次(内容寻址,历史共存) */
  orphanGenerations: { fileName: string; bytes: number }[];
}

export interface TtsLedgerSharedAudioRecord {
  bindingId: string;
  role: string;
  bindingSeal: boolean;
  audioPresent: boolean;
  audioSha256Match: boolean;
  relativePath: string | null;
}

export interface TtsLedgerChapter {
  kind: "mystudio-tts-ledger";
  schemaVersion: number;
  generator: string;
  generatedAt: string;
  project: { root: string; projectId: string };
  chapter: {
    chapterId: string;
    manifestRevision: number;
    manifestFingerprint: string;
    manifestSealCheck: "pass" | "fail";
    shotCount: number;
  };
  summary: {
    bindingSealPass: number;
    bindingSealFail: number;
    audioMissing: number;
    audioSha256Mismatch: number;
    provenance: { ttsGenerated: number; voiceImport: number; unresolved: number };
    orphanGenerations: number;
    allChecksPass: boolean;
  };
  shots: TtsLedgerShotRecord[];
  sharedAudio: TtsLedgerSharedAudioRecord[];
}

// ────────────────────────────── 封印校验(纯函数) ──────────────────────────────

function stripTopLevelField<T extends Record<string, unknown>>(value: T, field: string): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...value };
  delete clone[field];
  return clone;
}

/** 与 remotion-audio-fingerprint.ts 的 remotionAudioBindingFingerprintInput 同口径 */
export async function computeBindingFingerprint(
  binding: Record<string, unknown>,
): Promise<string> {
  return sha256CanonicalJson(stripTopLevelField(binding, "bindingFingerprint"));
}

/** 与 remotion-audio-fingerprint.ts 的 manifest 封印同口径 */
export async function computeManifestFingerprint(
  manifest: Record<string, unknown>,
): Promise<string> {
  return sha256CanonicalJson(stripTopLevelField(manifest, "manifestFingerprint"));
}

export function parseVoiceBindingId(
  bindingId: string | null | undefined,
): { shotId: string; ttsInputFingerprint: string } | null {
  if (typeof bindingId !== "string") return null;
  const parts = bindingId.split(":");
  if (parts.length !== 3 || parts[0] !== "voice") return null;
  const [, shotId, ttsInputFingerprint] = parts;
  if (!shotId || !/^[0-9a-f]{64}$/.test(ttsInputFingerprint)) return null;
  return { shotId, ttsInputFingerprint };
}

// ────────────────────────────── 音色档案回溯 ──────────────────────────────

export interface VoiceProfileCandidate {
  profile: VoiceProfile;
  /** 参考音频内容 sha256;解析失败/无参考音频为 null(指纹输入里落 null) */
  referenceAudioSha256: string | null;
  unresolvedReason?: string;
}

/**
 * 配音室导入链指纹(build/timeline/bind-voice-audio.ts 同口径):
 * 封印的是音频内容身份(project/chapter/shot + audioContentSha256),
 * 与 TTS 生成链(文本+音色档案)是两条并存的公式,台账须分别对拍。
 */
export async function computeVoiceImportFingerprint(input: {
  projectId: string;
  chapterId: string;
  shotId: string;
  audioContentSha256: string;
}): Promise<string> {
  return sha256CanonicalJson({
    schemaVersion: 1,
    kind: "exported-voice-import",
    projectId: input.projectId,
    chapterId: input.chapterId,
    shotId: input.shotId,
    audioContentSha256: input.audioContentSha256,
  });
}

/**
 * 用当前分镜文本 + 候选音色档案暴力复算 ttsInputFingerprint,与封印值对拍。
 * 命中 = 文本/情绪/语气/说话人/档案/参考音频/seed/revision 全链可复现;
 * 未命中 = 其中某项在生成后发生过漂移(或档案已删除/改动)。
 * revision 以封印的 shotRevision 为准(分镜当前 outputVersion 可能已前进)。
 */
export async function matchVoiceProfileForShot(input: {
  projectId: string;
  chapterId: string;
  storyboard: StoryboardItem;
  shotRevision: number;
  sealedTtsInputFingerprint: string;
  candidates: readonly VoiceProfileCandidate[];
}): Promise<{ matched: boolean; profileIds: string[]; hints: string[] }> {
  const asOfRevision: StoryboardItem = { ...input.storyboard, outputVersion: input.shotRevision };
  const hints: string[] = [];
  const matched: string[] = [];
  for (const candidate of input.candidates) {
    const fingerprint = await createStoryboardTtsInputFingerprint({
      projectId: input.projectId,
      chapterId: input.chapterId,
      storyboard: asOfRevision,
      profile: candidate.profile,
      referenceAudioSha256: candidate.referenceAudioSha256 ?? undefined,
    });
    if (fingerprint === input.sealedTtsInputFingerprint) matched.push(candidate.profile.id);
  }
  if (matched.length > 0) return { matched: true, profileIds: matched, hints };
  hints.push("当前文本/情绪/语气/说话人/音色档案/参考音频与封印指纹不一致(生成后输入已漂移,或生成时档案已被删除/改动,历史输入不可从当前 store 复原)");
  const unresolved = input.candidates.filter((c) => c.unresolvedReason);
  if (unresolved.length > 0) {
    hints.push(`${unresolved.length} 个候选档案参考音频不可读,已按 null 参与对拍`);
  }
  return { matched: false, profileIds: [], hints };
}

// ────────────────────────────── 台账构建(IO 注入) ──────────────────────────────

export interface TtsLedgerIo {
  /** 读项目内相对路径文件的字节(音频);不存在返回 null */
  readProjectBytes(relativePath: string): Buffer | null;
  /** 列项目内相对路径目录的文件名;目录不存在返回 [] */
  listProjectDir(relativePath: string): string[];
}

function sha256Buffer(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function voiceBindingOf(shot: Record<string, unknown>): RemotionShotAudioBindingV2 | null {
  const bindings = Array.isArray(shot.audioBindings) ? shot.audioBindings : [];
  const voice = bindings.find(
    (b): b is RemotionShotAudioBindingV2 =>
      typeof b === "object" && b !== null && (b as Record<string, unknown>).role === "voice",
  );
  return voice ?? null;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export async function buildChapterLedger(input: {
  manifest: Record<string, unknown>;
  storyboardsById: Map<string, StoryboardItem>;
  profileCandidates: readonly VoiceProfileCandidate[];
  projectRoot: string;
  generatedAt?: string;
  io: TtsLedgerIo;
}): Promise<TtsLedgerChapter> {
  const manifest = input.manifest;
  const projectId = typeof manifest.projectId === "string" ? manifest.projectId : "";
  const chapterId = typeof manifest.chapterId === "string" ? manifest.chapterId : "unknown";
  const manifestRevision = typeof manifest.revision === "number" ? manifest.revision : 0;
  const storedManifestFingerprint = typeof manifest.manifestFingerprint === "string"
    ? manifest.manifestFingerprint
    : "";
  const recomputedManifestFingerprint = await computeManifestFingerprint(manifest);
  const manifestSealCheck = storedManifestFingerprint === recomputedManifestFingerprint
    ? "pass"
    : "fail";

  const shotsInput = Array.isArray(manifest.shots) ? manifest.shots : [];
  const shotRecords: TtsLedgerShotRecord[] = [];

  for (const [manifestIndex, shotRaw] of shotsInput.entries()) {
    if (typeof shotRaw !== "object" || shotRaw === null) continue;
    const shot = shotRaw as Record<string, unknown>;
    const shotId = typeof shot.shotId === "string" ? shot.shotId : `shot-${manifestIndex}`;
    const shotRevision = typeof shot.revision === "number" ? shot.revision : 1;
    const voice = voiceBindingOf(shot);
    const storyboard = input.storyboardsById.get(shotId) ?? null;

    const checks: TtsLedgerShotChecks = {
      bindingSeal: false,
      bindingIdConsistent: false,
      audioPresent: false,
      audioSha256Match: false,
    };
    let audio: TtsLedgerShotRecord["audio"] = null;
    let orphanGenerations: TtsLedgerShotRecord["orphanGenerations"] = [];
    let provenance: TtsLedgerShotProvenance = { chain: "unresolved", verified: false, profileIds: [], hints: [] };

    if (voice) {
      checks.bindingSeal = (await computeBindingFingerprint(voice as Record<string, unknown>))
        === voice.bindingFingerprint;
      const parsedBindingId = parseVoiceBindingId(voice.bindingId);
      checks.bindingIdConsistent = parsedBindingId !== null
        && parsedBindingId.shotId === shotId
        && parsedBindingId.ttsInputFingerprint === (voice.ttsInputFingerprint ?? "");

      const source = typeof voice.source === "object" && voice.source !== null
        ? (voice.source as Record<string, unknown>)
        : {};
      const relativePath = typeof source.relativePath === "string" ? source.relativePath : "";
      if (relativePath) {
        const bytes = input.io.readProjectBytes(relativePath);
        if (bytes) {
          checks.audioPresent = true;
          const actual = sha256Buffer(bytes);
          const expected = voice.sourceFingerprint
            ?? (typeof source.contentSha256 === "string" ? source.contentSha256 : "");
          const fileNameStem = path.basename(relativePath).replace(/\.[^.]+$/, "");
          checks.audioSha256Match = actual === expected && actual === fileNameStem;
          audio = { relativePath, bytes: bytes.length, sha256: actual };
        }
        const voiceDir = path.dirname(relativePath);
        const siblings = input.io.listProjectDir(voiceDir);
        const boundName = path.basename(relativePath);
        orphanGenerations = siblings
          .filter((name) => name !== boundName && !name.startsWith("."))
          .map((name) => {
            const siblingBytes = input.io.readProjectBytes(path.join(voiceDir, name));
            return { fileName: name, bytes: siblingBytes?.length ?? 0 };
          })
          .filter((entry) => entry.bytes > 0);
      }

      if (voice.ttsInputFingerprint) {
        // 先试配音室导入链(一次哈希,用封印内容身份对拍,与磁盘无关);
        // 未中再试 TTS 生成链(当前文本+档案暴力复算)。两条公式在 wild 并存。
        const sealedAudioSha = voice.sourceFingerprint
          ?? (typeof source.contentSha256 === "string" ? source.contentSha256 : "");
        if (sealedAudioSha) {
          const importFingerprint = await computeVoiceImportFingerprint({
            projectId, chapterId, shotId, audioContentSha256: sealedAudioSha,
          });
          if (importFingerprint === voice.ttsInputFingerprint) {
            provenance = { chain: "voice-import", verified: true, profileIds: [], hints: [] };
          }
        }
        if (!provenance.verified && storyboard) {
          const match = await matchVoiceProfileForShot({
            projectId,
            chapterId,
            storyboard,
            shotRevision,
            sealedTtsInputFingerprint: voice.ttsInputFingerprint,
            candidates: input.profileCandidates,
          });
          provenance = match.matched
            ? { chain: "tts-generated", verified: true, profileIds: match.profileIds, hints: [] }
            : {
              chain: "unresolved",
              verified: false,
              profileIds: [],
              hints: [
                ...match.hints,
                ...(sealedAudioSha ? ["配音室导入链公式亦未复现(该指纹出自 TTS 生成链构造)"] : []),
              ],
            };
        } else if (!provenance.verified && !storyboard) {
          provenance = { chain: "unresolved", verified: false, profileIds: [], hints: ["store 中找不到该分镜记录"] };
        }
      } else {
        provenance = { chain: "unresolved", verified: false, profileIds: [], hints: ["binding 未携带 ttsInputFingerprint"] };
      }
    }

    const job = storyboard?.ttsJob ?? null;
    shotRecords.push({
      shotId,
      manifestIndex: manifestIndex + 1,
      shotRevision,
      storyboardFound: storyboard !== null,
      storyboardRevisionAligned: storyboard
        ? Math.max(1, storyboard.outputVersion ?? 1) === shotRevision
        : null,
      speaker: storyboard?.speaker ?? null,
      speakerId: storyboard?.speakerId ?? null,
      emotion: storyboard?.emotion ?? null,
      voiceStyle: storyboard?.voiceStyle ?? null,
      ttsSpokenText: storyboard?.ttsSpokenText ?? null,
      line: storyboard?.line ?? null,
      durationUs: voice?.sourceDurationUs ?? null,
      bindingId: voice?.bindingId ?? null,
      ttsInputFingerprint: voice?.ttsInputFingerprint ?? null,
      bindingFingerprint: voice?.bindingFingerprint ?? null,
      audio,
      checks,
      provenance,
      liveTtsJob: job
        ? {
          status: job.status,
          attempt: job.attempt,
          generationId: job.generationId ?? null,
          inputFingerprint: job.inputFingerprint,
          updatedAt: job.updatedAt,
        }
        : null,
      orphanGenerations,
    });
  }

  const sharedInput = Array.isArray(manifest.sharedAudioBindings)
    ? (manifest.sharedAudioBindings as Record<string, unknown>[])
    : [];
  const sharedAudio: TtsLedgerSharedAudioRecord[] = [];
  for (const binding of sharedInput) {
    const source = typeof binding.source === "object" && binding.source !== null
      ? (binding.source as Record<string, unknown>)
      : {};
    const relativePath = typeof source.relativePath === "string" ? source.relativePath : null;
    let audioPresent = false;
    let audioSha256Match = false;
    if (relativePath) {
      const bytes = input.io.readProjectBytes(relativePath);
      if (bytes) {
        audioPresent = true;
        const actual = sha256Buffer(bytes);
        const expected = typeof binding.sourceFingerprint === "string" ? binding.sourceFingerprint : "";
        const fileNameStem = path.basename(relativePath).replace(/\.[^.]+$/, "");
        audioSha256Match = actual === expected && actual === fileNameStem;
      }
    }
    sharedAudio.push({
      bindingId: typeof binding.bindingId === "string" ? binding.bindingId : "",
      role: typeof binding.role === "string" ? binding.role : "",
      bindingSeal: (await computeBindingFingerprint(binding)) === binding.bindingFingerprint,
      audioPresent,
      audioSha256Match,
      relativePath,
    });
  }

  const bindingSealFail = shotRecords.filter((r) => !r.checks.bindingSeal).length;
  const audioMissing = shotRecords.filter((r) => r.bindingFingerprint !== null && !r.checks.audioPresent).length;
  const audioSha256Mismatch = shotRecords.filter((r) => r.checks.audioPresent && !r.checks.audioSha256Match).length;
  const provenanceTts = shotRecords.filter((r) => r.provenance.chain === "tts-generated" && r.provenance.verified).length;
  const provenanceImport = shotRecords.filter((r) => r.provenance.chain === "voice-import" && r.provenance.verified).length;
  const provenanceUnresolved = shotRecords.length - provenanceTts - provenanceImport;
  const orphanTotal = shotRecords.reduce((sum, r) => sum + r.orphanGenerations.length, 0);
  const sharedFail = sharedAudio.filter((r) => !r.bindingSeal || !r.audioPresent || !r.audioSha256Match).length;

  return {
    kind: "mystudio-tts-ledger",
    schemaVersion: LEDGER_SCHEMA_VERSION,
    generator: GENERATOR,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    project: { root: input.projectRoot, projectId },
    chapter: {
      chapterId,
      manifestRevision,
      manifestFingerprint: storedManifestFingerprint,
      manifestSealCheck,
      shotCount: shotRecords.length,
    },
    summary: {
      bindingSealPass: shotRecords.length - bindingSealFail,
      bindingSealFail,
      audioMissing,
      audioSha256Mismatch,
      provenance: {
        ttsGenerated: provenanceTts,
        voiceImport: provenanceImport,
        unresolved: provenanceUnresolved,
      },
      orphanGenerations: orphanTotal,
      allChecksPass: manifestSealCheck === "pass"
        && bindingSealFail === 0
        && audioMissing === 0
        && audioSha256Mismatch === 0
        && sharedFail === 0,
    },
    shots: shotRecords,
    sharedAudio,
  };
}

// ────────────────────────────── Markdown 渲染(纯函数) ──────────────────────────────

function shortFingerprint(value: string | null | undefined): string {
  if (!value) return "-";
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function mark(ok: boolean): string {
  return ok ? "✓" : "✗";
}

export function renderTtsLedgerMarkdown(ledger: TtsLedgerChapter): string {
  const { chapter, summary } = ledger;
  const lines: string[] = [];
  lines.push(`# TTS 台账 · ${chapter.chapterId}`);
  lines.push("");
  lines.push(`> 派生只读文档,由 \`${GENERATOR}\` 生成;勿手编。重新生成:`);
  lines.push(">");
  lines.push("> ```");
  lines.push("> cd apps && npx vite-node --config build/timeline/vite-node.config.ts \\");
  lines.push(">   build/scripts/tts-ledger-export.ts --project <项目根>");
  lines.push("> ```");
  lines.push("");
  lines.push(`- 生成时间:${ledger.generatedAt}`);
  lines.push(`- manifest revision **${chapter.manifestRevision}**,封印校验 ${mark(chapter.manifestSealCheck === "pass")}(\`${shortFingerprint(chapter.manifestFingerprint)}\`)`);
  lines.push(`- 镜数:**${chapter.shotCount}**;binding 封印 ${summary.bindingSealPass}/${chapter.shotCount} ${summary.bindingSealFail === 0 ? "✓" : "✗"}`);
  lines.push(`- 音频:缺失 ${summary.audioMissing},哈希不符 ${summary.audioSha256Mismatch}`);
  lines.push(`- 来源链回溯:TTS 生成链 ${summary.provenance.ttsGenerated} / 配音室导入链 ${summary.provenance.voiceImport} / 未定 ${summary.provenance.unresolved}(未定≠事故,见明细)`);
  lines.push(`- 历史代次(未被 manifest 引用的共存音频):${summary.orphanGenerations} 个`);
  lines.push(`- 综合裁定:**${summary.allChecksPass ? "全绿" : "存在失败项"}**`);
  lines.push("");

  lines.push("## 逐镜");
  lines.push("");
  lines.push("| # | 镜 | rev | 说话人 | 台词(截断) | 来源链 | 时长s | TTS指纹 | 音频sha | 封印 | 音频 | 来源 |");
  lines.push("|---|----|----|--------|------------|--------|------|--------|--------|------|------|------|");
  for (const shot of ledger.shots) {
    const provenanceCell = shot.provenance.verified
      ? (shot.provenance.chain === "voice-import"
        ? "导入✓"
        : `TTS·${shortFingerprint(shot.provenance.profileIds[0])}`)
      : "未定";
    lines.push(
      `| ${shot.manifestIndex} | ${shot.shotId} | ${shot.shotRevision} `
      + `| ${shot.speaker ?? "-"} `
      + `| ${shot.ttsSpokenText ? truncate(shot.ttsSpokenText, 24) : "-"} `
      + `| ${provenanceCell} `
      + `| ${shot.durationUs ? (shot.durationUs / 1_000_000).toFixed(1) : "-"} `
      + `| ${shortFingerprint(shot.ttsInputFingerprint)} `
      + `| ${shortFingerprint(shot.audio?.sha256)} `
      + `| ${mark(shot.checks.bindingSeal)} `
      + `| ${mark(shot.checks.audioPresent && shot.checks.audioSha256Match)} `
      + `| ${shot.provenance.verified ? "✓" : "-"} |`,
    );
  }
  lines.push("");

  if (ledger.sharedAudio.length > 0) {
    lines.push("## 章节共享音频");
    lines.push("");
    lines.push("| bindingId | 角色 | 封印 | 音频 | 路径 |");
    lines.push("|-----------|------|------|------|------|");
    for (const shared of ledger.sharedAudio) {
      lines.push(
        `| ${shared.bindingId} | ${shared.role} | ${mark(shared.bindingSeal)} `
        + `| ${mark(shared.audioPresent && shared.audioSha256Match)} | ${shared.relativePath ?? "-"} |`,
      );
    }
    lines.push("");
  }

  const problemShots = ledger.shots.filter((shot) =>
    !shot.checks.bindingSeal
    || !shot.checks.audioPresent
    || !shot.checks.audioSha256Match
    || (shot.storyboardRevisionAligned === false));
  if (problemShots.length > 0) {
    lines.push("## 异常明细");
    lines.push("");
    for (const shot of problemShots) {
      lines.push(`### ${shot.shotId}`);
      if (!shot.checks.bindingSeal) lines.push("- binding 封印不符(记录被改动或损坏)");
      if (!shot.checks.audioPresent) lines.push(`- 音频缺失:${shot.audio?.relativePath ?? "(binding 无路径)"}`);
      if (shot.checks.audioPresent && !shot.checks.audioSha256Match) {
        lines.push(`- 音频哈希不符:实际 \`${shortFingerprint(shot.audio?.sha256)}\` ≠ 封印值`);
      }
      if (shot.storyboardRevisionAligned === false) {
        lines.push(`- 分镜 revision 已前进(store 当前代与封印代不一致,重渲染前需重生成语音)`);
      }
      lines.push("");
    }
  }

  const unresolved = ledger.shots.filter((shot) => !shot.provenance.verified && shot.checks.bindingSeal);
  if (unresolved.length > 0) {
    lines.push("## 来源链未回溯明细(信息项,非事故)");
    lines.push("");
    for (const shot of unresolved) {
      lines.push(`- **${shot.shotId}**:${shot.provenance.hints.join(";")}`);
    }
    lines.push("");
  }

  lines.push("## 附录:指纹全文对照");
  lines.push("");
  lines.push("| 镜 | ttsInputFingerprint | bindingFingerprint | 音频 sha256 |");
  lines.push("|----|--------------------|--------------------|------------|");
  for (const shot of ledger.shots) {
    lines.push(
      `| ${shot.shotId} | ${shot.ttsInputFingerprint ?? "-"} | ${shot.bindingFingerprint ?? "-"} | ${shot.audio?.sha256 ?? "-"} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

// ────────────────────────────── CLI 装配 ──────────────────────────────

export function parseCliArgs(argv: readonly string[]): {
  projectDir?: string;
  chapter?: string;
  check: boolean;
} {
  const result: { projectDir?: string; chapter?: string; check: boolean } = { check: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--project") {
      result.projectDir = argv[i + 1];
      i += 1;
    } else if (arg === "--chapter") {
      result.chapter = argv[i + 1];
      i += 1;
    } else if (arg === "--check") {
      result.check = true;
    } else {
      throw new Error(`未知参数:${arg}(支持 --project <dir> / --chapter <id> / --check)`);
    }
  }
  return result;
}

/** 解析音色档案 referenceAudioPath 为磁盘绝对路径(asset-file/file/project-file/绝对路径) */
export function resolveReferenceAudioDiskPath(
  referenceAudioPath: string | undefined | null,
  context: { projectDir: string; assetsRoot: string },
): string | null {
  if (!referenceAudioPath) return null;
  if (referenceAudioPath.startsWith("asset-file://")) {
    try {
      return resolveManagedAssetFile(context.assetsRoot, referenceAudioPath);
    } catch {
      return null;
    }
  }
  if (referenceAudioPath.startsWith("file://")) {
    return decodeURIComponent(referenceAudioPath.replace(/^file:\/\//, ""));
  }
  if (referenceAudioPath.startsWith("project-file://")) {
    const rest = referenceAudioPath.replace(/^project-file:\/\//, "");
    const [projectId, ...restParts] = rest.split("/");
    if (!projectId || restParts.length === 0) return null;
    const relative = restParts.map((part) => decodeURIComponent(part)).join("/");
    return path.resolve(context.projectDir, relative);
  }
  if (path.isAbsolute(referenceAudioPath)) return referenceAudioPath;
  return null;
}

/** 预备音色档案候选(参考音频哈希缓存,按磁盘路径去重) */
export function prepareVoiceProfileCandidates(
  profiles: readonly VoiceProfile[],
  context: { projectDir: string; assetsRoot: string },
): VoiceProfileCandidate[] {
  const hashCache = new Map<string, string | null>();
  return profiles.map((profile) => {
    const diskPath = resolveReferenceAudioDiskPath(profile.referenceAudioPath, context);
    if (!diskPath) {
      return {
        profile,
        referenceAudioSha256: null,
        unresolvedReason: profile.referenceAudioPath ? "参考音频路径不可解析" : undefined,
      };
    }
    let sha256: string | null;
    if (hashCache.has(diskPath)) {
      sha256 = hashCache.get(diskPath) ?? null;
    } else {
      try {
        sha256 = sha256Buffer(fs.readFileSync(diskPath));
      } catch {
        sha256 = null;
      }
      hashCache.set(diskPath, sha256);
    }
    return {
      profile,
      referenceAudioSha256: sha256,
      unresolvedReason: sha256 ? undefined : "参考音频文件不可读",
    };
  });
}

function writeLedgerArtifact(projectRoot: string, ledger: TtsLedgerChapter): string {
  const dir = path.join(projectRoot, "remotion", "tts-ledger");
  fs.mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, `${ledger.chapter.chapterId}.json`);
  const mdPath = path.join(dir, `${ledger.chapter.chapterId}.md`);
  for (const [target, content] of [
    [jsonPath, `${JSON.stringify(ledger, null, 2)}\n`],
    [mdPath, renderTtsLedgerMarkdown(ledger)],
  ] as const) {
    const temp = `${target}.tmp-${process.pid}`;
    fs.writeFileSync(temp, content, "utf8");
    fs.renameSync(temp, target);
  }
  return jsonPath;
}

export async function runTtsLedgerExport(argv: readonly string[]): Promise<{
  ok: boolean;
  chapters: {
    chapterId: string;
    shotCount: number;
    allChecksPass: boolean;
    jsonPath: string | null;
    profileMatched: number;
    profileUnmatched: number;
  }[];
}> {
  const args = parseCliArgs(argv);
  const projectDir = args.projectDir ? path.resolve(args.projectDir) : resolveProjectDir();
  if (!fs.existsSync(projectDir)) throw new Error(`项目目录不存在:${projectDir}`);

  const snapshot = readStudioWorkflowStoreState(projectDir);
  const storyboards = snapshot && Array.isArray(snapshot.state.storyboards)
    ? (snapshot.state.storyboards as StoryboardItem[])
    : [];
  const storyboardsById = new Map(storyboards.map((item) => [item.id, item]));

  const ttsStorePath = path.join(projectDir, "store", "tts.json");
  const profiles: VoiceProfile[] = fs.existsSync(ttsStorePath)
    ? Object.values(
      ((JSON.parse(fs.readFileSync(ttsStorePath, "utf8")) as {
        state?: { voiceProfiles?: Record<string, VoiceProfile> };
      }).state?.voiceProfiles ?? {}),
    )
    : [];
  const assetsRoot = path.join(resolveStorageBasePath(), "assets");
  const profileCandidates = prepareVoiceProfileCandidates(profiles, { projectDir, assetsRoot });

  const chaptersDir = path.join(projectDir, "remotion", "chapters");
  const manifestFiles = fs.existsSync(chaptersDir)
    ? fs.readdirSync(chaptersDir)
      .filter((name) => /^chapter-.+\.json$/.test(name))
      .sort()
    : [];
  const selected = args.chapter
    ? manifestFiles.filter((name) => name === `${args.chapter}.json`)
    : manifestFiles;
  if (selected.length === 0) {
    throw new Error(`未找到章节 manifest(期望 ${args.chapter ?? "chapter-*.json"}):${chaptersDir}`);
  }

  const io: TtsLedgerIo = {
    readProjectBytes(relativePath) {
      try {
        return fs.readFileSync(path.join(projectDir, relativePath));
      } catch {
        return null;
      }
    },
    listProjectDir(relativePath) {
      try {
        return fs.readdirSync(path.join(projectDir, relativePath));
      } catch {
        return [];
      }
    },
  };

  const chapters: {
    chapterId: string;
    shotCount: number;
    allChecksPass: boolean;
    jsonPath: string | null;
    provenance: { ttsGenerated: number; voiceImport: number; unresolved: number };
  }[] = [];
  for (const manifestFile of selected) {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(chaptersDir, manifestFile), "utf8"),
    ) as Record<string, unknown>;
    const ledger = await buildChapterLedger({
      manifest,
      storyboardsById,
      profileCandidates,
      projectRoot: projectDir,
      io,
    });
    const jsonPath = args.check ? null : writeLedgerArtifact(projectDir, ledger);
    process.stderr.write(
      `[tts-ledger] ${ledger.chapter.chapterId}: shots=${ledger.chapter.shotCount} `
      + `seal=${ledger.summary.bindingSealPass}/${ledger.chapter.shotCount} `
      + `audio_fail=${ledger.summary.audioMissing + ledger.summary.audioSha256Mismatch} `
      + `provenance=tts:${ledger.summary.provenance.ttsGenerated}/import:${ledger.summary.provenance.voiceImport}/unresolved:${ledger.summary.provenance.unresolved} `
      + `orphans=${ledger.summary.orphanGenerations} `
      + `${args.check ? "(--check 未落盘)" : `→ ${jsonPath}`}\n`,
    );
    chapters.push({
      chapterId: ledger.chapter.chapterId,
      shotCount: ledger.chapter.shotCount,
      allChecksPass: ledger.summary.allChecksPass,
      jsonPath,
      provenance: ledger.summary.provenance,
    });
  }

  return { ok: chapters.every((c) => c.allChecksPass), chapters };
}

const isDirectExecution = process.env.MYSTUDIO_TTS_LEDGER_EXPORT === "1"
  || (process.argv[1]
    ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
    : false);
if (isDirectExecution) {
  void runTtsLedgerExport(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
  }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
