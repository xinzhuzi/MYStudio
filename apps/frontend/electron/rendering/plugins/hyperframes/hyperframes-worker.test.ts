import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { HyperFramesOverlayRequestV1 } from "@rendering/contracts/video-workflow";
import {
  buildHyperFramesCliArgs,
  buildHyperFramesCompositionHtml,
  buildHyperFramesWorkerTemporaryOutputPath,
  assertRenderedAlphaOutput,
  moveValidatedOutput,
  splitHyperFramesRenderSegments,
} from "./hyperframes-worker";

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

  it("drops --strict-all for registry-template compositions (upstream HTML trips strict lint)", () => {
    const registryRequest = { ...request, windows: [{ ...request.windows[0], templateId: "hy:world-map" }] };
    const args = buildHyperFramesCliArgs("/tmp/project", registryRequest);
    expect(args).not.toContain("--strict-all");
    expect(args).toContain("--quiet");
  });

  it("uses worker-owned temporary paths for every supported output format", () => {
    const temporaryMovPath = buildHyperFramesWorkerTemporaryOutputPath("/tmp/hyperframes-project", "prores-4444-mov");
    expect(temporaryMovPath)
      .toBe("/tmp/hyperframes-project/hyperframes-output.mov");
    expect(buildHyperFramesWorkerTemporaryOutputPath("/tmp/hyperframes-project", "webm-vp9-alpha"))
      .toBe("/tmp/hyperframes-project/hyperframes-output.webm");
    expect(buildHyperFramesWorkerTemporaryOutputPath("/tmp/hyperframes-project", "png-sequence"))
      .toBe("/tmp/hyperframes-project/hyperframes-output");
    expect(buildHyperFramesCliArgs("/tmp/hyperframes-project", request, temporaryMovPath)).toContain(temporaryMovPath);
    expect(buildHyperFramesCliArgs("/tmp/hyperframes-project", request, temporaryMovPath)).not.toContain(request.outputPath);
  });

  it("AC2: refuses a final output collision without moving or overwriting either file", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-hyperframes-collision-"));
    const temporaryPath = path.join(root, "temporary.mov");
    const outputPath = path.join(root, "existing.mov");
    fs.writeFileSync(temporaryPath, "temporary", "utf8");
    fs.writeFileSync(outputPath, "existing", "utf8");
    try {
      expect(() => moveValidatedOutput(temporaryPath, outputPath)).toThrow("拒绝覆盖");
      expect(fs.readFileSync(temporaryPath, "utf8")).toBe("temporary");
      expect(fs.readFileSync(outputPath, "utf8")).toBe("existing");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("AC2: atomically rejects a second publisher even when its preflight observation is stale", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-hyperframes-race-"));
    const firstTemporaryPath = path.join(root, "first.mov");
    const secondTemporaryPath = path.join(root, "second.mov");
    const outputPath = path.join(root, "published.mov");
    fs.writeFileSync(firstTemporaryPath, "first", "utf8");
    fs.writeFileSync(secondTemporaryPath, "second", "utf8");
    const exists = vi.spyOn(fs, "existsSync").mockReturnValue(false);
    try {
      moveValidatedOutput(firstTemporaryPath, outputPath);
      expect(() => moveValidatedOutput(secondTemporaryPath, outputPath)).toThrow("拒绝覆盖");
      expect(fs.readFileSync(outputPath, "utf8")).toBe("first");
      expect(fs.readFileSync(secondTemporaryPath, "utf8")).toBe("second");
    } finally {
      exists.mockRestore();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("AC3: validates PNG sequence frame count, dimensions, and alpha before publication", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-hyperframes-png-"));
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X2hAAAAAAElFTkSuQmCC",
      "base64",
    );
    const pngRequest = { ...request, width: 1, height: 1, alphaFormat: "png-sequence" as const };
    try {
      fs.writeFileSync(path.join(root, "frame-0001.png"), png);
      expect(() => assertRenderedAlphaOutput(root, pngRequest, 3_000_000 / pngRequest.fps))
        .toThrow("帧数异常");
      fs.writeFileSync(path.join(root, "frame-0002.png"), png);
      expect(() => assertRenderedAlphaOutput(root, pngRequest, 3_000_000 / pngRequest.fps))
        .not.toThrow();
      expect(() => assertRenderedAlphaOutput(root, { ...pngRequest, width: 2 }, 3_000_000 / pngRequest.fps))
        .toThrow("规格异常");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("08-18-hy-effects: renders every Phase-1 local template branch with its CSS class", () => {
    const local = ["ink-bloom","mist-drift","gold-flecks","brush-sweep","paper-breath","candle-flicker","moon-glow","rain-streaks","snow-drift","aura-pulse","sword-flash","seal-glow","dust-motes"];
    const localRequest = {
      ...request,
      windows: local.map((templateId, i) => ({
        slotId: `slot-${templateId}`,
        templateId,
        startUs: i * 1_000_000,
        durationUs: 1_000_000,
        parameters: {},
        alpha: { kind: "prores-4444-mov" as const },
      })),
    };
    const html = buildHyperFramesCompositionHtml(localRequest as unknown as Parameters<typeof buildHyperFramesCompositionHtml>[0]);
    for (const templateId of local) {
      expect(html).toContain(`hf-${templateId === "ink-bloom" ? "ink-bloom" : templateId}`);
    }
    expect(html).toContain(".hf-ink-bloom{");
    expect(html).toContain("@keyframes hf-sword-slash");
  });

  it("rejects templates that are not part of the MYStudio overlay contract", () => {
    expect(() => buildHyperFramesCompositionHtml({
      ...request,
      windows: [{ ...request.windows[0], templateId: "unknown-template" }],
    })).toThrow("不支持的 HyperFrames templateId");
  });

  it("splits a heavy overlay timeline on continuous frame boundaries without losing a crossing window", () => {
    const heavyRequest = {
      ...request,
      windows: Array.from({ length: 17 }, (_, index) => ({
        slotId: `slot-${index + 1}`,
        cueId: `cue-${index + 1}`,
        startUs: index * 1_000_000,
        durationUs: 1_000_000,
        templateId: "light-leak" as const,
        parameters: {},
      })),
    };
    heavyRequest.windows[0] = {
      ...heavyRequest.windows[0],
      durationUs: 9_000_000,
    };

    const segments = splitHyperFramesRenderSegments(heavyRequest);

    expect(segments).toHaveLength(3);
    expect(segments.map((segment) => [segment.startUs, segment.durationUs, segment.windows.length])).toEqual([
      [0, 8_000_000, 8],
      [8_000_000, 7_000_000, 8],
      [15_000_000, 2_000_000, 2],
    ]);
    expect(segments[1].windows.find((window) => window.slotId === "slot-1")).toMatchObject({
      startUs: 0,
      durationUs: 1_000_000,
    });
  });

  it("AC1: 跨段尾段窗口生成负 animation-delay，段内原生窗口不带相位偏移", () => {
    const heavy = {
      ...request,
      windows: Array.from({ length: 17 }, (_, index) => ({
        slotId: `slot-${index + 1}`,
        cueId: `cue-${index + 1}`,
        startUs: index * 1_000_000,
        durationUs: 1_000_000,
        templateId: "light-leak" as const,
        parameters: {},
      })),
    };
    heavy.windows[0] = { ...heavy.windows[0], durationUs: 9_000_000 };

    const segments = splitHyperFramesRenderSegments(heavy);
    const segment2 = segments[1];
    const html = buildHyperFramesCompositionHtml({ ...request, windows: segment2.windows }, segment2.durationUs);

    // slot-1 尾段：段起点 8s，原始起点 0s → 相位回退 8s
    expect(html).toContain("animation-delay:-8s;");
    // 段内原生窗口（slot-9 起）不得携带负相位；17 窗 3 段里第 2 段唯一跨段窗口是 slot-1
    expect(html.match(/animation-delay:-/g)).toHaveLength(1);
    // 跨段窗口时长被裁剪为 [8s,9s) 共 1s，与分段器输出一致
    expect(segment2.windows.find((window) => window.slotId === "slot-1")).toMatchObject({
      startUs: 0,
      durationUs: 1_000_000,
      animationOffsetUs: 8_000_000,
    });
  });

  it("AC1: 粒子 stagger 延迟扣除跨段偏移，保持全局动画相位", () => {
    const heavy: HyperFramesOverlayRequestV1 = {
      ...request,
      windows: Array.from({ length: 17 }, (_, index) => ({
        slotId: `slot-${index + 1}`,
        cueId: `cue-${index + 1}`,
        startUs: index * 1_000_000,
        durationUs: 1_000_000,
        templateId: "light-leak" as const,
        parameters: {},
      })),
    };
    heavy.windows[0] = {
      ...heavy.windows[0],
      durationUs: 9_000_000,
      templateId: "particle-dust",
      parameters: { count: 5, speed: 8 },
    };
    const segment2 = splitHyperFramesRenderSegments(heavy)[1];
    const html = buildHyperFramesCompositionHtml({ ...request, windows: segment2.windows }, segment2.durationUs);

    expect(html).toContain('class="hf-dust-particle" style="left:0%;top:0%;animation-delay:-8.0s;animation-duration:8s;"');
    expect(html).toContain('class="hf-dust-particle" style="left:37%;top:53%;animation-delay:-7.7s;animation-duration:8s;"');
  });

  it("AC2: 重叠窗口超过段上限且无合法切点时 fail closed", () => {
    const dense = {
      ...request,
      windows: Array.from({ length: 9 }, (_, index) => ({
        slotId: `dense-${index + 1}`,
        cueId: `dense-cue-${index + 1}`,
        startUs: index * 100_000,
        durationUs: 2_000_000,
        templateId: "light-leak" as const,
        parameters: {},
      })),
    };
    expect(() => splitHyperFramesRenderSegments(dense)).toThrow("切分");
  });
});
