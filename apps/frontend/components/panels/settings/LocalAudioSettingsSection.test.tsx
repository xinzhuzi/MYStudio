// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalAudioSettingsSection } from "./LocalAudioSettingsSection";

/** 桥接 mock:默认「mlx-serve 权重未就绪」场景(下载块应出现)。 */
function installBridge(overrides: {
  status?: () => Record<string, unknown>;
  installWeights?: () => Promise<{ accepted: boolean; message: string }>;
} = {}) {
  const defaultStatus = () => ({
    setupStage: "ready",
    setupMessage: undefined,
    models: [],
    downloadStatus: "idle",
    downloadProgress: 0,
    downloadError: undefined,
    hostTotalRamGb: 128,
    mlxServ: {
      config: { weightsDir: "", binaryPath: "", port: 11273, preferredEngine: "pocket" },
      weightsReady: false,
      weightsReason: "未指定权重目录",
      binaryPath: null,
      binaryFound: true,
      serverRunning: false,
      serverStarting: false,
    },
    mlxServWeightsInstall: undefined,
  });
  (window as { music3GenRuntime?: unknown }).music3GenRuntime = {
    status: async () => (overrides.status ? overrides.status() : defaultStatus()),
    setup: async () => defaultStatus(),
    scanModel: async () => ({ models: [] }),
    downloadModel: async () => ({ accepted: true, message: "" }),
    configure: async () => ({}),
    installWeights: overrides.installWeights ?? (async () => ({ accepted: true, message: "已开始" })),
    generate: async () => ({ status: "blocked" }),
  };
}

afterEach(() => {
  cleanup();
  delete (window as { music3GenRuntime?: unknown }).music3GenRuntime;
});

describe("LocalAudioSettingsSection · mlx-serve bf16 权重获取 UI", () => {
  it("权重未就绪:显示「一键获取 bf16 权重」+ 内存提示(本机 128GB)", async () => {
    installBridge();
    render(<LocalAudioSettingsSection embedded />);
    expect(await screen.findByRole("button", { name: /一键获取 bf16 权重/ })).toBeTruthy();
    expect(await screen.findByText(/bf16 全精度,需 48GB\+ 内存\(本机 128GB\)/)).toBeTruthy();
  });

  it("下载中:按钮变「获取中…」禁用 + 进度文案可见", async () => {
    installBridge({
      status: () => ({
        setupStage: "ready",
        setupMessage: undefined,
        models: [],
        downloadStatus: "idle",
        downloadProgress: 0,
        downloadError: undefined,
        hostTotalRamGb: 128,
        mlxServ: {
          config: { weightsDir: "", binaryPath: "", port: 11273, preferredEngine: "pocket" },
          weightsReady: false,
          weightsReason: "未指定权重目录",
          binaryPath: null,
          binaryFound: true,
          serverRunning: false,
          serverStarting: false,
        },
        mlxServWeightsInstall: { status: "downloading", progress: 42, stage: "download" },
      }),
    });
    render(<LocalAudioSettingsSection embedded />);
    const button = await screen.findByRole("button", { name: /获取中…/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(await screen.findByText(/下载中 42%/)).toBeTruthy();
  });

  it("权重已就绪:下载块不出现(用户本机现状)", async () => {
    installBridge({
      status: () => ({
        setupStage: "ready",
        setupMessage: undefined,
        models: [],
        downloadStatus: "idle",
        downloadProgress: 0,
        downloadError: undefined,
        hostTotalRamGb: 128,
        mlxServ: {
          config: { weightsDir: "/Users/x/Project/Models/minimax-music3-mlx-bf16", binaryPath: "", port: 11273, preferredEngine: "mlxserv" },
          weightsReady: true,
          weightsReason: "",
          binaryPath: null,
          binaryFound: true,
          serverRunning: false,
          serverStarting: false,
        },
        mlxServWeightsInstall: undefined,
      }),
    });
    render(<LocalAudioSettingsSection embedded />);
    // 卡片显示就绪文案,获取按钮不出现
    expect(await screen.findByText(/权重完整/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /一键获取 bf16 权重/ })).toBeNull();
    // 模型行同步反映指向版就绪(而非误报「未下载」,08-28 修)
    expect(await screen.findByText(/已就绪\(指向版权重\)/)).toBeTruthy();
    expect(screen.queryByText(/未下载/)).toBeNull();
  });

  it("点击获取:调用 installWeights 桥接(无参)", async () => {
    const installWeights = vi.fn(async () => ({ accepted: true, message: "已开始" }));
    installBridge({ installWeights });
    render(<LocalAudioSettingsSection embedded />);
    fireEvent.click(await screen.findByRole("button", { name: /一键获取 bf16 权重/ }));
    await waitFor(() => expect(installWeights).toHaveBeenCalledTimes(1));
    expect(installWeights).toHaveBeenCalledWith();
  });
});
