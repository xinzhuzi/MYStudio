import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pollTaskStatus } from "./image-task-poller";

const fanrenPollUrl = "https://fanrenapi.com/v1/images/jobs/task_abc";

describe("pollTaskStatus with new-api job responses", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("resolves proxy_url from a wrapped job after queued and running states", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ job: { id: "task_abc", status: "queued" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ job: { id: "task_abc", status: "running" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          job: {
            id: "task_abc",
            status: "succeeded",
            assets: [{ proxy_url: "https://cdn.fanrenapi.com/img/1.png" }],
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const pending = pollTaskStatus("task_abc", "sk-test", "https://fanrenapi.com/v1", undefined, fanrenPollUrl);
    const assertion = expect(pending).resolves.toBe("https://cdn.fanrenapi.com/img/1.png");
    await vi.advanceTimersByTimeAsync(2 * 2000);
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const firstCall = fetchMock.mock.calls[0];
    expect(String(firstCall[0])).toContain("/v1/images/jobs/task_abc");
    expect(firstCall[0]).not.toMatch(/_ts=$/);
  });

  it("resolves flat job payloads without the job wrapper", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: "task_flat",
        status: "success",
        assets: [{ url: "https://cdn.example.com/flat.png" }],
      }),
    }));

    await expect(
      pollTaskStatus("task_flat", "sk-test", "https://relay.example.com/v1", undefined, "https://relay.example.com/v1/images/jobs/task_flat"),
    ).resolves.toBe("https://cdn.example.com/flat.png");
  });

  it("prefers proxy_url over url when both assets exist", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        job: {
          status: "succeeded",
          assets: [{ url: "https://fallback.example/a.png", proxy_url: "https://proxy.example/a.png" }],
        },
      }),
    }));

    await expect(
      pollTaskStatus("task_both", "sk-test", "https://fanrenapi.com/v1", undefined, "https://fanrenapi.com/v1/images/jobs/task_both"),
    ).resolves.toBe("https://proxy.example/a.png");
  });

  it("surfaces job error messages on terminal failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ job: { status: "failed", error: "upstream render crashed" } }),
    }));

    await expect(
      pollTaskStatus("task_err", "sk-test", "https://fanrenapi.com/v1", undefined, "https://fanrenapi.com/v1/images/jobs/task_err"),
    ).rejects.toThrow("upstream render crashed");
  });

  it("fails terminally when a succeeded job has no usable asset URL", async () => {
    const warnSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ job: { status: "succeeded", assets: [{ mime: "image/png" }] } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      pollTaskStatus("task_no_url", "sk-test", "https://fanrenapi.com/v1", undefined, "https://fanrenapi.com/v1/images/jobs/task_no_url"),
    ).rejects.toThrow("Task completed but no URL in result");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});
