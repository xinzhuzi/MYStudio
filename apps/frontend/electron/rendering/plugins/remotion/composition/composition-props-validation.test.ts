import { describe, expect, it } from "vitest";
import {
  validateChapterVideoCompositionProps,
  validateCompositionProps,
} from "./composition-props-validation";
import type { CompositionProps } from "./composition-props";

function validProps(): CompositionProps {
  const token = "a".repeat(64);
  return {
    width: 1920,
    height: 1080,
    fps: 30,
    durationInFrames: 90,
    visualClips: [
      {
        clipId: "a",
        kind: "image",
        src: `http://127.0.0.1:1/${token}/a`,
        from: 0,
        durationInFrames: 30,
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      },
      {
        clipId: "b",
        kind: "image",
        src: `http://127.0.0.1:1/${token}/b`,
        from: 24,
        durationInFrames: 30,
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      },
    ],
    transitions: [
      { fromClipId: "a", toClipId: "b", effectId: "fade", overlapFrames: 6 },
    ],
    audioClips: [
      {
        clipId: "v1",
        kind: "voice",
        src: `http://127.0.0.1:1/${token}/v1`,
        from: 0,
        durationInFrames: 60,
        volume: 1,
      },
    ],
    subtitles: [
      { cueId: "c1", text: "你好", from: 0, durationInFrames: 30 },
    ],
  };
}

describe("validateCompositionProps", () => {
  it("accepts a fully valid props object", () => {
    const result = validateCompositionProps(validProps());
    expect(result.success).toBe(true);
  });

  it("rejects a non-object payload", () => {
    const result = validateCompositionProps(null);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues[0].path).toBe("$");
    }
  });

  it("rejects non-positive dimensions and fps", () => {
    const props = { ...validProps(), width: 0, fps: -1 };
    const result = validateCompositionProps(props);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.issues.map((issue) => issue.path);
      expect(paths).toContain("width");
      expect(paths).toContain("fps");
    }
  });

  it("rejects an unknown transition effect", () => {
    const props = validProps();
    (props.transitions[0] as { effectId: string }).effectId = "slide";
    const result = validateCompositionProps(props);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.some((i) => i.path === "transitions[0].effectId")).toBe(true);
    }
  });

  it("rejects transition timing that disagrees with the visual overlap", () => {
    const props = validProps();
    props.visualClips[1].from = 30;
    const result = validateCompositionProps(props);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toContainEqual({
        path: "transitions[0].overlapFrames",
        message: "转场重叠与片段时序不一致",
      });
    }
  });

  it("rejects a visual clip missing its capability src", () => {
    const props = validProps();
    (props.visualClips[0] as { src: string }).src = "   ";
    const result = validateCompositionProps(props);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.some((i) => i.path === "visualClips[0].src")).toBe(true);
    }
  });

  it("rejects a URL that is not a media-bridge capability", () => {
    const props = validProps();
    props.visualClips[0].src = "https://example.com/a.png";
    const result = validateCompositionProps(props);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toContainEqual({
        path: "visualClips[0].src",
        message: "src 必须是 127.0.0.1 的 HTTP capability URL",
      });
    }
  });

  it("rejects a fractional frame count", () => {
    const props = validProps();
    (props.visualClips[0] as { from: number }).from = 1.5;
    const result = validateCompositionProps(props);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.some((i) => i.path === "visualClips[0].from")).toBe(true);
    }
  });

  it("rejects negative audio volume", () => {
    const props = validProps();
    (props.audioClips[0] as { volume: number }).volume = -0.5;
    const result = validateCompositionProps(props);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.some((i) => i.path === "audioClips[0].volume")).toBe(true);
    }
  });

  it("rejects invalid nested fade, envelope and panZoom controls", () => {
    const props = validProps();
    props.visualClips[0].panZoom = {
      fromScale: 0,
      toScale: 1,
      originX: 2,
      originY: 0.5,
    };
    props.audioClips[0].fade = { fadeInFrames: 61, fadeOutFrames: 0 };
    props.audioClips[0].envelope = [{ frame: 70, gain: -1 }];
    const result = validateCompositionProps(props);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
        "visualClips[0].panZoom.fromScale",
        "visualClips[0].panZoom.originX",
        "audioClips[0].fade.fadeInFrames",
        "audioClips[0].envelope[0].frame",
        "audioClips[0].envelope[0].gain",
      ]));
    }
  });

  it("rejects a non-array collection", () => {
    const props = { ...validProps(), visualClips: "nope" };
    const result = validateCompositionProps(props);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.some((i) => i.path === "visualClips")).toBe(true);
    }
  });

  it("rejects media and subtitles that exceed the composition duration", () => {
    const props = validProps();
    props.audioClips[0].from = 60;
    props.audioClips[0].durationInFrames = 60;
    props.subtitles[0].from = 80;
    props.subtitles[0].durationInFrames = 20;
    const result = validateCompositionProps(props);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
        "audioClips[0].durationInFrames",
        "subtitles[0].durationInFrames",
      ]));
    }
  });

  it("rejects an empty ChapterVideo visual input", () => {
    const props = {
      ...validProps(),
      target: "chapter" as const,
      projectId: "project-a",
      chapterId: "chapter-001",
      editingProjectId: "editing-001",
      editingRevision: 1,
      visualClips: [],
    };
    const result = validateChapterVideoCompositionProps(props);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.some((issue) => issue.path === "visualClips")).toBe(true);
  });

  it("rejects zero target revisions", () => {
    const props = {
      ...validProps(),
      target: "chapter" as const,
      projectId: "project-a",
      chapterId: "chapter-001",
      editingProjectId: "editing-001",
      editingRevision: 0,
    };
    const result = validateChapterVideoCompositionProps(props);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.some((issue) => issue.path === "editingRevision")).toBe(true);
  });
});
