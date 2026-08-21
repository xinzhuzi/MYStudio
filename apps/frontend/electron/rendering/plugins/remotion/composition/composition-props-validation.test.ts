import { describe, expect, it } from "vitest";
import {
  validateChapterVideoCompositionProps,
  validateCompositionProps,
  validateStoryboardShotCompositionProps,
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

  it("accepts a whitelisted gl: transition (registry 闭集放行)", () => {
    const props = validProps();
    (props.transitions[0] as { effectId: string }).effectId = "gl:Directional";
    const result = validateCompositionProps(props);
    expect(result.success).toBe(true);
  });

  it("accepts an in-registry grade and rejects unknown lutId / out-of-range blend (fail-closed)", () => {
    const good = validProps();
    good.visualClips[0].grade = { lutId: "film-teal-orange", lutSrc: "http://127.0.0.1:1/tok/l.png", blend: 0.8 };
    expect(validateCompositionProps(good).success).toBe(true);

    const badLut = validProps();
    badLut.visualClips[0].grade = { lutId: "film-not-exist", lutSrc: "http://127.0.0.1:1/tok/l.png", blend: 0.8 };
    const r1 = validateCompositionProps(badLut);
    expect(r1.success).toBe(false);
    if (!r1.success) expect(r1.issues.some((i) => i.path === "visualClips[0].grade.lutId")).toBe(true);

    const badBlend = validProps();
    badBlend.visualClips[0].grade = { lutId: "film-teal-orange", lutSrc: "http://127.0.0.1:1/tok/l.png", blend: 1.5 };
    const r2 = validateCompositionProps(badBlend);
    expect(r2.success).toBe(false);
    if (!r2.success) expect(r2.issues.some((i) => i.path === "visualClips[0].grade.blend")).toBe(true);
  });

  it("rejects a gl: transition outside the registry (fail-closed)", () => {
    const props = validProps();
    (props.transitions[0] as { effectId: string }).effectId = "gl:NotInRegistry";
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

  it("accepts contain and rejects an unknown visual fit", () => {
    const props = validProps();
    props.visualClips[0].fit = "contain";
    expect(validateCompositionProps(props).success).toBe(true);

    (props.visualClips[0] as { fit: string }).fit = "stretch";
    const result = validateCompositionProps(props);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toContainEqual({
        path: "visualClips[0].fit",
        message: "visualClips[0].fit 必须是 cover / contain 之一",
      });
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

  it("accepts panZoom easing cubic/spring and rejects anything else（08-21 spring 接入）", () => {
    const cubic = validProps();
    cubic.visualClips[0].panZoom = { fromScale: 1, toScale: 1.1, originX: 0.5, originY: 0.5, easing: "cubic" };
    expect(validateCompositionProps(cubic).success).toBe(true);

    const spring = validProps();
    spring.visualClips[0].panZoom = { fromScale: 1, toScale: 1.1, originX: 0.5, originY: 0.5, easing: "spring" };
    expect(validateCompositionProps(spring).success).toBe(true);

    const bogus = validProps();
    bogus.visualClips[0].panZoom = { fromScale: 1, toScale: 1.1, originX: 0.5, originY: 0.5, easing: "bounce" as never };
    const result = validateCompositionProps(bogus);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.some((issue) => issue.path === "visualClips[0].panZoom.easing")).toBe(true);
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

  it("validates HyperFrames overlay capability URLs and frame ranges", () => {
    const props = {
      ...validProps(),
      overlayClips: [{
        clipId: "hyperframes-overlay",
        src: `http://127.0.0.1:1/${"a".repeat(64)}/overlay`,
        from: 0,
        durationInFrames: 30,
      }],
    };
    expect(validateCompositionProps(props).success).toBe(true);
    props.overlayClips[0]!.src = "https://example.com/overlay.mov";
    const invalid = validateCompositionProps(props);
    expect(invalid.success).toBe(false);
    if (!invalid.success) expect(invalid.issues.some((issue) => issue.path === "overlayClips[0].src")).toBe(true);
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

  it("rejects chapter roles in StoryboardShot and shot roles in ChapterVideo", () => {
    const shot = {
      ...validProps(),
      target: "shot" as const,
      projectId: "project-a",
      chapterId: "chapter-001",
      shotId: "shot-001",
      shotRevision: 1,
      visualClips: [validProps().visualClips[0]],
      audioClips: [{
        ...validProps().audioClips[0],
        kind: "bgm" as const,
        renderScope: "shot" as const,
      }],
    };
    const chapter = {
      ...validProps(),
      target: "chapter" as const,
      projectId: "project-a",
      chapterId: "chapter-001",
      editingProjectId: "editing-001",
      editingRevision: 1,
      visualClips: [{ ...validProps().visualClips[0], kind: "video" as const }],
      audioClips: [{
        ...validProps().audioClips[0],
        kind: "voice" as const,
        renderScope: "chapter" as const,
      }],
    };

    const shotResult = validateStoryboardShotCompositionProps(shot);
    const chapterResult = validateChapterVideoCompositionProps(chapter);
    expect(shotResult.success).toBe(false);
    expect(chapterResult.success).toBe(false);
    if (!shotResult.success) {
      expect(shotResult.issues.some((issue) => issue.path === "audioClips[0].kind")).toBe(true);
    }
    if (!chapterResult.success) {
      expect(chapterResult.issues.some((issue) => issue.path === "audioClips[0].kind")).toBe(true);
    }
  });
});

describe("layerStack 校验(08-19 multilayer Child1)", () => {
  const token = "a".repeat(64);
  const layerUrl = (name: string) => `http://127.0.0.1:1/${token}/${name}`;

  it("接受合法四层(背景/主体/前景/氛围模板)", () => {
    const props = validProps();
    props.visualClips[0].layerStack = [
      { role: "background", src: layerUrl("bg") },
      { role: "subject", src: layerUrl("subj"), panZoomDamp: 1, ambient: { type: "float", ampX: 0.004, ampY: 0.008, ampScale: 0.008, ampRot: 0, freq: 0.25, phase: 0 } },
      { role: "foreground", src: layerUrl("fg"), panZoomDamp: 1.15, blendMode: "screen", opacity: 0.4, drift: { speedX: 1.5 } },
      { role: "atmosphere", template: { id: "atmo:light-dust", params: { count: 48 } } },
    ];
    expect(validateCompositionProps(props).success).toBe(true);
  });

  it("拒绝非法 role/blendMode(闭集 fail-closed)", () => {
    const props = validProps();
    props.visualClips[0].layerStack = [{ role: "midground" as never, src: layerUrl("x") }];
    const result = validateCompositionProps(props);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.some((i) => i.path === "visualClips[0].layerStack[0].role")).toBe(true);
    }

    const blend = validProps();
    blend.visualClips[0].layerStack = [{ role: "foreground", src: layerUrl("x"), blendMode: "luminosity" as never }];
    const blendResult = validateCompositionProps(blend);
    expect(blendResult.success).toBe(false);
    if (!blendResult.success) {
      expect(blendResult.issues.some((i) => i.path === "visualClips[0].layerStack[0].blendMode")).toBe(true);
    }
  });

  it("layerStack 与旧 layers 二元组互斥", () => {
    const props = validProps();
    props.visualClips[0].layers = { backgroundSrc: layerUrl("bg"), subjectSrc: layerUrl("subj") };
    props.visualClips[0].layerStack = [{ role: "background", src: layerUrl("bg") }];
    const result = validateCompositionProps(props);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.some((i) => i.message.includes("互斥"))).toBe(true);
    }
  });

  it("拒绝越界 opacity/panZoomDamp 与非 capability src", () => {
    const props = validProps();
    props.visualClips[0].layerStack = [
      { role: "background", src: "file:///tmp/bg.png", opacity: 1.5, panZoomDamp: 3 },
    ];
    const result = validateCompositionProps(props);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.issues.map((i) => i.path);
      expect(paths).toContain("visualClips[0].layerStack[0].src");
      expect(paths).toContain("visualClips[0].layerStack[0].opacity");
      expect(paths).toContain("visualClips[0].layerStack[0].panZoomDamp");
    }
  });

  it("src 与 template 同时缺省=无效层", () => {
    const props = validProps();
    props.visualClips[0].layerStack = [{ role: "atmosphere" }];
    const result = validateCompositionProps(props);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.some((i) => i.message.includes("不得同时缺省"))).toBe(true);
    }
  });

  it("clip 级 ambient 非法类型 fail-closed(旧=静默丢弃)", () => {
    const props = validProps();
    props.visualClips[0].ambient = { type: "wobble" as never, ampX: 0.01, ampY: 0.01, ampScale: 0.01, ampRot: 0.1, freq: 0.3, phase: 0 };
    const result = validateCompositionProps(props);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.some((i) => i.path === "visualClips[0].ambient.type")).toBe(true);
    }
  });

  it("合法 clip 级 ambient 通过", () => {
    const props = validProps();
    props.visualClips[0].ambient = { type: "breathe", ampX: 0, ampY: 0.01, ampScale: 0.008, ampRot: 0, freq: 0.3, phase: 0.5 };
    expect(validateCompositionProps(props).success).toBe(true);
  });
});
