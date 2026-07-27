import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { TimelineRenderPlan } from "@/types/editing";
import { createRemotionRendererAdapter } from "./remotion-renderer-adapter";

class FakeUtilityProcess {
  posted: unknown[] = [];
  private readonly messageListeners = new Set<(message: unknown) => void>();
  private readonly exitListeners = new Set<(code: number) => void>();

  on(event: "message", listener: (message: unknown) => void): this;
  on(event: "exit", listener: (code: number) => void): this;
  on(event: "message" | "exit", listener: ((message: unknown) => void) | ((code: number) => void)): this {
    (event === "message" ? this.messageListeners : this.exitListeners).add(listener as (value: unknown) => void);
    return this;
  }

  off(event: "message", listener: (message: unknown) => void): this;
  off(event: "exit", listener: (code: number) => void): this;
  off(event: "message" | "exit", listener: ((message: unknown) => void) | ((code: number) => void)): this {
    (event === "message" ? this.messageListeners : this.exitListeners).delete(listener as (value: unknown) => void);
    return this;
  }

  postMessage(message: unknown): void { this.posted.push(message); }
  kill(): boolean { return true; }
  reply(message: unknown): void { this.messageListeners.forEach((listener) => listener(message)); }
}

describe("createRemotionRendererAdapter", () => {
  it("forwards fixed runtime paths and quarantines forced-failure output", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-remotion-adapter-"));
    const bundlePath = path.join(root, "bundle");
    const child = new FakeUtilityProcess();
    let forkOptions: { cwd?: string; serviceName: string } | undefined;
    fs.mkdirSync(bundlePath, { recursive: true });
    fs.writeFileSync(path.join(bundlePath, "manifest.json"), JSON.stringify({
      schemaVersion: 1,
      remotionVersion: "4.0.499",
      compositionId: "DaojieTimeline",
      contentHash: "e".repeat(64),
    }), "utf8");
    const adapter = createRemotionRendererAdapter({
      renderRoot: path.join(root, "renders"),
      bundlePath,
      workerPath: "/app/remotion-render-worker.cjs",
      cwd: "/runtime/remotion-runtime",
      binariesDirectory: "/app/remotion-binaries",
      resolveSourcePath: (sourcePath) => sourcePath,
      probeBrowser: async () => ({
        status: { state: "ready", remotionVersion: "4.0.499" },
        executablePath: "/runtime/headless-shell",
      }),
      fork: (_modulePath, _args, options) => {
        forkOptions = options;
        return child;
      },
      remotionVersion: "4.0.499",
      emitProgress: () => undefined,
    });

    try {
      const renderPromise = adapter.render({
        jobId: "job-1",
        editingProjectSnapshot: {},
        clips: [],
      } as unknown as TimelineRenderPlan, {
        renderer: { requested: "remotion", actual: "remotion" },
      });
      await waitFor(() => child.posted.length === 1);
      const command = child.posted[0] as {
        requestId: string;
        input: { outputPath: string; binariesDirectory?: string };
      };
      expect(forkOptions).toEqual({
        cwd: "/runtime/remotion-runtime",
        serviceName: "MYStudio Remotion Render",
      });
      expect(command.input.binariesDirectory).toBe("/app/remotion-binaries");
      fs.writeFileSync(command.input.outputPath, "partial", "utf8");
      child.reply({
        kind: "result",
        requestId: command.requestId,
        result: { success: false, jobId: "job-1", canceled: true, error: "cancelled" },
      });

      await expect(renderPromise).resolves.toMatchObject({ success: false, canceled: true });
      expect(fs.existsSync(command.input.outputPath)).toBe(false);
      expect(fs.existsSync(command.input.outputPath.replace(/\.mp4$/, ".partial.mp4"))).toBe(true);
    } finally {
      await adapter.dispose();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("post-processes the raw Remotion MP4 and records final evidence", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-remotion-postprocess-"));
    const bundlePath = path.join(root, "bundle");
    const child = new FakeUtilityProcess();
    const progress: Array<{ stage: string; ratio: number }> = [];
    fs.mkdirSync(bundlePath, { recursive: true });
    fs.writeFileSync(path.join(bundlePath, "manifest.json"), JSON.stringify({
      schemaVersion: 1,
      remotionVersion: "4.0.499",
      compositionId: "DaojieTimeline",
      contentHash: "f".repeat(64),
    }), "utf8");
    const adapter = createRemotionRendererAdapter({
      renderRoot: path.join(root, "renders"),
      bundlePath,
      workerPath: "/app/remotion-render-worker.cjs",
      cwd: "/runtime/remotion-runtime",
      binariesDirectory: "/app/remotion-binaries",
      resolveSourcePath: (sourcePath) => sourcePath,
      probeBrowser: async () => ({
        status: { state: "ready", remotionVersion: "4.0.499" },
        executablePath: "/runtime/headless-shell",
      }),
      fork: () => child,
      remotionVersion: "4.0.499",
      emitProgress: (event) => progress.push(event),
      runAudioPostProcess: async (input) => {
        fs.writeFileSync(input.outputPath, "final", "utf8");
        fs.writeFileSync(input.logPath, "loudnorm ok", "utf8");
        return {
          engine: "ffmpeg",
          loudnessLufs: input.loudnessLufs,
          truePeakDbtp: input.truePeakDbtp,
          logPath: input.logPath,
        };
      },
      probeMedia: async () => ({
        raw: { format: { duration: "4" }, streams: [{ codec_type: "video" }, { codec_type: "audio" }] },
        duration: 4,
        width: 1080,
        height: 1920,
        streams: ["video", "audio"],
      }),
    });

    try {
      const renderPromise = adapter.render({
        jobId: "job-postprocess",
        renderSettings: { loudnessLufs: -14, truePeakDbtp: -1.5 },
        editingProjectSnapshot: {},
        clips: [],
      } as unknown as TimelineRenderPlan, {
        renderer: { requested: "remotion", actual: "remotion" },
      });
      await waitFor(() => child.posted.length === 1);
      const command = child.posted[0] as { requestId: string; input: { outputPath: string } };
      fs.mkdirSync(path.dirname(command.input.outputPath), { recursive: true });
      fs.writeFileSync(command.input.outputPath, "raw", "utf8");
      child.reply({
        kind: "result",
        requestId: command.requestId,
        result: { success: true, jobId: "job-postprocess", outputPath: command.input.outputPath, composition: {} },
      });

      await expect(renderPromise).resolves.toMatchObject({
        success: true,
        evidence: {
          path: expect.stringMatching(/output\.mp4$/),
          renderer: { requested: "remotion", actual: "remotion", version: "4.0.499", bundleVersion: "f".repeat(64) },
          audioPostProcess: { engine: "ffmpeg", loudnessLufs: -14, truePeakDbtp: -1.5 },
        },
      });
      expect(progress.at(-1)).toMatchObject({ stage: "completed", ratio: 1 });
    } finally {
      await adapter.dispose();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed out waiting for utility command");
}
