// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  REMOTION_RUNTIME_DOWNLOAD_CHANNEL,
  REMOTION_RUNTIME_DOWNLOAD_PROGRESS_EVENT,
  REMOTION_RUNTIME_STATUS_CHANNEL,
} from "@rendering/contracts/remotion-runtime-ipc";
import { REMOTION_WORKSPACE_RUNTIME_CHANNEL } from "@rendering/contracts/remotion-workspace-runtime";

type IpcHandler = (...args: unknown[]) => unknown;
type MessageListener = (message: unknown) => void;
type ExitListener = (code: number) => void;

const electronState = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  removed: [] as string[],
  children: [] as Array<{
    posted: unknown[];
    killed: boolean;
    reply: (message: unknown) => void;
  }>,
  sent: [] as Array<[string, unknown]>,
}));

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [
      {
        isDestroyed: () => false,
        webContents: {
          send: (channel: string, payload: unknown) => {
            electronState.sent.push([channel, payload]);
          },
        },
      },
      {
        isDestroyed: () => true,
        webContents: { send: vi.fn() },
      },
    ]),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      electronState.handlers.set(channel, handler);
    }),
    removeHandler: vi.fn((channel: string) => {
      electronState.removed.push(channel);
      electronState.handlers.delete(channel);
    }),
  },
  utilityProcess: {
    fork: vi.fn(() => {
      const messageListeners = new Set<MessageListener>();
      const exitListeners = new Set<ExitListener>();
      const child = {
        posted: [] as unknown[],
        killed: false,
        on(event: "message" | "exit", listener: MessageListener | ExitListener) {
          if (event === "message") messageListeners.add(listener as MessageListener);
          else exitListeners.add(listener as ExitListener);
          return child;
        },
        off(event: "message" | "exit", listener: MessageListener | ExitListener) {
          if (event === "message") messageListeners.delete(listener as MessageListener);
          else exitListeners.delete(listener as ExitListener);
          return child;
        },
        postMessage(message: unknown) {
          child.posted.push(message);
        },
        kill() {
          child.killed = true;
          return true;
        },
        reply(message: unknown) {
          messageListeners.forEach((listener) => listener(message));
        },
      };
      electronState.children.push(child);
      return child;
    }),
  },
}));

import { registerRemotionRuntimeIpcHandlers } from "./remotion-runtime-ipc";

beforeEach(() => {
  electronState.handlers.clear();
  electronState.removed.length = 0;
  electronState.children.length = 0;
  electronState.sent.length = 0;
});

function getHandler(channel: string): IpcHandler {
  const handler = electronState.handlers.get(channel);
  expect(handler).toBeDefined();
  return handler!;
}

function register(userDataDir: string, bundlePath?: string) {
  return registerRemotionRuntimeIpcHandlers({
    userDataDir,
    remotionVersion: "4.0.499",
    workerPath: "/app/remotion-browser-worker.cjs",
    bundlePath,
  });
}

