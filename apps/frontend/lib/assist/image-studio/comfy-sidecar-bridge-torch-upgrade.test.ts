// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getEngineTorchInfo,
  pollJobUntilTerminal,
  setComfySidecarLivenessProbeForTests,
  startEngineTorchUpgrade,
} from "./comfy-sidecar-bridge";
import { setLocalImageTokenForTests } from "./local-image-token";

describe("torch upgrade bridge", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    setComfySidecarLivenessProbeForTests(async () => true);
    setLocalImageTokenForTests(() => "test-local-image-token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setComfySidecarLivenessProbeForTests(null);
    setLocalImageTokenForTests(null);
  });

  it("reads live and busy status", async () => {
    const info = { current: null, busy: false, live: false };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(info), { status: 200 }));

    await expect(getEngineTorchInfo()).resolves.toEqual(info);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:17595/comfy/ssh/torch-info",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("submits the selected target and channel with authentication", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ jobId: "job-1" }), { status: 200 }));

    await expect(startEngineTorchUpgrade("2.14.1", "cu132")).resolves.toEqual({ jobId: "job-1" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:17595/comfy/ssh/upgrade-torch",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ target: "2.14.1", channel: "cu132" }),
        headers: expect.objectContaining({ Authorization: "Bearer test-local-image-token" }),
      }),
    );
  });

  it("tolerates intermittent errors and resets the consecutive failure count", async () => {
    const ok = (status: string) => new Response(JSON.stringify({ status }), { status: 200 });
    fetchMock.mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(ok("running"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(ok("complete"));
    const update = vi.fn();
    await expect(pollJobUntilTerminal("job", 10000, 0, update, 3)).resolves.toEqual({ status: "complete" });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("fails after three consecutive polling errors", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    await expect(pollJobUntilTerminal("job", 10000, 0, undefined, 3)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
