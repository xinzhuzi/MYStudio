// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    const row = await screen.findByTestId("torch-section-body");
    await waitFor(() => expect(row.textContent).toContain("需更新 → 2.14.1+cu132"));
    fireEvent.click(screen.getByTestId("torch-upgrade-start"));
    fireEvent.click(await screen.findByText("确认升级"));
    await waitFor(() => expect(mocks.start).toHaveBeenCalledWith("2.14.1", "cu132", "remote"));
    expect((screen.getByTestId("torch-upgrade-start") as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders pinned and unverified versions distinctly", async () => {
    mocks.info.mockResolvedValue({ current: { torch: "2.14.1+cu132" }, live: true, hostMatched: true, busy: false, allowedTargets: ["2.14.1"] });
    const view = render(<McpSettingsTab />);
    await waitFor(() => expect(screen.getByTestId("torch-section-body").textContent).toContain("2.14.1"));
    view.unmount();
    mocks.info.mockResolvedValue({ current: { torch: "2.14.1+cu132" }, live: false, hostMatched: true, busy: false, allowedTargets: ["2.14.1"] });
    render(<McpSettingsTab />);
    await waitFor(() => expect(screen.getByTestId("torch-section-body").textContent).toContain("未实时验证"));
  });

  it("shows the first failed source in both version displays", async () => {
    mocks.info.mockResolvedValue({ current: null, live: false, hostMatched: true, busy: false, errors: ["system_stats: 引擎不可达", "venv-probe: 未连接", "ledger: 不存在"], allowedTargets: ["2.14.1"] });
    render(<McpSettingsTab />);
    const row = await screen.findByTestId("torch-section-body");
    await waitFor(() => expect(row.textContent).toContain("未知(原因:system_stats: 引擎不可达)"));
    expect(screen.getAllByText("未知(原因:system_stats: 引擎不可达)").length).toBeGreaterThan(0);
    expect(row.textContent).not.toContain("未实时验证");
  });

  it("shows a fresh system_stats version after SSH disconnects without enabling upgrades", async () => {
    let resolveRemote!: (value: { source: string; url: string }) => void;
    mocks.remote.mockReturnValue(new Promise((resolve) => { resolveRemote = resolve; }));
    mocks.ssh.mockResolvedValue({ connected: false, configured: false, available: true });
    mocks.info.mockResolvedValue({ current: { torch: "2.14.1+cu132", source: "system_stats" }, live: true, hostMatched: false, busy: false, allowedTargets: ["2.14.1"] });
    render(<McpSettingsTab />);
    const row = await screen.findByTestId("torch-section-body");
    expect(row.textContent).toContain("生效版本：未知");
    await act(async () => { resolveRemote({ source: "settings", url: "http://example.invalid:17000" }); });
    await waitFor(() => expect(row.textContent).toContain("2.14.1"));
    expect(row.textContent).not.toContain("未实时验证");
    expect((screen.getByTestId("torch-upgrade-start") as HTMLButtonElement).disabled).toBe(true);
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
      const row = await screen.findByTestId("torch-section-body");
      await waitFor(() => expect(row.textContent).toContain("需更新 → 2.14.1+cu132"));
      mocks.info.mockRejectedValue(new Error("offline"));
      await act(async () => { refresh?.(); await Promise.resolve(); });
      await waitFor(() => expect(row.textContent).toContain("未知"));
      expect(row.textContent).toContain("未知(原因:offline)");
      expect(row.textContent).not.toContain("未实时验证");
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
    const row = await screen.findByTestId("torch-section-body");
    await waitFor(() => expect(row.textContent).toContain("需更新 → 2.14.1+cu132"));
    mocks.remote.mockResolvedValue({ source: "settings", url: nextUrl, effective: nextUrl });
    mocks.info.mockImplementation(() => new Promise((resolve) => { resolveNext = resolve; }));
    const buttons = screen.getAllByTestId("engine-device-remote-select");
    const nextButton = buttons.find((button) => button.getAttribute("data-url") === nextUrl);
    expect(nextButton).toBeTruthy();
    fireEvent.click(nextButton!);
    await waitFor(() => expect(mocks.setRemote).toHaveBeenCalledWith(nextUrl));
    await waitFor(() => expect(row.textContent).toContain("生效版本：未知"));
    expect(row.textContent).toContain("原因:");
    await act(async () => { resolveNext({ current: { torch: "2.14.1+cu132" }, live: true, hostMatched: true, busy: false, allowedTargets: ["2.14.1"] }); });
    await waitFor(() => expect(row.textContent).toContain("2.14.1"));
  });

  it("invalidates the live version when the SSH fingerprint changes", async () => {
    const originalFingerprint = useSshPresetsStore.getState().activeFingerprint;
    let resolveNext!: (value: unknown) => void;
    const view = render(<McpSettingsTab />);
    try {
      const row = await screen.findByTestId("torch-section-body");
      await waitFor(() => expect(row.textContent).toContain("需更新 → 2.14.1+cu132"));
      mocks.info.mockImplementation(() => new Promise((resolve) => { resolveNext = resolve; }));
      await act(async () => { useSshPresetsStore.getState().setActiveFingerprint({ host: "other.invalid", port: 2222, user: "engine" }); });
      expect(row.textContent).toContain("生效版本：未知");
      expect(row.textContent).toContain("原因:");
      expect(row.textContent).not.toContain("2.11.0+cu128");
      await act(async () => { resolveNext({ current: { torch: "2.14.1+cu132" }, live: true, hostMatched: true, busy: false, allowedTargets: ["2.14.1"] }); });
      await waitFor(() => expect(row.textContent).toContain("2.14.1"));
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
      const row = await screen.findByTestId("torch-section-body");
      await waitFor(() => expect(row.textContent).toContain("需更新 → 2.14.1+cu132"));
      mocks.info.mockImplementationOnce(() => new Promise((resolve) => { resolveOlder = resolve; }))
        .mockImplementationOnce(() => new Promise((resolve) => { resolveNewer = resolve; }));
      await act(async () => { refresh?.(); });
      await act(async () => { useSshPresetsStore.getState().setActiveFingerprint({ host: "other.invalid", port: 2222, user: "engine" }); });
      await act(async () => { resolveNewer({ current: { torch: "2.14.1+cu132" }, live: true, hostMatched: true, busy: false, allowedTargets: ["2.14.1"] }); });
      await waitFor(() => expect(row.textContent).toContain("2.14.1"));
      await act(async () => { resolveOlder({ current: { torch: "2.11.0+cu128" }, live: true, hostMatched: true, busy: false, allowedTargets: ["2.14.1"] }); });
      expect(row.textContent).toContain("2.14.1");
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
      const row = await screen.findByTestId("torch-section-body");
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
      expect(row.textContent).toContain("生效版本：2.14.1+cu132");
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
      expect(screen.getByTestId("torch-section-body").textContent).toContain("2.11.0+cu128");
      window.clearInterval(timer);
    } finally {
      vi.useRealTimers();
      view.unmount();
      interval.mockRestore();
    }
  });

  it("MCP 域恒远端:本地引擎生效时仍指向 Windows(mode=remote)", async () => {
    mocks.remote.mockResolvedValue({ source: "local", url: "" });
    mocks.ssh.mockResolvedValue({ connected: true, configured: true, available: true, host: "192.168.0.101" });
    mocks.info.mockResolvedValue({ mode: "remote", current: { torch: "2.11.0+cu128" }, live: true, hostMatched: true, busy: false, allowedTargets: ["2.14.1"] });
    mocks.poll.mockImplementation(() => new Promise(() => {}));
    render(<McpSettingsTab />);
    const row = await screen.findByTestId("torch-section-body");
    await waitFor(() => expect(row.textContent).toContain("需更新 → 2.14.1"));
    expect(screen.getByLabelText("CUDA 通道")).toBeTruthy();
    const button = screen.getByTestId("torch-upgrade-start") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(await screen.findByText(/本地\(Mac\)引擎升级请到/)).toBeTruthy();
    expect(mocks.info).toHaveBeenCalledWith("remote");
    fireEvent.click(button);
    fireEvent.click(await screen.findByText("确认升级"));
    await waitFor(() => expect(mocks.start).toHaveBeenCalledWith("2.14.1", expect.any(String), "remote"));
    const progress = await screen.findByTestId("torch-upgrade-progress");
    for (const label of ["预检", "快照", "停止引擎", "安装", "导入验证", "重启", "烟测", "落账"]) expect(progress.textContent).toContain(label);
  });


  it("远端探针失败时未知带原因且禁点(MCP 域不再降级本地)", async () => {
    const remoteUrl = "http://example.invalid:17000";
    useEnginePresetsStore.getState().favorite(remoteUrl);
    mocks.remote.mockResolvedValue({ source: "local", url: "" });
    mocks.info.mockRejectedValue(new Error("remote probe unavailable"));
    render(<McpSettingsTab />);
    const row = await screen.findByTestId("torch-section-body");
    await waitFor(() => expect(row.textContent).toContain("未知(原因:remote probe unavailable)"));
    const button = screen.getByTestId("torch-upgrade-start") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(mocks.start).not.toHaveBeenCalled();
    expect(screen.queryByTestId("torch-upgrade-progress")).toBeNull();
  });

  it("isolates a running local job when the remote probe fails after switching", async () => {
    const remoteUrl = "http://example.invalid:17000";
    useEnginePresetsStore.getState().favorite(remoteUrl);
    mocks.remote.mockResolvedValue({ source: "local", url: "" });
    mocks.info.mockImplementation(async (mode) => {
      if (mode === "remote") throw new Error("remote probe unavailable");
      return { current: { torch: "2.14.0" }, live: true, hostMatched: true, busy: false, allowedTargets: ["2.14.1"] };
    });
    render(<McpSettingsTab />);
    const row = await screen.findByTestId("torch-section-body");
    await waitFor(() => expect(row.textContent).toContain("未知(原因:remote probe unavailable)"));
    const button = screen.getByTestId("torch-upgrade-start") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(mocks.start).not.toHaveBeenCalled();
    expect(screen.queryByTestId("torch-upgrade-progress")).toBeNull();
  });

  it("ignores a late old poll after restarting on the same identity", async () => {
    let updateOld!: (job: unknown) => void;
    let updateNew!: (job: unknown) => void;
    mocks.start.mockReset().mockResolvedValueOnce({ jobId: "old-job" }).mockResolvedValueOnce({ jobId: "new-job" });
    mocks.poll.mockReset().mockImplementationOnce((_id, _timeout, _interval, update) => {
      updateOld = update;
      return Promise.reject(new Error("poll interrupted"));
    }).mockImplementationOnce((_id, _timeout, _interval, update) => {
      updateNew = update;
      return new Promise(() => {});
    });
    render(<McpSettingsTab />);
    const button = await screen.findByTestId("torch-upgrade-start") as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    fireEvent.click(await screen.findByText("确认升级"));
    await waitFor(() => expect(screen.getByText(/升级跟踪中断/)).toBeTruthy());
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    fireEvent.click(await screen.findByText("确认升级"));
    await waitFor(() => expect(mocks.poll).toHaveBeenCalledTimes(2));
    await act(async () => { updateNew({ status: "running", step: "install", message: "新任务安装中" }); });
    vi.useFakeTimers();
    try {
      setTimeout(() => updateOld({ status: "running", step: "snapshot", message: "旧任务迟到" }), 1000);
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(screen.getByTestId("torch-upgrade-progress").textContent).toContain("⏳ 安装");
      expect(screen.queryByText("旧任务迟到")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("disables the local update when already pinned", async () => {
    mocks.remote.mockResolvedValue({ source: "local", url: "" });
    mocks.ssh.mockResolvedValue({ connected: false, configured: false, available: true });
    mocks.info.mockResolvedValue({ mode: "local", current: { torch: "2.14.1" }, live: true, hostMatched: true, busy: false, allowedTargets: ["2.14.1"] });
    render(<McpSettingsTab />);
    const row = await screen.findByTestId("torch-section-body");
    await waitFor(() => expect(row.textContent).toContain("2.14.1"));
    expect((screen.getByTestId("torch-upgrade-start") as HTMLButtonElement).disabled).toBe(true);
  });

  it("blocks torch upgrades during synchronization and synchronization during an upgrade", async () => {
    mocks.manifest.mockResolvedValue({ items: [{ name: "ComfyUI", status: "both", url: "", macHead: "a", winHead: "b" }] });
    mocks.sync.mockImplementation(() => new Promise(() => {}));
    const view = render(<McpSettingsTab />);
    const sync = await screen.findByTestId("engine-sync-start") as HTMLButtonElement;
    await waitFor(() => expect(sync.disabled).toBe(false));
    fireEvent.click(sync);
    await waitFor(() => expect((screen.getByTestId("torch-upgrade-start") as HTMLButtonElement).disabled).toBe(true));
    view.unmount();
    mocks.info.mockResolvedValue({ current: { torch: "2.11.0+cu128" }, live: true, hostMatched: true, busy: true, allowedTargets: ["2.14.1"] });
    render(<McpSettingsTab />);
    await waitFor(() => expect((screen.getByTestId("engine-sync-start") as HTMLButtonElement).disabled).toBe(true));
  });

  it("labels mismatched hosts as unverified ledger data", async () => {
    mocks.info.mockResolvedValue({ current: { torch: "2.11.0+cu128", source: "ledger" }, live: false, hostMatched: false, busy: false });
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
    await waitFor(() => expect(mocks.poll).toHaveBeenCalledWith("existing-job", expect.any(Number), 1500, expect.any(Function), 3, "remote"));
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
      await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("GET", "/comfy/jobs/lost-job?mode=remote", { timeoutMs: 10_000 }));
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
    await screen.findByText("2.11.0+cu128");
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
    expect(screen.getByText(/MYIA/)).toBeTruthy();
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
