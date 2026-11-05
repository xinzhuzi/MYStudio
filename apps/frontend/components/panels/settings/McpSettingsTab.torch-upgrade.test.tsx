// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { McpSettingsTab } from "./McpSettingsTab";
import { ComfySidecarHttpError } from "@/lib/assist/image-studio/comfy-sidecar-bridge";
import { useEnginePresetsStore } from "@/stores/settings/engine-presets-store";
import { useSshPresetsStore } from "@/stores/settings/ssh-presets-store";

const mocks = vi.hoisted(() => ({
  remote: vi.fn(), setRemote: vi.fn(), ssh: vi.fn(), info: vi.fn(), start: vi.fn(), poll: vi.fn(), manifest: vi.fn(), sync: vi.fn(), request: vi.fn(),
}));

vi.mock("@/lib/assist/image-studio/comfy-sidecar-bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/assist/image-studio/comfy-sidecar-bridge")>();
  return { ...actual, getRemoteEngine: mocks.remote, setRemoteEngine: mocks.setRemote, getComfySshStatus: mocks.ssh,
    getEngineTorchInfo: mocks.info, startEngineTorchUpgrade: mocks.start,
    pollJobUntilTerminal: mocks.poll, getEngineSyncManifest: mocks.manifest, syncEngine: mocks.sync,
    comfySidecarRequest: mocks.request };
});

