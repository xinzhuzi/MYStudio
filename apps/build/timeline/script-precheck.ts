/**
 * W0 剧本检查门·副门（10-29 script-rootcure-clearance design §2.2）。
 *
 * Read-only script-line precheck over stage-7 shot inputs. Never repairs.
 * Failure must stop the pipeline（六步范式逐条对齐 ../remotion/final-audio-acceptance.ts：
 * ①单函数 export ②路径防撞/防别名 ③先落 inputs 快照再测量、失败先 persist
 * passed:false 回执再 rethrow ④三件套 evidence + inputsSha256 绑定 ⑤调用方独立
 * 重哈希对拍（run-full-pipeline.ts 内） ⑥回执并入 report.json）。
 *
 * 时点口径：渲染前、配音已发生——口径B（voice 实长）在本门有真数据
 * （audioPath 指向已绑定 wav，ffprobe 实测）；主门时点结构性缺失记 pending。
 *
 * 判定真源：四项纯算术判定复用前端单一真源 @/lib/studio/script-precheck
 * （跨域 import 先例=run-full-pipeline.ts 直接 import @/lib/studio 纯模块）；
 * 本门额外加「实词账」（勾销账的管线形态，对齐 W1 坑②「TTS 双源同步」）：
 * 逐镜 store 台词 vs r2 ttsSpokenText 归一字面一致——不一致 RED。
 *
 * RED 清单封闭（design §5.6）：语速>5.2 / 超帽 / 勾销·实词账<100% 三项；
 * OS 占比与语速黄带一律 YELLOW 落档不阻断；口径B 缺失=pending 不判不阻。
 */

import fs from "node:fs";
import path from "node:path";

import { sha256CanonicalJson } from "@/lib/studio/remotion/canonical-json";
import {
  normalizeLiteral,
  runScriptPrecheck,
  type ScriptPrecheckRowInput,
} from "@/lib/studio/script-precheck";
import type { ScriptVoiceLine } from "@/lib/studio/script-draft-metrics";
import { extractSpeech } from "@/lib/studio/storyboard-table";
import { probeRenderedMedia } from "../remotion/render-smoke-evidence";

/** 阶段 7 buildShotInputs 产物挑字段（run-full-pipeline.ts ShotSlotInfo）。 */
export interface ScriptPrecheckGateShot {
  shotId: string;
  /** 实念文本（r2 真源）——语速字数与实词账的 TTS 侧真源。 */
  ttsSpokenText: string;
  /** voice wav；文件缺失→口径B pending（禁止用估计值充数）。 */
  audioPath: string;
  audioSha256: string;
  textSha256: string;
  /** declared 镜时长（slot evidence 优先, r2 兜底——buildShotInputs 已合并）。 */
  durationUs: number;
  sourceSha256: string;
}

export interface ScriptPrecheckGateStoreStoryboard {
  id: string;
  episodeId: string;
  line?: string;
  lines?: string;
  ttsSpokenText?: string;
}

export interface ScriptPrecheckGateInput {
  /** evidence 落档目录（三件套写这里；design §6 未定谳①倾向 automationDir，与 input-manifest 同层）。 */
  automationDir: string;
  projectId: string;
  chapterId: string;
  shots: ScriptPrecheckGateShot[];
  /** readStudioWorkflowStoreState 里本章分镜（签名显式传入便于测试）。 */
  storeStoryboards: ScriptPrecheckGateStoreStoryboard[];
  /** strict=195 / 通用=180（调用方 isDaojieAdaptation 同式判定后传值）。 */
  durationCapSeconds: number;
  /** OS 转译豁免溯源域（strict 时传章 sourceText）。 */
  sourceText?: string;
  /** 剧本台词真源（extractScriptVoiceLines, 跨域 import 前端真源）。 */
  scriptVoiceLines: ScriptVoiceLine[];
  /** DI：音频实长探测，默认 probeRenderedMedia（ffprobe）——测试注入 mock。 */
  probe?: (filePath: string) => Promise<{ duration: number }>;
  /** DI：canonical JSON 哈希，测试注入。 */
  hashJson?: typeof sha256CanonicalJson;
}

export interface ScriptPrecheckGateReceipt {
  passed: boolean;
  inputsSha256: string;
  inputsPath: string;
  measurementPath: string;
  receiptPath: string;
  red: string[];
  yellow: string[];
  pendingCount: number;
}

