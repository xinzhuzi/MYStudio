// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PythonSettingsTab } from "./PythonSettingsTab";

const ttsClient = vi.hoisted(() => ({
  getTtsRuntimeConfig: vi.fn(),
  getTtsRuntimeStatus: vi.fn(),
  setTtsRuntimeConfig: vi.fn(),
  setupTtsRuntime: vi.fn(),
}));

vi.mock("@/lib/tts/client", () => ttsClient);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  Object.defineProperty(window, "ttsRuntime", {
    configurable: true,
    value: undefined,
  });
});

describe("PythonSettingsTab", () => {
  it("disables desktop runtime actions when the preload bridge is unavailable", () => {
    render(<PythonSettingsTab />);

    expect((screen.getByRole("button", { name: "开始配置" }) as HTMLButtonElement).disabled).toBe(true);
    const resetButtons = screen.getAllByRole("button", { name: "恢复默认" });
    expect(resetButtons).toHaveLength(2);
    expect(resetButtons.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(resetButtons.every((button) => {
      const className = button.className;
      return className.includes("border-foreground/[0.12]") && className.includes("bg-transparent");
    })).toBe(true);
    expect(screen.getByText(/Python 是本地大模型、TTS 和插件的基础运行环境/)).toBeTruthy();
    expect(screen.getByText(/为减小应用安装包体积/)).toBeTruthy();
    expect(ttsClient.getTtsRuntimeConfig).not.toHaveBeenCalled();
  });

  it("loads and renders the installed Python runtime details", async () => {
    Object.defineProperty(window, "ttsRuntime", {
      configurable: true,
      value: {},
    });
    ttsClient.getTtsRuntimeConfig.mockResolvedValue({
      pythonRuntimeDir: "/project-storage/python",
      pythonRuntimeUrl: "https://mirror.example/python.tar.zst",
      defaultPythonRuntimeUrl: "https://default.example/python.tar.zst",
      installedItems: [
        {
          label: "Python 运行环境",
          detail: "/project-storage/python/bin/python3",
          status: "installed",
        },
        {
          label: "TTS Python 依赖",
          detail: "requirements 已满足",
          status: "skipped",
        },
      ],
    });
    ttsClient.getTtsRuntimeStatus.mockResolvedValue({
      installed: true,
      running: false,
      port: 39001,
      baseUrl: "http://127.0.0.1:39001",
      setupStage: "ready",
    });

    render(<PythonSettingsTab />);

    const installPathInput = await screen.findByDisplayValue("/project-storage/python");
    const downloadSourceInput = screen.getByDisplayValue("https://mirror.example/python.tar.zst");
    expect(installPathInput.parentElement?.className).toContain("w-full");
    expect(downloadSourceInput.parentElement?.className).toContain("w-full");
    expect(installPathInput.parentElement?.parentElement?.className).toContain("minmax(50%,1fr)");
    expect(downloadSourceInput.parentElement?.parentElement?.className).toContain("minmax(50%,1fr)");
    expect(screen.queryByRole("heading", { name: "安装明细" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Python 运行环境" })).toBeNull();
    expect(screen.getByText("Python 下载源").className).toContain("whitespace-nowrap");
    expect(screen.getByText("TTS Python 依赖").className).toContain("whitespace-nowrap");
    expect(screen.getByText("/project-storage/python/bin/python3")).toBeTruthy();
    expect(screen.getByText("requirements 已满足")).toBeTruthy();
  });

  it("starts initial configuration with a normal click", async () => {
    Object.defineProperty(window, "ttsRuntime", {
      configurable: true,
      value: {},
    });
    ttsClient.getTtsRuntimeConfig.mockResolvedValue({
      pythonRuntimeDir: "/project-storage/python",
      pythonRuntimeUrl: "https://mirror.example/python.tar.zst",
      defaultPythonRuntimeUrl: "https://default.example/python.tar.zst",
      installedItems: [],
    });
    ttsClient.getTtsRuntimeStatus.mockResolvedValue({
      installed: false,
      running: false,
      port: 39001,
      baseUrl: "http://127.0.0.1:39001",
      setupStage: "idle",
    });
    ttsClient.setupTtsRuntime.mockResolvedValue({ success: true });

    render(<PythonSettingsTab />);

    fireEvent.click(await screen.findByRole("button", { name: "开始配置" }));
    await waitFor(() => expect(ttsClient.setupTtsRuntime).toHaveBeenCalledTimes(1));
  });

  it("requires a one-second hold before reconfiguring an installed runtime", async () => {
    Object.defineProperty(window, "ttsRuntime", {
      configurable: true,
      value: {},
    });
    ttsClient.getTtsRuntimeConfig.mockResolvedValue({
      pythonRuntimeDir: "/project-storage/python",
      pythonRuntimeUrl: "https://mirror.example/python.tar.zst",
      defaultPythonRuntimeUrl: "https://default.example/python.tar.zst",
      installedItems: [{
        label: "Python 运行环境",
        detail: "/project-storage/python/bin/python3",
        status: "installed",
      }],
    });
    ttsClient.getTtsRuntimeStatus.mockResolvedValue({
      installed: true,
      running: false,
      port: 39001,
      baseUrl: "http://127.0.0.1:39001",
      setupStage: "ready",
    });
    ttsClient.setupTtsRuntime.mockResolvedValue({ success: true });

    render(<PythonSettingsTab />);

    const button = await screen.findByRole("button", { name: "重新配置" });
    expect(screen.getByText("长按 1 秒")).toBeTruthy();
    fireEvent.click(button);
    expect(ttsClient.setupTtsRuntime).not.toHaveBeenCalled();

    vi.useFakeTimers();
    fireEvent.pointerDown(button);
    act(() => vi.advanceTimersByTime(999));
    expect(ttsClient.setupTtsRuntime).not.toHaveBeenCalled();
    fireEvent.pointerUp(button);
    act(() => vi.advanceTimersByTime(1));
    expect(ttsClient.setupTtsRuntime).not.toHaveBeenCalled();

    fireEvent.pointerDown(button);
    await act(async () => {
      vi.advanceTimersByTime(1_000);
      await Promise.resolve();
    });
    expect(ttsClient.setupTtsRuntime).toHaveBeenCalledTimes(1);
  });

  it("restores and saves the default Python download source from the inline action", async () => {
    Object.defineProperty(window, "ttsRuntime", {
      configurable: true,
      value: {},
    });
    const customConfig = {
      pythonRuntimeDir: "/project-storage/python",
      pythonRuntimeUrl: "https://mirror.example/python.tar.zst",
      defaultPythonRuntimeUrl: "https://default.example/python.tar.zst",
      installedItems: [],
    };
    ttsClient.getTtsRuntimeConfig
      .mockResolvedValueOnce(customConfig)
      .mockResolvedValue({ ...customConfig, pythonRuntimeUrl: customConfig.defaultPythonRuntimeUrl });
    ttsClient.getTtsRuntimeStatus.mockResolvedValue({
      installed: true,
      running: false,
      port: 39001,
      baseUrl: "http://127.0.0.1:39001",
      setupStage: "ready",
    });
    ttsClient.setTtsRuntimeConfig.mockResolvedValue({ success: true });

    render(<PythonSettingsTab />);

    await screen.findByDisplayValue(customConfig.pythonRuntimeUrl);
    const downloadSourceRow = screen.getByText("Python 下载源").parentElement;
    expect(downloadSourceRow).toBeTruthy();
    fireEvent.click(within(downloadSourceRow as HTMLElement).getByRole("button", { name: "恢复默认" }));

    await waitFor(() => {
      expect(ttsClient.setTtsRuntimeConfig).toHaveBeenCalledWith({
        pythonRuntimeUrl: customConfig.defaultPythonRuntimeUrl,
      });
    });
    expect(await screen.findByDisplayValue(customConfig.defaultPythonRuntimeUrl)).toBeTruthy();
  });
});
