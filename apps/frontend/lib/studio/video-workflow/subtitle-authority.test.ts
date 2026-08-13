import { describe, expect, it } from "vitest";
import { normalizeSubtitleAuthority, resolveSubtitleAuthority } from "./subtitle-authority";

const evidence = (mode: "clean-remotion" | "source-embedded" | "hyperframes") => ({
  mode,
  decision: "human" as const,
  sourceFingerprint: "a".repeat(64),
  evidencePaths: ["/evidence/frame.png"],
  reviewedAt: 1,
});

const cue = (cueId = "cue-1") => ({ cueId, text: "你好", startUs: 0, durationUs: 1_000 });

describe("subtitle authority contract", () => {
  it("normalizes legacy data to blocking unknown", () => {
    expect(normalizeSubtitleAuthority(undefined).mode).toBe("unknown");
    const result = resolveSubtitleAuthority([{ intervalId: "shot-1", cues: [cue()] }]);
    expect(result.blocked).toBe(true);
    expect(result.issues[0]).toMatchObject({ code: "subtitle.authority.unknown", path: "visualIntervals[0].authority.mode" });
  });

  it("assigns one owner for clean, embedded, and hyperframes modes", () => {
    expect(resolveSubtitleAuthority([{ intervalId: "clean", authority: { mode: "clean-remotion", evidence: evidence("clean-remotion") }, cues: [cue()] }]).intervals[0]?.cues[0]?.owner).toBe("remotion-text");
    expect(resolveSubtitleAuthority([{ intervalId: "embedded", authority: { mode: "source-embedded", evidence: evidence("source-embedded") }, cues: [cue()] }]).intervals[0]?.cues[0]?.owner).toBe("source-media");
    const hyper = resolveSubtitleAuthority([{ intervalId: "fx", authority: { mode: "hyperframes", evidence: evidence("hyperframes") }, cues: [cue()] }]);
    expect(hyper.intervals[0]?.cues[0]?.owner).toBe("hyperframes-overlay");
    expect(hyper.subtitleMode).toBe("none");
  });

  it("derives burn-in only when a Remotion text owner exists in a mixed chapter", () => {
    const result = resolveSubtitleAuthority([
      { intervalId: "clean", authority: { mode: "clean-remotion", evidence: evidence("clean-remotion") }, cues: [cue("clean-cue")] },
      { intervalId: "embedded", authority: { mode: "source-embedded", evidence: evidence("source-embedded") }, cues: [cue("embedded-cue")] },
    ]);
    expect(result.subtitleMode).toBe("burn-in");
    expect(result.blocked).toBe(false);
  });

  it("rejects duplicate identities, missing identity, embedded overlay, and burned previews", () => {
    const result = resolveSubtitleAuthority([
      { intervalId: "embedded", authority: { mode: "source-embedded", evidence: evidence("source-embedded") }, cues: [cue()], overlayCueIds: ["cue-1"], previewSubtitlesBurnedIn: true },
      { intervalId: "other", authority: { mode: "clean-remotion", evidence: evidence("clean-remotion") }, cues: [cue()] },
      { intervalId: "missing", authority: { mode: "clean-remotion", evidence: evidence("clean-remotion") }, cues: [{ text: "x", startUs: 0, durationUs: 1 }] },
    ]);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "subtitle.authority.preview_burned_reuse",
      "subtitle.authority.text_overlay_duplicate",
      "subtitle.authority.duplicate_cue",
      "subtitle.authority.cue_identity_missing",
    ]));
    expect(result.blocked).toBe(true);
  });
});