describe("torch upgrade settings", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.request.mockReset().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    mocks.remote.mockResolvedValue({ source: "settings", url: "http://example.invalid:17000" });
    mocks.setRemote.mockResolvedValue({});
    mocks.ssh.mockResolvedValue({ connected: true, configured: false, available: true });
    mocks.info.mockResolvedValue({ current: { torch: "2.11.0+cu128" }, live: true, hostMatched: true, busy: false, jobId: null, allowedTargets: ["2.14.1", "2.14.0", "2.13.0"] });
    mocks.start.mockResolvedValue({ jobId: "job" });
    mocks.manifest.mockResolvedValue({ items: [] });
  });

  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it("shows the live version and gates invalid versions", async () => {
    render(<McpSettingsTab />);
    await screen.findByText("2.11.0+cu128");
    const button = screen.getByTestId("torch-upgrade-start") as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    expect((screen.getByLabelText("目标版本") as HTMLInputElement).value).toBe("2.14.1");
    fireEvent.change(screen.getByLabelText("目标版本"), { target: { value: "2.13.0" } });
    expect(button.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("目标版本"), { target: { value: "bad" } });
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/仅支持 2.14.1/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("目标版本"), { target: { value: "9.9.9" } });
    expect(button.disabled).toBe(true);
  });

  it("offers the pinned update and routes confirmation to cu132", async () => {
    mocks.poll.mockImplementation(() => new Promise(() => {}));
    render(<McpSettingsTab />);
    const row = await screen.findByTestId("engine-sync-torch-row");
    await waitFor(() => expect(row.textContent).toContain("需更新 → 2.14.1+cu132"));
    fireEvent.click(within(row).getByRole("button", { name: "更新" }));
    fireEvent.click(await screen.findByText("确认升级"));
    await waitFor(() => expect(mocks.start).toHaveBeenCalledWith("2.14.1", "cu132"));
    expect((within(row).getByRole("button", { name: "更新" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders pinned and unverified versions distinctly", async () => {
    mocks.info.mockResolvedValue({ current: { torch: "2.14.1+cu132" }, live: true, hostMatched: true, busy: false, allowedTargets: ["2.14.1"] });
    const view = render(<McpSettingsTab />);
    await waitFor(() => expect(screen.getByTestId("engine-sync-torch-row").textContent).toContain("✅ 已是钉版"));
    view.unmount();
    mocks.info.mockResolvedValue({ current: { torch: "2.14.1+cu132" }, live: false, hostMatched: true, busy: false, allowedTargets: ["2.14.1"] });
    render(<McpSettingsTab />);
    await waitFor(() => expect(screen.getByTestId("engine-sync-torch-row").textContent).toContain("未实时验证"));
  });

  it("does not present a cached pinned version as verified after SSH disconnects", async () => {
    let resolveRemote!: (value: { source: string; url: string }) => void;
    mocks.remote.mockReturnValue(new Promise((resolve) => { resolveRemote = resolve; }));
    mocks.ssh.mockResolvedValue({ connected: false, configured: false, available: true });
    mocks.info.mockResolvedValue({ current: { torch: "2.14.1+cu132" }, live: true, hostMatched: true, busy: false, allowedTargets: ["2.14.1"] });
    render(<McpSettingsTab />);
    const row = await screen.findByTestId("engine-sync-torch-row");
    await waitFor(() => expect(row.textContent).toContain("当前：2.14.1+cu132"));
    await act(async () => { resolveRemote({ source: "settings", url: "http://example.invalid:17000" }); });
    await waitFor(() => expect(row.textContent).toContain("远端未连接"));
    expect(row.textContent).toContain("未实时验证");
    expect(row.textContent).not.toContain("已是钉版");
    expect(row.textContent).not.toContain("需更新");
    const header = screen.getByTestId("engine-sync-header");
    expect(header.textContent).toContain("远端未连接");
    expect(header.textContent).toContain("未实时验证");
    expect(header.textContent).not.toContain("2.14.1+cu132");
    expect((within(row).getByRole("button", { name: "更新" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("degrades both sync displays when torch info fails", async () => {
    let refresh: (() => void) | undefined;
    const realInterval = window.setInterval.bind(window);
    const interval = vi.spyOn(window, "setInterval").mockImplementation((handler, delay, ...args) => {
      if (delay === 10_000 && typeof handler === "function") refresh = handler as () => void;
      return realInterval(handler, delay, ...args) as unknown as ReturnType<typeof setInterval>;
    });
    const view = render(<McpSettingsTab />);
    try {
      const row = await screen.findByTestId("engine-sync-torch-row");
      await waitFor(() => expect(row.textContent).toContain("需更新 → 2.14.1+cu132"));
      mocks.info.mockRejectedValue(new Error("offline"));
      await act(async () => { refresh?.(); await Promise.resolve(); });
      await waitFor(() => expect(row.textContent).toContain("未知"));
      expect(row.textContent).toContain("未实时验证");
      expect(screen.getByTestId("engine-sync-header").textContent).toContain("未知 · 未实时验证");
    } finally {
      view.unmount();
      interval.mockRestore();
    }
  });

  it("invalidates the old engine version until the new engine probe resolves", async () => {
    const nextUrl = "http://other.invalid:17000";
    useEnginePresetsStore.getState().favorite(nextUrl);
    let resolveNext!: (value: unknown) => void;
    render(<McpSettingsTab />);
    const row = await screen.findByTestId("engine-sync-torch-row");
    await waitFor(() => expect(row.textContent).toContain("需更新 → 2.14.1+cu132"));
    mocks.remote.mockResolvedValue({ source: "settings", url: nextUrl, effective: nextUrl });
    mocks.info.mockImplementation(() => new Promise((resolve) => { resolveNext = resolve; }));
    const buttons = screen.getAllByTestId("engine-device-remote-select");
    const nextButton = buttons.find((button) => button.getAttribute("data-url") === nextUrl);
    expect(nextButton).toBeTruthy();
    fireEvent.click(nextButton!);
    await waitFor(() => expect(mocks.setRemote).toHaveBeenCalledWith(nextUrl));
    await waitFor(() => expect(row.textContent).toContain("当前：未知"));
    expect(row.textContent).toContain("未实时验证");
    expect(screen.getByTestId("engine-sync-header").textContent).toContain("未知 · 未实时验证");
    await act(async () => { resolveNext({ current: { torch: "2.14.1+cu132" }, live: true, hostMatched: true, busy: false, allowedTargets: ["2.14.1"] }); });
    await waitFor(() => expect(row.textContent).toContain("✅ 已是钉版"));
    expect(screen.getByTestId("engine-sync-header").textContent).toContain("2.14.1+cu132");
  });

  it("invalidates the live version when the SSH fingerprint changes", async () => {
    const originalFingerprint = useSshPresetsStore.getState().activeFingerprint;
    let resolveNext!: (value: unknown) => void;
    const view = render(<McpSettingsTab />);
    try {
      const row = await screen.findByTestId("engine-sync-torch-row");
      await waitFor(() => expect(row.textContent).toContain("需更新 → 2.14.1+cu132"));
      mocks.info.mockImplementation(() => new Promise((resolve) => { resolveNext = resolve; }));
      await act(async () => { useSshPresetsStore.getState().setActiveFingerprint({ host: "other.invalid", port: 2222, user: "engine" }); });
      expect(row.textContent).toContain("当前：未知");
      expect(row.textContent).toContain("未实时验证");
      expect(row.textContent).not.toContain("2.11.0+cu128");
      await act(async () => { resolveNext({ current: { torch: "2.14.1+cu132" }, live: true, hostMatched: true, busy: false, allowedTargets: ["2.14.1"] }); });
      await waitFor(() => expect(row.textContent).toContain("✅ 已是钉版"));
    } finally {
      view.unmount();
      useSshPresetsStore.setState({ activeFingerprint: originalFingerprint });
    }
  });

  it("ignores a prior identity's polling probe after a newer probe resolves", async () => {
    const originalFingerprint = useSshPresetsStore.getState().activeFingerprint;
    let refresh: (() => void) | undefined;
    const realInterval = window.setInterval.bind(window);
    const interval = vi.spyOn(window, "setInterval").mockImplementation((handler, delay, ...args) => {
      if (delay === 10_000 && typeof handler === "function") refresh = handler as () => void;
      return realInterval(handler, delay, ...args) as unknown as ReturnType<typeof setInterval>;
    });
    let resolveOlder!: (value: unknown) => void;
    let resolveNewer!: (value: unknown) => void;
    const view = render(<McpSettingsTab />);
    try {
      const row = await screen.findByTestId("engine-sync-torch-row");
      await waitFor(() => expect(row.textContent).toContain("需更新 → 2.14.1+cu132"));
      mocks.info.mockImplementationOnce(() => new Promise((resolve) => { resolveOlder = resolve; }))
        .mockImplementationOnce(() => new Promise((resolve) => { resolveNewer = resolve; }));
      await act(async () => { refresh?.(); });
      await act(async () => { useSshPresetsStore.getState().setActiveFingerprint({ host: "other.invalid", port: 2222, user: "engine" }); });
      await act(async () => { resolveNewer({ current: { torch: "2.14.1+cu132" }, live: true, hostMatched: true, busy: false, allowedTargets: ["2.14.1"] }); });
      await waitFor(() => expect(row.textContent).toContain("✅ 已是钉版"));
      await act(async () => { resolveOlder({ current: { torch: "2.11.0+cu128" }, live: true, hostMatched: true, busy: false, allowedTargets: ["2.14.1"] }); });
      expect(row.textContent).toContain("✅ 已是钉版");
      expect(row.textContent).not.toContain("2.11.0+cu128");
    } finally {
      view.unmount();
      interval.mockRestore();
      useSshPresetsStore.setState({ activeFingerprint: originalFingerprint });
    }
  });

  it("accepts slow probes without overlapping requests", async () => {
    let refresh: (() => void) | undefined;
    const realInterval = window.setInterval.bind(window);
    const interval = vi.spyOn(window, "setInterval").mockImplementation((handler, delay, ...args) => {
      if (delay === 10_000 && typeof handler === "function") refresh = handler as () => void;
      return realInterval(handler, delay, ...args) as unknown as ReturnType<typeof setInterval>;
    });
    const view = render(<McpSettingsTab />);
    try {
      const row = await screen.findByTestId("engine-sync-torch-row");
      await waitFor(() => expect(row.textContent).toContain("2.11.0+cu128"));
      vi.useFakeTimers();
      let inFlight = 0;
      let maxInFlight = 0;
      mocks.info.mockImplementation(() => new Promise((resolve) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        setTimeout(() => {
          inFlight -= 1;
          resolve({ current: { torch: "2.14.1+cu132" }, live: true, hostMatched: true, busy: false, allowedTargets: ["2.14.1"] });
        }, 11_000);
      }));
      await act(async () => { refresh?.(); });
      const timer = window.setInterval(() => refresh?.(), 10_000);
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(row.textContent).toContain("当前：2.14.1+cu132");
      expect(maxInFlight).toBe(1);
      window.clearInterval(timer);
    } finally {
      vi.useRealTimers();
      view.unmount();
      interval.mockRestore();
    }
  });

  it("coalesces polling ticks until an in-flight probe settles", async () => {
    let refresh: (() => void) | undefined;
    const realInterval = window.setInterval.bind(window);
    const interval = vi.spyOn(window, "setInterval").mockImplementation((handler, delay, ...args) => {
      if (delay === 10_000 && typeof handler === "function") refresh = handler as () => void;
      return realInterval(handler, delay, ...args) as unknown as ReturnType<typeof setInterval>;
    });
    const view = render(<McpSettingsTab />);
    try {
      await screen.findByText("2.11.0+cu128");
      let resolveProbe!: (value: unknown) => void;
      mocks.info.mockClear().mockImplementationOnce(() => new Promise((resolve) => { resolveProbe = resolve; }));
      vi.useFakeTimers();
      await act(async () => { refresh?.(); });
      const timer = window.setInterval(() => refresh?.(), 10_000);
      await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
      expect(mocks.info).toHaveBeenCalledTimes(1);
      await act(async () => { resolveProbe({ current: { torch: "2.11.0+cu128" }, live: true, hostMatched: true, busy: false, allowedTargets: ["2.14.1"] }); });
      expect(mocks.info).toHaveBeenCalledTimes(2);
      window.clearInterval(timer);
    } finally {
      vi.useRealTimers();
      view.unmount();
      interval.mockRestore();
    }
  });

  it("resumes polling after a probe rejects", async () => {
    let refresh: (() => void) | undefined;
    const realInterval = window.setInterval.bind(window);
    const interval = vi.spyOn(window, "setInterval").mockImplementation((handler, delay, ...args) => {
      if (delay === 10_000 && typeof handler === "function") refresh = handler as () => void;
      return realInterval(handler, delay, ...args) as unknown as ReturnType<typeof setInterval>;
    });
    const view = render(<McpSettingsTab />);
    try {
      await screen.findByText("2.11.0+cu128");
      mocks.info.mockClear().mockRejectedValueOnce(new Error("offline"));
      vi.useFakeTimers();
      await act(async () => { refresh?.(); });
      expect(mocks.info).toHaveBeenCalledTimes(1);
      const timer = window.setInterval(() => refresh?.(), 10_000);
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expect(mocks.info).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId("engine-sync-torch-row").textContent).toContain("当前：2.11.0+cu128");
      window.clearInterval(timer);
    } finally {
      vi.useRealTimers();
      view.unmount();
      interval.mockRestore();
    }
  });

  it("supports the local mode without a CUDA selector or SSH", async () => {
    mocks.remote.mockResolvedValue({ source: "local", url: "" });
    mocks.ssh.mockResolvedValue({ connected: false, configured: false, available: true });
    mocks.info.mockResolvedValue({ mode: "local", current: { torch: "2.14.0" }, live: true, hostMatched: true, busy: false, allowedTargets: ["2.14.1"] });
    render(<McpSettingsTab />);
    const row = await screen.findByTestId("engine-sync-torch-row");
    await waitFor(() => expect(row.textContent).toContain("需更新 → 2.14.1"));
    expect(screen.queryByLabelText("CUDA 通道")).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "更新" }));
    expect(await screen.findByText(/本地引擎将停机/)).toBeTruthy();
    expect(screen.queryByText(/MYIA keeper 常驻同机/)).toBeNull();
  });

  it("blocks torch upgrades during synchronization and synchronization during an upgrade", async () => {
    mocks.manifest.mockResolvedValue({ items: [{ name: "ComfyUI", status: "both", url: "", macHead: "a", winHead: "b" }] });
    mocks.sync.mockImplementation(() => new Promise(() => {}));
    const view = render(<McpSettingsTab />);
    const sync = await screen.findByTestId("engine-sync-start") as HTMLButtonElement;
    await waitFor(() => expect(sync.disabled).toBe(false));
    fireEvent.click(sync);
    await waitFor(() => expect((within(screen.getByTestId("engine-sync-torch-row")).getByRole("button", { name: "更新" }) as HTMLButtonElement).disabled).toBe(true));
    view.unmount();
    mocks.info.mockResolvedValue({ current: { torch: "2.11.0+cu128" }, live: true, hostMatched: true, busy: true, allowedTargets: ["2.14.1"] });
    render(<McpSettingsTab />);
    await waitFor(() => expect((screen.getByTestId("engine-sync-start") as HTMLButtonElement).disabled).toBe(true));
  });

  it("labels mismatched hosts as unverified ledger data", async () => {
    mocks.info.mockResolvedValue({ current: { torch: "2.11.0+cu128" }, live: true, hostMatched: false, busy: false });
    render(<McpSettingsTab />);
    await screen.findByText("2.11.0+cu128");
    expect(screen.getByText(/账本，未实时验证/)).toBeTruthy();
    expect(screen.getByText(/SSH 主机与当前生效引擎不一致/)).toBeTruthy();
  });

  it("reattaches to an active job on mount", async () => {
    mocks.info.mockResolvedValue({ current: null, live: false, hostMatched: true, busy: true, jobId: "existing-job" });
    mocks.poll.mockImplementation(async (_id, _timeout, _interval, update) => {
      update({ status: "running", step: "install", message: "安装中" });
      return new Promise(() => {});
    });
    render(<McpSettingsTab />);
    await waitFor(() => expect(mocks.poll).toHaveBeenCalledWith("existing-job", expect.any(Number), 1500, expect.any(Function), 3));
    expect(screen.getByTestId("torch-upgrade-progress").textContent).toContain("⏳ 安装");
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("retries interrupted tracking after backoff without losing the snapshot", async () => {
    let refresh: (() => void) | undefined;
    const realInterval = window.setInterval.bind(window);
    const interval = vi.spyOn(window, "setInterval").mockImplementation((handler, delay, ...args) => {
      if (delay === 10_000 && typeof handler === "function") refresh = handler as () => void;
      return realInterval(handler, delay, ...args) as unknown as ReturnType<typeof setInterval>;
    });
    let now = 100_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    mocks.info.mockResolvedValue({ current: null, live: false, hostMatched: true, busy: true, jobId: "retry-job" });
    mocks.poll.mockImplementationOnce(async (_id, _timeout, _interval, update) => {
      update({ status: "running", step: "install", message: "安装中", tail: ["last line"] });
      throw new Error("offline");
    }).mockImplementation(() => new Promise(() => {}));
    const view = render(<McpSettingsTab />);
    try {
      await screen.findByText(/升级跟踪中断/);
      expect(screen.queryByText("升级失败")).toBeNull();
      expect(screen.getByTestId("torch-upgrade-progress").textContent).toContain("last line");
      for (const elapsed of [10_000, 20_000, 30_000]) {
        now = 100_000 + elapsed;
        await act(async () => { refresh?.(); await Promise.resolve(); });
        expect(mocks.poll).toHaveBeenCalledTimes(elapsed < 30_000 ? 1 : 2);
      }
    } finally {
      view.unmount();
      interval.mockRestore();
      clock.mockRestore();
    }
  });

  it.each(["complete", "error", "missing", "offline", "running", "unknown"])("retrieves an interrupted terminal job (%s)", async (outcome) => {
    let refresh: (() => void) | undefined;
    const realInterval = window.setInterval.bind(window);
    const interval = vi.spyOn(window, "setInterval").mockImplementation((handler, delay, ...args) => {
      if (delay === 10_000 && typeof handler === "function") refresh = handler as () => void;
      return realInterval(handler, delay, ...args) as unknown as ReturnType<typeof setInterval>;
    });
    let now = 100_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    mocks.info.mockResolvedValue({ current: null, live: false, hostMatched: true, busy: true, jobId: "lost-job" });
    mocks.poll.mockRejectedValueOnce(new Error("offline"));
    const view = render(<McpSettingsTab />);
    try {
      await screen.findByText(/升级跟踪中断/);
      if (["complete", "error", "running", "unknown"].includes(outcome)) mocks.request.mockResolvedValueOnce({ status: outcome, message: "升级状态", result: { from: "old", to: "new" } });
      else if (outcome === "missing") mocks.request.mockRejectedValueOnce(new ComfySidecarHttpError("missing", 404));
      else mocks.request.mockRejectedValueOnce(new Error("offline"));
      mocks.info.mockResolvedValue({ current: null, live: false, hostMatched: true, busy: false, jobId: null });
      now += 30_000;
      await act(async () => { refresh?.(); await Promise.resolve(); });
      await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("GET", "/comfy/jobs/lost-job", { timeoutMs: 10_000 }));
      if (outcome === "complete" || outcome === "error") {
        expect(await screen.findByTestId("torch-upgrade-result-dialog")).toBeTruthy();
        expect(screen.queryByText(/升级跟踪中断/)).toBeNull();
      } else if (outcome === "missing") {
        expect(await screen.findByText("升级结果已不可取回")).toBeTruthy();
        expect(screen.queryByTestId("torch-upgrade-result-dialog")).toBeNull();
      } else if (outcome === "offline") {
        expect(await screen.findByText("升级结果暂时无法获取，将自动重试")).toBeTruthy();
        expect(screen.queryByTestId("torch-upgrade-result-dialog")).toBeNull();
      } else {
        expect(screen.getByText(/升级跟踪中断/)).toBeTruthy();
        expect(screen.queryByTestId("torch-upgrade-result-dialog")).toBeNull();
      }
    } finally {
      view.unmount();
      interval.mockRestore();
      clock.mockRestore();
    }
  });

  it("disables upgrading without SSH", async () => {
    mocks.ssh.mockResolvedValue({ connected: false, configured: false, available: true });
    render(<McpSettingsTab />);
    await screen.findByText("远端未连接");
    expect((screen.getByTestId("torch-upgrade-start") as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables upgrading while a server job is active", async () => {
    mocks.info.mockResolvedValue({ current: { torch: "2.11.0+cu128" }, live: true, busy: true });
    render(<McpSettingsTab />);
    await screen.findByText("2.11.0+cu128");
    expect((screen.getByTestId("torch-upgrade-start") as HTMLButtonElement).disabled).toBe(true);
  });

  it("confirms before showing pending, active and completed steps", async () => {
    mocks.poll.mockImplementation(async (_id, _timeout, _interval, update) => {
      update({ status: "running", step: "install", message: "安装中" });
      return new Promise(() => {});
    });
    render(<McpSettingsTab />);
    await waitFor(() => expect((screen.getByTestId("torch-upgrade-start") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId("torch-upgrade-start"));
    expect(await screen.findByText(/引擎将停机/)).toBeTruthy();
    expect(screen.getByText(/MYIA keeper 常驻同机/)).toBeTruthy();
    expect(mocks.start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("确认升级"));
    await waitFor(() => expect(screen.getByTestId("torch-upgrade-progress").textContent).toContain("⏳ 安装"));
    expect(screen.getByTestId("torch-upgrade-progress").textContent).toContain("✅ 预检");
    expect(screen.getByTestId("torch-upgrade-progress").textContent).toContain("⬜ 烟测");
    expect((screen.getByTestId("torch-upgrade-start") as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders the error terminal state and rollback message", async () => {
    mocks.poll.mockImplementation(async (_id, _timeout, _interval, update) => {
      const job = { status: "error", step: "install", message: "已回滚至 2.11.0+cu128", result: { pipError: "安装失败" }, tail: ["pip failed"] };
      update(job);
      return job;
    });
    render(<McpSettingsTab />);
    await waitFor(() => expect((screen.getByTestId("torch-upgrade-start") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId("torch-upgrade-start"));
    fireEvent.click(await screen.findByText("确认升级"));
    expect((await screen.findByTestId("torch-upgrade-result-dialog")).textContent).toContain("已回滚至 2.11.0+cu128");
    expect(screen.getByTestId("torch-upgrade-progress").textContent).toContain("❌ 安装");
  });

  it("shows old and new versions after successful restart", async () => {
    mocks.poll.mockImplementation(async (_id, _timeout, _interval, update) => {
      const job = { status: "complete", step: "ledger", result: { from: "2.11.0+cu128", to: "2.14.1+cu132" } };
      update(job);
      return job;
    });
    render(<McpSettingsTab />);
    await waitFor(() => expect((screen.getByTestId("torch-upgrade-start") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId("torch-upgrade-start"));
    fireEvent.click(await screen.findByText("确认升级"));
    const dialog = await screen.findByTestId("torch-upgrade-result-dialog");
    expect(dialog.textContent).toContain("2.11.0+cu128 → 2.14.1+cu132");
    expect(dialog.textContent).toContain("引擎已重启");
  });
});