/** inputsSha256 投影（④ + ⑤ 两端共用同一算式；调用方据此独立重哈希对拍）。 */
export function scriptPrecheckInputsProjection(shots: ScriptPrecheckGateShot[]): {
  shots: Array<{ shotId: string; textSha256: string; audioSha256: string }>;
  slots: Array<{ shotId: string; sourceSha256: string }>;
} {
  return {
    shots: shots.map((shot) => ({ shotId: shot.shotId, textSha256: shot.textSha256, audioSha256: shot.audioSha256 })),
    slots: shots.map((shot) => ({ shotId: shot.shotId, sourceSha256: shot.sourceSha256 })),
  };
}

/** store 行的说话人/类别标签前缀（「甲：」「旁白：」「OS(…)：」等）——行类别取 store line
 *  标签（design §2.2），字数取 ttsSpokenText；合成行=前缀+ttsSpokenText 让前端
 *  runScriptPrecheck 的类别判定与字数归一同时吃到正确真源。 */
const LINE_LABEL_RE = /^(?:旁白|OS|os|VO|V\.O\.|V\.S\.?)(?:[（(][^）)]*[）)])?\s*[：:]/;
const SPEAKER_LABEL_RE = /^[^：:{}[\]|#]{1,12}[：:]/;

function synthesizeRowLines(storeLine: string | undefined, ttsSpokenText: string): string {
  const raw = (storeLine ?? "").trim();
  if (!raw) return ttsSpokenText;
  const translationMatch = LINE_LABEL_RE.exec(raw);
  if (translationMatch) return `${translationMatch[0]}${ttsSpokenText}`;
  const speakerMatch = SPEAKER_LABEL_RE.exec(raw);
  if (speakerMatch) return `${speakerMatch[0]}${ttsSpokenText}`;
  return ttsSpokenText;
}

/** 逐镜测量记录（script-precheck-measurement.json 主体）。 */
interface ScriptPrecheckShotMeasurement {
  index: number;
  shotId: string;
  /** 本镜 declared 时长（秒）= durationUs/1e6。 */
  declaredSeconds: number;
  /** ttsSpokenText 归一字数（语速双口径共用分子）。 */
  chars: number;
  /** 口径A：chars / declaredSeconds。 */
  cpsA: number;
  /** 口径B：chars / wav 实长；null=pending（文件缺失或探测失败）。 */
  cpsB: number | null;
  audioPath: string;
  audioProbed: boolean;
  /** 实词账：store 台词（剥标签归一）vs ttsSpokenText（归一）。 */
  storeLine: string | null;
  verbatimMatch: boolean;
  storeNormalized: string;
  ttsNormalized: string;
}

export async function runScriptPrecheckGate(input: ScriptPrecheckGateInput): Promise<ScriptPrecheckGateReceipt> {
  const automationDir = path.resolve(input.automationDir);
  const inputsPath = path.join(automationDir, "script-precheck-inputs.json");
  const measurementPath = path.join(automationDir, "script-precheck-measurement.json");
  const receiptPath = path.join(automationDir, "script-precheck-acceptance.json");

  // ② Evidence destinations cannot alias the source wavs or one another.
  const destinations = [inputsPath, measurementPath, receiptPath];
  if (new Set(destinations).size !== 3) throw new Error("script-precheck-evidence-path-collision");
  const sourceAudioPaths = [...new Set(input.shots.map((shot) => path.resolve(shot.audioPath)))];
  const sourceStats = sourceAudioPaths
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => fs.lstatSync(filePath));
  const existingStats: fs.Stats[] = [];
  for (const destination of destinations) {
    if (!fs.existsSync(destination)) continue;
    const stat = fs.lstatSync(destination);
    if (stat.isSymbolicLink()
      || sourceStats.some((source) => source.dev === stat.dev && source.ino === stat.ino)
      || existingStats.some((existing) => existing.dev === stat.dev && existing.ino === stat.ino)) {
      throw new Error("script-precheck-evidence-path-alias");
    }
    existingStats.push(stat);
  }

  const hashJson = input.hashJson ?? sha256CanonicalJson;
  const probe = input.probe ?? (async (filePath: string) => probeRenderedMedia(filePath));
  const inputsSha256 = await hashJson(scriptPrecheckInputsProjection(input.shots));

  const persist = (filePath: string, value: unknown) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  };

  // ④-1 inputs 快照先落档（测量与回执都绑定它）。
  persist(inputsPath, {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    projectId: input.projectId,
    chapterId: input.chapterId,
    durationCapSeconds: input.durationCapSeconds,
    shots: input.shots.map((shot) => ({
      shotId: shot.shotId,
      ttsSpokenText: shot.ttsSpokenText,
      audioPath: shot.audioPath,
      audioSha256: shot.audioSha256,
      textSha256: shot.textSha256,
      durationUs: shot.durationUs,
      sourceSha256: shot.sourceSha256,
    })),
    storeStoryboards: input.storeStoryboards,
    scriptVoiceLines: input.scriptVoiceLines,
    ...(input.sourceText !== undefined ? { sourceText: input.sourceText } : {}),
    binding: { inputsSha256 },
  });

  const storeByShotId = new Map(input.storeStoryboards.map((item) => [item.id, item]));
  const measurements: ScriptPrecheckShotMeasurement[] = [];
  const rows: ScriptPrecheckRowInput[] = [];
  const verbatimRed: string[] = [];
  for (let position = 0; position < input.shots.length; position += 1) {
    const shot = input.shots[position]!;
    const index = position + 1;
    const storeEntry = storeByShotId.get(shot.shotId);
    const storeLine = (storeEntry?.lines ?? storeEntry?.line ?? "").trim() || null;
    // 实词账（勾销账的管线形态）：store 台词剥标签归一 vs ttsSpokenText 归一。
    const storeNormalized = storeLine === null ? "" : normalizeLiteral(extractSpeech(storeLine));
    const ttsNormalized = normalizeLiteral(shot.ttsSpokenText);
    const verbatimMatch = storeLine !== null && storeNormalized === ttsNormalized;
    if (!verbatimMatch) {
      verbatimRed.push(
        `镜${index}(${shot.shotId}) 实词账不一致：store「${storeLine ?? "(缺 store 台词)"}」vs TTS「${shot.ttsSpokenText}」`,
      );
    }
    // 口径B：wav 实长 ffprobe；文件缺失/探测失败→pending（不判不阻，不伪造）。
    let audioActualSeconds: number | undefined;
    let audioProbed = false;
    if (fs.existsSync(shot.audioPath)) {
      try {
        const probed = await probe(shot.audioPath);
        if (Number.isFinite(probed.duration) && probed.duration > 0) {
          audioActualSeconds = probed.duration;
          audioProbed = true;
        }
      } catch {
        audioActualSeconds = undefined; // 探测失败=pending，不阻断（design §5.7）
      }
    }
    const declaredSeconds = shot.durationUs / 1_000_000;
    const chars = ttsNormalized.length;
    measurements.push({
      index,
      shotId: shot.shotId,
      declaredSeconds,
      chars,
      cpsA: declaredSeconds > 0 ? chars / declaredSeconds : Number.POSITIVE_INFINITY,
      cpsB: audioActualSeconds !== undefined && audioActualSeconds > 0 ? chars / audioActualSeconds : null,
      audioPath: shot.audioPath,
      audioProbed,
      storeLine,
      verbatimMatch,
      storeNormalized,
      ttsNormalized,
    });
    rows.push({
      index,
      duration: declaredSeconds,
      lines: synthesizeRowLines(storeLine ?? undefined, shot.ttsSpokenText),
      ...(audioActualSeconds !== undefined ? { audioActualSeconds } : {}),
    });
  }

  // 复用前端 runScriptPrecheck 汇总分带（跨域 import 单一真源）。
  const precheck = runScriptPrecheck({
    rows,
    scriptVoiceLines: input.scriptVoiceLines,
    durationCapSeconds: input.durationCapSeconds,
    ...(input.sourceText !== undefined ? { sourceTextForExemption: input.sourceText } : {}),
  });
  const red = [...precheck.red, ...verbatimRed];
  const yellow = precheck.yellow;
  const pendingCount = precheck.pending.length;

  // ④-2 逐镜测量落档。
  persist(measurementPath, {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    projectId: input.projectId,
    chapterId: input.chapterId,
    inputsSha256,
    shots: measurements,
  });

  const baseReceipt = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    projectId: input.projectId,
    chapterId: input.chapterId,
    durationCapSeconds: input.durationCapSeconds,
    inputsSha256,
    inputsPath,
    measurementPath,
    totalSeconds: precheck.checks.durationCap.totalSeconds,
  };

  if (red.length > 0) {
    // ③ 失败先 persist passed:false 回执再 throw（镜像 final-audio-acceptance.ts:88-92）。
    persist(receiptPath, { ...baseReceipt, passed: false, red, yellow, pendingCount, summary: precheck.summary });
    throw new Error(`script-precheck-gate-failed: ${precheck.summary}${verbatimRed.length > 0 ? `；实词账 ${verbatimRed.length} 镜不一致` : ""}`);
  }

  const receipt: ScriptPrecheckGateReceipt = {
    passed: true,
    inputsSha256,
    inputsPath,
    measurementPath,
    receiptPath,
    red,
    yellow,
    pendingCount,
  };
  // ④-3 成功 persist passed:true 回执。
  persist(receiptPath, { ...baseReceipt, passed: true, red, yellow, pendingCount, summary: precheck.summary });
  return receipt;
}
