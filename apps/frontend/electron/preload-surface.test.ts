import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const preloadSource = readFileSync(new URL("./preload.ts", import.meta.url), "utf8");

describe("preload IPC surface", () => {
  it("does not expose raw ipcRenderer send/invoke to the renderer", () => {
    expect(preloadSource).not.toContain("exposeInMainWorld('ipcRenderer'");
    expect(preloadSource).toContain("exposeInMainWorld('appEvents'");
  });

  it("passes update check options through the safe updater API", () => {
    expect(preloadSource).toContain("checkForUpdates: (options?: UpdateCheckOptions)");
    expect(preloadSource).toContain("ipcRenderer.invoke('app-updater-check', options)");
  });

  it("exposes diagnostics logging through a narrow safe API", () => {
    expect(preloadSource).toContain("exposeInMainWorld('diagnosticsLog'");
    expect(preloadSource).toContain("ipcRenderer.invoke('diagnostics-log-write', entry)");
    expect(preloadSource).toContain("ipcRenderer.invoke('diagnostics-log-query', query)");
    expect(preloadSource).toContain("ipcRenderer.invoke('diagnostics-log-get-info')");
    expect(preloadSource).toContain("ipcRenderer.invoke('diagnostics-log-export-bundle')");
    expect(preloadSource).toContain("ipcRenderer.invoke('diagnostics-log-clear')");
  });

  it("exposes image API requests through electronAPI without raw IPC", () => {
    expect(preloadSource).toContain("imageRequest: (payload: ImageRequestPayload): Promise<ImageRequestResult>");
    expect(preloadSource).toContain("ipcRenderer.invoke('api-image-request', payload)");
  });

  it("exposes a narrow image storage move API without raw IPC", () => {
    expect(preloadSource).toContain("moveImage: (localPath: string, category: string)");
    expect(preloadSource).toContain("ipcRenderer.invoke('move-image'");
  });

  it("exposes project-scoped binary file APIs without raw IPC", () => {
    expect(preloadSource).toContain("writeBinary: (payload:");
    expect(preloadSource).toContain("saveImage: (payload:");
    expect(preloadSource).toContain("readAsBase64: (url: string)");
    expect(preloadSource).toContain("getAbsolutePath: (url: string)");
    expect(preloadSource).toContain("ipcRenderer.invoke('project-file-write-binary', payload)");
    expect(preloadSource).toContain("ipcRenderer.invoke('project-file-save-image', payload)");
    expect(preloadSource).toContain("ipcRenderer.invoke('project-file-read-base64', url)");
    expect(preloadSource).toContain("ipcRenderer.invoke('project-file-get-absolute-path', url)");
  });

  it("exposes typed timeline render, cancellation and progress without raw execution fields", () => {
    expect(preloadSource).toContain("renderTimeline: (plan: TimelineRenderPlan): Promise<TimelineRenderResult>");
    expect(preloadSource).toContain("ipcRenderer.invoke('studio-timeline-render', plan)");
    expect(preloadSource).toContain("cancelTimelineRender: (jobId: string): Promise<TimelineRenderCancelResult>");
    expect(preloadSource).toContain("ipcRenderer.invoke('studio-timeline-render-cancel', jobId)");
    expect(preloadSource).toContain("ipcRenderer.on('studio-timeline-render-progress', wrapped)");
    expect(preloadSource).not.toContain("renderTimeline: (args:");
    expect(preloadSource).not.toContain("renderTimeline: (outputPath:");
    expect(preloadSource).not.toContain("renderTimeline: (filterGraph:");
  });
});
