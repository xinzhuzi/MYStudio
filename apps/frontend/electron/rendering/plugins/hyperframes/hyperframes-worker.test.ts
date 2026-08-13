import { describe, expect, it } from "vitest";
import { buildHyperFramesCliArgs, buildHyperFramesCompositionHtml } from "./hyperframes-worker";

const hash = "a".repeat(64);

const request = {
  schemaVersion: 1 as const,
  projectId: "project-1",
  chapterId: "chapter-1",
  revision: 2,
  sourceArtifactSha256: hash,
  inputSha256: hash,
  width: 1920,
  height: 1080,
  fps: 30,
  alphaFormat: "prores-4444-mov" as const,
  outputPath: "/tmp/overlay.mov",
  windows: [{
    slotId: "title",
    cueId: "cue-1",
    startUs: 0,
    durationUs: 1_000_000,
    templateId: "title-card",
    parameters: { text: "<章节标题>" },
  }],
};

describe("HyperFrames worker composition boundary", () => {
  it("builds a transparent, timed HTML composition without leaking raw HTML", () => {
    const html = buildHyperFramesCompositionHtml(request);
    expect(html).toContain('data-composition-id="mystudio-overlay"');
    expect(html).toContain('data-start="0"');
    expect(html).toContain('data-duration="1"');
    expect(html).toContain("&lt;章节标题&gt;");
    expect(html).not.toContain("<章节标题>");
    expect(html).toContain("background:transparent");
  });

  it("maps the contract alpha format to HyperFrames CLI format", () => {
    expect(buildHyperFramesCliArgs("/tmp/project", request)).toEqual([
      "render", "/tmp/project", "--format", "mov", "--output", "/tmp/overlay.mov",
      "--fps", "30", "--quiet", "--strict-all",
    ]);
  });

  it("rejects templates that are not part of the MYStudio overlay contract", () => {
    expect(() => buildHyperFramesCompositionHtml({
      ...request,
      windows: [{ ...request.windows[0], templateId: "unknown-template" }],
    })).toThrow("不支持的 HyperFrames templateId");
  });
});
