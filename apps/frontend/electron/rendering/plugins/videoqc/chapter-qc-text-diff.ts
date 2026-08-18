/**
 * 字幕文本 diff(L1 确定性子项):剧本真源 vs 逐 cue 文本。
 * 零 AI——确定性问题上 VLM 是浪费(08-19-chapter-video-qc 裁定)。
 */

import type { VideoUseSubtitleCueV1 } from "../../contracts/video-workflow";

/** 归一:去所有空白 + 常见中英标点(字幕排版差异不算错)。 */
export function normalizeScriptText(text: string): string {
  return text
    .replace(/[\s\u3000]+/g, "")
    .replace(/[，。！？；：、""''「」『』（）()【】《》<>…—\-~·,.!?;:'"]/g, "");
}

/** 有上限的编辑距离(长文本相似度用;超限按上限返回)。 */
function levenshteinWithin(a: string, b: string, cap: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      current[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > cap) return cap + 1;
    previous = current;
  }
  return previous[b.length];
}

export function similarityRatio(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  const longer = Math.max(a.length, b.length);
  if (longer === 0) return 1;
  const cap = Math.ceil(longer * 0.5);
  const distance = levenshteinWithin(a, b, cap);
  if (distance > cap) return 0;
  return 1 - distance / longer;
}

/** 在全文中为 cue 找最佳匹配窗口的相似度(滑窗+步进采样,控制计算量)。 */
function bestWindowSimilarity(cueText: string, fullText: string): number {
  if (fullText.length === 0 || cueText.length === 0) return 0;
  if (cueText.length >= fullText.length) return similarityRatio(cueText, fullText);
  let best = 0;
  const windowLength = cueText.length;
  const step = Math.max(1, Math.floor(windowLength / 8));
  for (let start = 0; start + windowLength <= fullText.length; start += step) {
    const score = similarityRatio(cueText, fullText.slice(start, start + windowLength));
    if (score > best) best = score;
    if (best >= 0.999) break;
  }
  return best;
}

export interface SubtitleDiffFinding {
  code: string;
  cueId?: string;
  shotId?: string;
  message: string;
  evidence: Record<string, unknown>;
}

export interface SubtitleDiffOptions {
  /** 单 cue 相似度阈值(低于即报错字/错句) */
  cueThreshold?: number;
  /** 剧本被 cue 覆盖的最低比例(低于报漏烧) */
  coverageThreshold?: number;
}

/**
 * 逐 cue 与剧本比对 + 整章覆盖率。返回 findings(空数组=全过)。
 * scriptText 缺失时返回 null(调用方按 skipped 处理)。
 */
export function diffSubtitlesAgainstScript(
  cues: VideoUseSubtitleCueV1[],
  scriptText: string | undefined,
  options: SubtitleDiffOptions = {},
): SubtitleDiffFinding[] | null {
  if (scriptText === undefined) return null;
  const cueThreshold = options.cueThreshold ?? 0.92;
  const coverageThreshold = options.coverageThreshold ?? 0.8;
  const fullText = normalizeScriptText(scriptText);
  const findings: SubtitleDiffFinding[] = [];

  const orderedCues = [...cues].sort((left, right) => left.startUs - right.startUs);
  let coveredChars = 0;
  for (const cue of orderedCues) {
    const normalizedCue = normalizeScriptText(cue.text);
    if (normalizedCue.length === 0) continue;
    if (fullText.includes(normalizedCue)) {
      coveredChars += normalizedCue.length;
      continue;
    }
    const score = bestWindowSimilarity(normalizedCue, fullText);
    if (score >= cueThreshold) {
      coveredChars += normalizedCue.length;
      continue;
    }
    findings.push({
      code: "chapter-qc.subtitle.text-mismatch",
      cueId: cue.cueId,
      shotId: cue.shotId,
      message: `字幕文本与剧本不符(相似度 ${(score * 100).toFixed(1)}%)`,
      evidence: { cueId: cue.cueId, cueText: cue.text, similarity: Number(score.toFixed(4)) },
    });
  }

  if (fullText.length > 0 && orderedCues.length > 0) {
    const coverage = coveredChars / fullText.length;
    if (coverage < coverageThreshold) {
      findings.push({
        code: "chapter-qc.subtitle.coverage-low",
        message: `字幕对剧本的文本覆盖率偏低(${(coverage * 100).toFixed(1)}%),疑似漏烧段落`,
        evidence: { coverage: Number(coverage.toFixed(4)), scriptChars: fullText.length, coveredChars },
      });
    }
  }
  return findings;
}
