// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
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
    expect((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("暂无安装记录。点击开始配置后会显示 Python 运行环境和 TTS 依赖明细。")).toBeTruthy();
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
          label: "TTS 依赖",
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

    expect(await screen.findByDisplayValue("/project-storage/python")).toBeTruthy();
    expect(screen.getByDisplayValue("https://mirror.example/python.tar.zst")).toBeTruthy();
    expect(screen.getByText("TTS 依赖")).toBeTruthy();
    expect(screen.getByText("已存在")).toBeTruthy();
    expect(screen.getAllByText("/project-storage/python/bin/python3").length).toBeGreaterThan(0);
  });
});
