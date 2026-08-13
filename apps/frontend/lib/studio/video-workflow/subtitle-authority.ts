import type {
  SubtitleAuthority,
  SubtitleAuthorityEvidence,
  SubtitleAuthorityMode,
  SubtitleCueOwner,
} from "@/types/editing";

export type SubtitleAuthorityIssueCode =
  | "subtitle.authority.unknown"
  | "subtitle.authority.evidence_missing"
  | "subtitle.authority.source_fingerprint_missing"
  | "subtitle.authority.evidence_path_missing"
  | "subtitle.authority.review_missing"
  | "subtitle.authority.cue_identity_missing"
  | "subtitle.authority.duplicate_cue"
  | "subtitle.authority.preview_burned_reuse"
  | "subtitle.authority.text_overlay_duplicate";

export interface SubtitleAuthorityIssue {
  code: SubtitleAuthorityIssueCode;
  path: string;
  message: string;
}

export interface SubtitleAuthorityCue {
  cueId?: string;
  text: string;
  startUs: number;
  durationUs: number;
}

export interface SubtitleAuthorityInterval {
  intervalId: string;
  authority?: SubtitleAuthority;
  cues?: readonly SubtitleAuthorityCue[];
  overlayCueIds?: readonly string[];
  previewSubtitlesBurnedIn?: boolean;
}

export interface ResolvedSubtitleCue extends SubtitleAuthorityCue {
  cueId: string;
  owner: SubtitleCueOwner;
  intervalId: string;
}

export interface ResolvedSubtitleAuthority {
  intervals: Array<{
    intervalId: string;
    mode: SubtitleAuthorityMode;
    cues: ResolvedSubtitleCue[];
  }>;
  subtitleMode: "burn-in" | "none";
  issues: SubtitleAuthorityIssue[];
  blocked: boolean;
}

export function normalizeSubtitleAuthority(value: unknown): SubtitleAuthority {
  if (!isRecord(value) || !isMode(value.mode)) {
    return { mode: "unknown", evidence: { mode: "unknown", decision: "legacy-unknown", sourceFingerprint: "", evidencePaths: [] } };
  }
  return { mode: value.mode, evidence: isEvidence(value.evidence) ? value.evidence : undefined };
}

export function validateSubtitleAuthority(value: unknown): SubtitleAuthorityIssue[] {
  const authority = normalizeSubtitleAuthority(value);
  const issues: SubtitleAuthorityIssue[] = [];
  validateAuthority(authority, "authority", issues);
  return issues;
}

export function resolveSubtitleAuthority(intervals: readonly SubtitleAuthorityInterval[]): ResolvedSubtitleAuthority {
  const issues: SubtitleAuthorityIssue[] = [];
  const resolved: ResolvedSubtitleAuthority["intervals"] = [];
  const seen = new Set<string>();
  let hasRemotionCue = false;

  intervals.forEach((interval, intervalIndex) => {
    const path = `visualIntervals[${intervalIndex}]`;
    const authority = normalizeSubtitleAuthority(interval.authority);
    const mode = authority.mode;
    validateAuthority(authority, `${path}.authority`, issues);
    if (interval.previewSubtitlesBurnedIn) {
      issues.push({ code: "subtitle.authority.preview_burned_reuse", path: `${path}.previewSubtitlesBurnedIn`, message: "带字幕 preview 不能作为正式视觉源复用" });
    }
    const overlayIds = new Set(interval.overlayCueIds ?? []);
    const cues: ResolvedSubtitleCue[] = [];
    (interval.cues ?? []).forEach((cue, cueIndex) => {
      const cuePath = `${path}.cues[${cueIndex}]`;
      if (!cue.cueId) {
        issues.push({ code: "subtitle.authority.cue_identity_missing", path: `${cuePath}.cueId`, message: "正式渲染需要稳定 cue identity" });
        return;
      }
      if (seen.has(cue.cueId)) {
        issues.push({ code: "subtitle.authority.duplicate_cue", path: `${cuePath}.cueId`, message: "cue identity 在多个视觉区间重复" });
      }
      seen.add(cue.cueId);
      const owner: SubtitleCueOwner = mode === "source-embedded"
        ? "source-media"
        : mode === "hyperframes" || overlayIds.has(cue.cueId)
          ? "hyperframes-overlay"
          : "remotion-text";
      if (mode === "source-embedded" && overlayIds.has(cue.cueId)) {
        issues.push({ code: "subtitle.authority.text_overlay_duplicate", path: `${cuePath}.cueId`, message: "source-embedded 禁止 HyperFrames overlay" });
      }
      if (owner === "remotion-text") hasRemotionCue = true;
      cues.push({ ...cue, cueId: cue.cueId, owner, intervalId: interval.intervalId });
    });
    resolved.push({ intervalId: interval.intervalId, mode, cues });
  });
  return { intervals: resolved, subtitleMode: hasRemotionCue ? "burn-in" : "none", issues, blocked: issues.length > 0 };
}

function validateAuthority(authority: SubtitleAuthority, path: string, issues: SubtitleAuthorityIssue[]) {
  if (authority.mode === "unknown") {
    issues.push({ code: "subtitle.authority.unknown", path: `${path}.mode`, message: "字幕归属未知，正式渲染被阻塞" });
    return;
  }
  const evidence = authority.evidence;
  if (!evidence) {
    issues.push({ code: "subtitle.authority.evidence_missing", path: `${path}.evidence`, message: "字幕归属缺少证据" });
    return;
  }
  if (!/^[a-f0-9]{64}$/.test(evidence.sourceFingerprint)) issues.push({ code: "subtitle.authority.source_fingerprint_missing", path: `${path}.evidence.sourceFingerprint`, message: "缺少有效源媒体 SHA-256" });
  if (evidence.evidencePaths.length === 0) issues.push({ code: "subtitle.authority.evidence_path_missing", path: `${path}.evidence.evidencePaths`, message: "缺少批准证据路径" });
  if (authority.mode === "source-embedded" && (evidence.decision === "legacy-unknown" || !evidence.reviewedAt)) {
    issues.push({ code: "subtitle.authority.review_missing", path: `${path}.evidence.reviewedAt`, message: "source-embedded 必须具备审核时间" });
  }
}

function isMode(value: unknown): value is SubtitleAuthorityMode {
  return value === "clean-remotion" || value === "source-embedded" || value === "hyperframes" || value === "unknown";
}

function isEvidence(value: unknown): value is SubtitleAuthorityEvidence {
  return isRecord(value) && isMode(value.mode) && typeof value.sourceFingerprint === "string" && Array.isArray(value.evidencePaths)
    && value.evidencePaths.every((entry) => typeof entry === "string")
    && (value.evidenceSha256 === undefined || (isRecord(value.evidenceSha256) && Object.values(value.evidenceSha256).every((entry) => typeof entry === "string")))
    && (value.decision === "human" || value.decision === "imported-manifest" || value.decision === "legacy-unknown");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