describe("registerRemotionRuntimeIpcHandlers", () => {
  it("registers only the fixed channels and rejects caller-controlled fields", async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-remotion-ipc-"));
    const registration = register(userDataDir);

    expect([...electronState.handlers.keys()].sort()).toEqual([
      REMOTION_RUNTIME_DOWNLOAD_CHANNEL,
      REMOTION_RUNTIME_STATUS_CHANNEL,
    ].sort());
    await expect(getHandler(REMOTION_RUNTIME_STATUS_CHANNEL)({}, {
      executablePath: "/tmp/caller-chrome",
    })).rejects.toThrow("状态请求不接受任何字段");
    await expect(getHandler(REMOTION_RUNTIME_DOWNLOAD_CHANNEL)({}, {
      source: "mirror",
    })).rejects.toThrow("下载请求不接受任何字段");
    expect(electronState.children).toHaveLength(0);

    registration.dispose();
    expect(electronState.removed.sort()).toEqual([
      REMOTION_RUNTIME_DOWNLOAD_CHANNEL,
      REMOTION_RUNTIME_STATUS_CHANNEL,
    ].sort());
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  it("uses fresh workers, broadcasts validated progress, and disposes active work", async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-remotion-ipc-flow-"));
    const registration = register(userDataDir);

    const statusPromise = getHandler(REMOTION_RUNTIME_STATUS_CHANNEL)({}, undefined) as Promise<unknown>;
    const statusChild = electronState.children[0];
    const statusRequest = statusChild.posted[0] as { requestId: string };
    statusChild.reply({
      kind: "result",
      requestId: statusRequest.requestId,
      status: { state: "not-installed", remotionVersion: "4.0.499" },
    });
    await expect(statusPromise).resolves.toMatchObject({ state: "not-installed" });

    const downloadPromise = getHandler(REMOTION_RUNTIME_DOWNLOAD_CHANNEL)({}, {}) as Promise<unknown>;
    const downloadChild = electronState.children[1];
    const downloadRequest = downloadChild.posted[0] as { requestId: string };
    const starting = {
      phase: "starting",
      ratio: 0,
      remotionVersion: "4.0.499",
    };
    const progress = {
      phase: "downloading",
      ratio: 0.5,
      remotionVersion: "4.0.499",
    };
    const completed = {
      phase: "completed",
      ratio: 1,
      remotionVersion: "4.0.499",
    };
    downloadChild.reply({ kind: "progress", requestId: downloadRequest.requestId, progress: starting });
    downloadChild.reply({ kind: "progress", requestId: downloadRequest.requestId, progress });
    downloadChild.reply({ kind: "progress", requestId: downloadRequest.requestId, progress: completed });
    downloadChild.reply({
      kind: "result",
      requestId: downloadRequest.requestId,
      status: {
        state: "ready",
        remotionVersion: "4.0.499",
        preparedForRemotionVersion: "4.0.499",
      },
      executablePath: "/tmp/headless-shell",
    });
    await expect(downloadPromise).resolves.toMatchObject({ state: "ready" });

    expect(electronState.children).toHaveLength(2);
    expect(electronState.children.every((child) => child.killed)).toBe(true);
    expect(electronState.sent).toEqual([
      [REMOTION_RUNTIME_DOWNLOAD_PROGRESS_EVENT, starting],
      [REMOTION_RUNTIME_DOWNLOAD_PROGRESS_EVENT, progress],
      [REMOTION_RUNTIME_DOWNLOAD_PROGRESS_EVENT, completed],
    ]);

    const activeStatus = getHandler(REMOTION_RUNTIME_STATUS_CHANNEL)({}, {}) as Promise<unknown>;
    const activeChild = electronState.children[2];
    registration.dispose();
    expect(activeChild.killed).toBe(true);
    await expect(activeStatus).resolves.toMatchObject({
      state: "error",
      message: "Remotion 浏览器 utility process 已关闭",
    });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  it("exposes only validated fixed bundle metadata for workspace initialization", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-remotion-workspace-runtime-"));
    const bundle = path.join(root, "bundle");
    fs.mkdirSync(bundle, { recursive: true });
    fs.writeFileSync(path.join(bundle, "manifest.json"), JSON.stringify({
      schemaVersion: 2,
      templateId: "mystudio-remotion-v1",
      templateVersion: "1.0.0",
      remotionVersion: "4.0.499",
      compositionIds: ["StoryboardShot", "ChapterVideo", "DaojieTimeline"],
      compositionId: "DaojieTimeline",
      contentHash: "a".repeat(64),
    }), "utf8");
    const registration = register(root, bundle);
    try {
      const result = await getHandler(REMOTION_WORKSPACE_RUNTIME_CHANNEL)({}, {});
      expect(result).toEqual({
        schemaVersion: 1,
        templateId: "mystudio-remotion-v1",
        templateVersion: "1.0.0",
        remotionVersion: "4.0.499",
        bundleContentHash: "a".repeat(64),
        compositionIds: ["StoryboardShot", "ChapterVideo", "DaojieTimeline"],
      });
      await expect(getHandler(REMOTION_WORKSPACE_RUNTIME_CHANNEL)({}, { bundlePath: "/tmp/escape" }))
        .rejects.toThrow("状态请求不接受任何字段");
    } finally {
      registration.dispose();
      expect(electronState.removed).toContain(REMOTION_WORKSPACE_RUNTIME_CHANNEL);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
