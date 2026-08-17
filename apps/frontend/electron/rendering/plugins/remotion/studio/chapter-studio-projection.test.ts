import { describe, expect, it } from "vitest";
import {
  CHAPTER_STUDIO_PROJECTION_SCHEMA_VERSION,
  generateChapterStudioProjection,
  parseChapterStudioProjection,
  type ChapterStudioProjectionInput,
} from "./chapter-studio-projection";

const capabilityUrl = (token: string, assetId: string): string =>
  `http://127.0.0.1:4200/${token.repeat(64)}/${assetId}`;

const input: ChapterStudioProjectionInput = {
  schemaVersion: CHAPTER_STUDIO_PROJECTION_SCHEMA_VERSION,
  projectId: "project-a",
  chapterId: "chapter-1",
  editingProjectId: "editing-1",
  editingRevision: 7,
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 84,
  clips: [
    {
      shotId: "shot-1",
      src: capabilityUrl("a", "shot-1"),
      durationInFrames: 30,
      trimBeforeFrames: 0,
      crop: { x: 0, y: 0, width: 1080, height: 1920 },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      volume: 1,
      subtitle: "第一镜",
      transitionAfter: { type: "fade", durationInFrames: 6 },
    },
    {
      shotId: "shot-2",
      src: capabilityUrl("b", "shot-2"),
      durationInFrames: 30,
      trimBeforeFrames: 2,
      crop: { x: 12, y: 18, width: 1050, height: 1880 },
      transform: { x: 4, y: -2, scaleX: 1.02, scaleY: 1.02, rotation: 0, opacity: 0.95 },
      volume: 0.8,
      subtitle: "第二镜",
      transitionAfter: { type: "cut", durationInFrames: 0 },
    },
    {
      shotId: "shot-3",
      src: capabilityUrl("c", "shot-3"),
      durationInFrames: 30,
      trimBeforeFrames: 0,
      crop: { x: 0, y: 0, width: 1080, height: 1920 },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      volume: 1,
      subtitle: "",
    },
  ],
};

describe("chapter Studio projection", () => {
  it("emits one explicit authored Sequence per dynamic shot without map-generated JSX", () => {
    const generated = generateChapterStudioProjection(input);
    expect(generated.source.match(/<Sequence name="shot:/g)).toHaveLength(3);
    expect(generated.source).not.toContain(".map(");
    expect(generated.source).not.toContain("TransitionSeries");
    expect(generated.source).not.toContain("@remotion/transitions");
    expect(generated.source).toContain("<Interactive.Div");
    expect(generated.source).toContain('durationInFrames={30}');
    expect(generated.source).toContain('from={24}');
    expect(generated.source).toContain('name="shot:shot-2"');
  });

  it("round-trips only the authored whitelist and keeps renderer metadata identical", () => {
    const generated = generateChapterStudioProjection(input);
    const parsed = parseChapterStudioProjection(generated.source);
    expect(parsed).toEqual({ success: true, value: input });
    expect(generated.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(generateChapterStudioProjection(input).sourceHash).toBe(generated.sourceHash);
    expect(generateChapterStudioProjection({ ...input, editingRevision: 8 }).sourceHash)
      .not.toBe(generated.sourceHash);
  });

  it("rejects unknown imports, JSX nodes, media references, and stale duration identity", () => {
    const generated = generateChapterStudioProjection(input);
    for (const mutation of [
      generated.source.replace(
        'Sequence, useCurrentFrame, Video } from "remotion";',
        'Sequence, useCurrentFrame, Video } from "remotion";\nimport danger from "./danger";',
      ),
      generated.source.replace(
        'useCurrentFrame, Video } from "remotion";',
        'useCurrentFrame, Video, danger } from "remotion";',
      ),
      generated.source.replace("<Interactive.Div", "<UnknownNode"),
      generated.source.replace("trimBefore={0}", "danger={0} trimBefore={0}"),
      generated.source.replace('overflow: "hidden"', 'danger: true, overflow: "hidden"'),
      generated.source.replace(
        "registerRoot(RemotionRoot);",
        "globalThis.__mystudioProbe = true;\nregisterRoot(RemotionRoot);",
      ),
      generated.source.replace(input.clips[0].src, capabilityUrl("f", "other-shot")),
      generated.source.replace("durationInFrames={84}", "durationInFrames={85}"),
    ]) {
      const parsed = parseChapterStudioProjection(mutation);
      expect(parsed.success).toBe(false);
    }
  });

  it("rejects extra media, nested timeline structure, and a stale session identity", () => {
    const generated = generateChapterStudioProjection(input);
    const extraVideo = generated.source.replace(
      '        </Interactive.Div>\n        <Interactive.Div name="subtitle:shot-1"',
      '        <Video name="media:extra" src="http://127.0.0.1:4200/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/extra" trimBefore={0} volume={1} />\n        </Interactive.Div>\n        <Interactive.Div name="subtitle:shot-1"',
    );
    expect(parseChapterStudioProjection(extraVideo).success).toBe(false);

    const nestedSequence = generated.source.replace(
      '      </Sequence>\n    </Sequence>',
      '        <Sequence name="nested" from={0} durationInFrames={1} layout="none" />\n      </Sequence>\n    </Sequence>',
    );
    expect(parseChapterStudioProjection(nestedSequence).success).toBe(false);

    const expectedIdentity = {
      projectId: input.projectId,
      chapterId: input.chapterId,
      editingProjectId: input.editingProjectId,
      editingRevision: input.editingRevision + 1,
      clips: input.clips.map(({ shotId, src }) => ({ shotId, src })),
    };
    const parsed = parseChapterStudioProjection(generated.source, expectedIdentity);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.issues.some((issue) => issue.path === "identity")).toBe(true);
  });

  it("rejects invalid timing before producing source", () => {
    expect(() => generateChapterStudioProjection({
      ...input,
      durationInFrames: 90,
    })).toThrow("durationInFrames");

    const clips = structuredClone(input.clips);
    clips[0].transitionAfter = { type: "fade", durationInFrames: 30 };
    expect(() => generateChapterStudioProjection({
      ...input,
      clips,
      durationInFrames: 60,
    })).toThrow("clips[0].transitionAfter");
  });

  it("rejects invalid numeric values after Studio source edits", () => {
    const generated = generateChapterStudioProjection(input);
    const parsed = parseChapterStudioProjection(
      generated.source
        .replace("width={1080}", "width={-1080}")
        .replace("volume={1}", "volume={-1}"),
    );
    expect(parsed.success).toBe(false);
  });
});
