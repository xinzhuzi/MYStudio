import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createPreparedVersionFileStore,
  createRemotionBrowserWorkerService,
  type RemotionEnsureBrowser,
} from "./remotion-browser-worker-service";
import type { RemotionBrowserWorkerEvent } from "./remotion-browser-worker-protocol";

const VERSION = "4.0.499";
const EXECUTABLE = "/runtime/headless-shell";

function command(action: "status" | "download") {
  return { schemaVersion: 1, requestId: `request-${action}`, action, remotionVersion: VERSION };
}

describe("createPreparedVersionFileStore", () => {
  it("persists only the prepared Remotion version inside the runtime directory", () => {
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-remotion-state-"));
    const store = createPreparedVersionFileStore(runtimeDir);
    expect(store.read()).toBeUndefined();
    store.write(VERSION);
    expect(store.read()).toBe(VERSION);
    expect(JSON.parse(fs.readFileSync(path.join(runtimeDir, "browser-state.json"), "utf8"))).toEqual({
      schemaVersion: 1,
      preparedForRemotionVersion: VERSION,
    });
  });
});

describe("Remotion browser worker service", () => {
  it("uses the public download callback as a no-download status sentinel", async () => {
    const ensureBrowser: RemotionEnsureBrowser = vi.fn(async (options) => {
      options.onBrowserDownload({ chromeMode: "headless-shell" });
      return { type: "no-browser" as const };
    });
    const events: RemotionBrowserWorkerEvent[] = [];
    const service = createRemotionBrowserWorkerService({
      ensureBrowser,
      store: { read: () => undefined, write: vi.fn() },
    });

    const terminal = await service.handle(command("status"), (event) => events.push(event));

    expect(terminal).toMatchObject({ kind: "result", status: { state: "not-installed" } });
    expect(events).toHaveLength(1);
  });

  it("downloads only Headless Shell with version null and validated progress", async () => {
    const versions: Array<string | null> = [];
    const ensureBrowser: RemotionEnsureBrowser = vi.fn(async (options) => {
      const callback = options.onBrowserDownload({ chromeMode: "headless-shell" });
      versions.push(callback.version);
      callback.onProgress({ alreadyAvailable: false, percent: 0.5, downloadedBytes: 5, totalSizeInBytes: 10 });
      callback.onProgress({ alreadyAvailable: false, percent: 1, downloadedBytes: 10, totalSizeInBytes: 10 });
      return { type: "local-puppeteer-browser" as const, path: EXECUTABLE };
    });
    const write = vi.fn();
    const events: RemotionBrowserWorkerEvent[] = [];
    const service = createRemotionBrowserWorkerService({
      ensureBrowser,
      store: { read: () => undefined, write },
    });

    const terminal = await service.handle(command("download"), (event) => events.push(event));

    expect(versions).toEqual([null]);
    expect(write).toHaveBeenCalledWith(VERSION);
    expect(events.filter((event) => event.kind === "progress").map((event) => event.kind === "progress" && event.progress.phase)).toEqual([
      "starting", "downloading", "downloading", "completed",
    ]);
    expect(terminal).toMatchObject({ kind: "result", executablePath: EXECUTABLE, status: { state: "ready" } });
  });

  it("fails closed on malformed progress without recording a prepared version", async () => {
    const ensureBrowser: RemotionEnsureBrowser = vi.fn(async (options) => {
      const callback = options.onBrowserDownload({ chromeMode: "headless-shell" });
      callback.onProgress({ alreadyAvailable: false, percent: Number.NaN, downloadedBytes: 0, totalSizeInBytes: 1 });
      return { type: "local-puppeteer-browser" as const, path: EXECUTABLE };
    });
    const write = vi.fn();
    const events: RemotionBrowserWorkerEvent[] = [];
    const service = createRemotionBrowserWorkerService({
      ensureBrowser,
      store: { read: () => undefined, write },
    });

    const terminal = await service.handle(command("download"), (event) => events.push(event));

    expect(terminal.kind).toBe("error");
    expect(write).not.toHaveBeenCalled();
    expect(events.some((event) => event.kind === "progress" && event.progress.phase === "failed")).toBe(true);
  });

  it("rejects unknown worker command fields before ensureBrowser runs", async () => {
    const ensureBrowser: RemotionEnsureBrowser = vi.fn();
    const service = createRemotionBrowserWorkerService({
      ensureBrowser,
      store: { read: () => undefined, write: vi.fn() },
    });
    const terminal = await service.handle({ ...command("download"), source: "mirror" }, () => {});
    expect(terminal.kind).toBe("error");
    expect(ensureBrowser).not.toHaveBeenCalled();
  });
});
