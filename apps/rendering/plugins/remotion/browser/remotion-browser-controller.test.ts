import { describe, expect, it, vi } from "vitest";
import {
  BROWSER_DOWNLOAD_ABORT,
  RemotionBrowserController,
  type PreparedVersionStore,
  type RemotionBrowserDownloadAdapter,
  type RemotionBrowserProbeAdapter,
} from "./remotion-browser-controller";

const VERSION = "4.0.499";

function memoryStore(initial?: string): PreparedVersionStore & { value?: string } {
  return {
    value: initial,
    read() {
      return this.value;
    },
    write(version: string) {
      this.value = version;
    },
  };
}

// Probe whose ensureBrowser triggers onDownload (browser missing).
const missingProbe: RemotionBrowserProbeAdapter = {
  async ensureBrowser({ onDownload }) {
    return onDownload();
  },
};

// Probe whose ensureBrowser resolves without triggering onDownload (installed).
const installedProbe: RemotionBrowserProbeAdapter = {
  async ensureBrowser() {
    return { executablePath: "/runtime/headless-shell" };
  },
};

const neverDownloader: RemotionBrowserDownloadAdapter = {
  async download() {
    throw new Error("下载不应被调用");
  },
};

describe("RemotionBrowserController.status", () => {
  it("reports not-installed and aborts before any download when browser missing", async () => {
    const onDownload = vi.fn(() => {
      throw BROWSER_DOWNLOAD_ABORT;
    });
    const probe: RemotionBrowserProbeAdapter = {
      ensureBrowser: vi.fn(async (opts) => opts.onDownload()),
    };
    const controller = new RemotionBrowserController(
      VERSION,
      probe,
      neverDownloader,
      memoryStore(),
    );

    const status = await controller.status();

    expect(status.state).toBe("not-installed");
    expect(status.remotionVersion).toBe(VERSION);
    // Download adapter was never invoked: probe only aborted.
    expect(probe.ensureBrowser).toHaveBeenCalledTimes(1);
    void onDownload;
  });

  it("reports ready when browser installed and prepared version matches", async () => {
    const controller = new RemotionBrowserController(
      VERSION,
      installedProbe,
      neverDownloader,
      memoryStore(VERSION),
    );

    const status = await controller.status();

    expect(status.state).toBe("ready");
    expect(status.preparedForRemotionVersion).toBe(VERSION);
  });

  it("keeps the executable path on the internal probe result", async () => {
    const controller = new RemotionBrowserController(
      VERSION,
      installedProbe,
      neverDownloader,
      memoryStore(VERSION),
    );

    const result = await controller.probeStatus();

    expect(result.status.state).toBe("ready");
    expect(result.executablePath).toBe("/runtime/headless-shell");
  });

  it("reports an error instead of ready when the probe omits the executable path", async () => {
    const controller = new RemotionBrowserController(
      VERSION,
      { async ensureBrowser() { return {}; } },
      neverDownloader,
      memoryStore(VERSION),
    );

    const result = await controller.probeStatus();

    expect(result.status.state).toBe("error");
    expect(result.executablePath).toBeUndefined();
  });

  it("marks update-required on version mismatch without clearing the cache", async () => {
    const store = memoryStore("4.0.400");
    const controller = new RemotionBrowserController(
      VERSION,
      installedProbe,
      neverDownloader,
      store,
    );

    const status = await controller.status();

    expect(status.state).toBe("update-required");
    expect(status.preparedForRemotionVersion).toBe("4.0.400");
    // Cache metadata untouched: controller never deletes or rewrites it here.
    expect(store.value).toBe("4.0.400");
  });

  it("keeps update-required when the new Remotion version has no matching browser", async () => {
    const store = memoryStore("4.0.400");
    const controller = new RemotionBrowserController(
      VERSION,
      missingProbe,
      neverDownloader,
      store,
    );

    const status = await controller.status();

    expect(status.state).toBe("update-required");
    expect(status.preparedForRemotionVersion).toBe("4.0.400");
    expect(store.value).toBe("4.0.400");
  });

  it("reports error when probe rejects for a non-download reason", async () => {
    const brokenProbe: RemotionBrowserProbeAdapter = {
      async ensureBrowser() {
        throw new Error("磁盘不可用");
      },
    };
    const controller = new RemotionBrowserController(
      VERSION,
      brokenProbe,
      neverDownloader,
      memoryStore(),
    );

    const status = await controller.status();

    expect(status.state).toBe("error");
    expect(status.message).toBe("磁盘不可用");
  });
});

describe("RemotionBrowserController.download", () => {
  it("forwards progress and records prepared version on success", async () => {
    const ratios: number[] = [];
    const downloader: RemotionBrowserDownloadAdapter = {
      async download({ onProgress }) {
        onProgress(0.5);
        onProgress(1);
        return { executablePath: "/runtime/headless-shell" };
      },
    };
    const store = memoryStore();
    const controller = new RemotionBrowserController(
      VERSION,
      missingProbe,
      downloader,
      store,
    );

    const status = await controller.download((r) => ratios.push(r));

    expect(ratios).toEqual([0.5, 1]);
    expect(status.state).toBe("ready");
    expect(store.value).toBe(VERSION);
  });

  it("rejects a second setup while one is in flight", async () => {
    let release: (() => void) | undefined;
    const downloader: RemotionBrowserDownloadAdapter = {
      download() {
        return new Promise<{ executablePath?: string }>((resolve) => {
          release = () => resolve({ executablePath: "/runtime/headless-shell" });
        });
      },
    };
    const controller = new RemotionBrowserController(
      VERSION,
      missingProbe,
      downloader,
      memoryStore(),
    );

    const first = controller.download(() => {});
    await expect(controller.download(() => {})).rejects.toThrow(
      "同一时间只允许一个浏览器设置操作",
    );

    release?.();
    await first;
    expect(controller.isSetupInFlight).toBe(false);
  });

  it("does not record the prepared version when download omits the executable path", async () => {
    const store = memoryStore();
    const controller = new RemotionBrowserController(
      VERSION,
      missingProbe,
      { async download() { return {}; } },
      store,
    );

    await expect(controller.download(() => {})).rejects.toThrow(
      "下载完成但未返回 executable path",
    );
    expect(store.value).toBeUndefined();
  });
});
