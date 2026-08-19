// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MusicTab } from "./MusicTab";
import type { Music3GenRuntimeStatus } from "@/types/music3-gen";

function readyStatus(): Music3GenRuntimeStatus {
  return {
    setupStage: "ready",
    setupMessage: undefined,
    models: [],
    downloadStatus: "idle",
    downloadProgress: 0,
    downloadError: undefined,
    hostTotalRamGb: 128,
    mlxServ: {
      config: { weightsDir: "/w", binaryPath: "", port: 11273, preferredEngine: "mlxserv" },
      weightsReady: true,
      weightsReason: "",
      binaryPath: "/b/mlx-serve",
      binaryFound: true,
      serverRunning: false,
      serverStarting: false,
    },
  };
}

function installBridge(overrides: {
  status?: () => Music3GenRuntimeStatus | Promise<Music3GenRuntimeStatus>;
  musicDir?: (projectId: string) => Promise<{ dir?: string; error?: string }>;
  generate?: (payload: Record<string, unknown>) => Promise<{ status: string; outputPath?: string; durationS?: number; engine?: string; message?: string }>;
} = {}) {
  (window as { music3GenRuntime?: unknown }).music3GenRuntime = {
    status: async () => (overrides.status ? await overrides.status() : readyStatus()),
    musicDir: overrides.musicDir ?? (async (projectId: string) => ({ dir: `/projects/${projectId}/music` })),
    generate: overrides.generate ?? (async () => ({ status: "accepted", outputPath: "/projects/ma/music/song.wav", durationS: 29.9, engine: "mlx-serve" })),
  };
}

afterEach(() => {
  cleanup();
  delete (window as { music3GenRuntime?: unknown }).music3GenRuntime;
});

describe("MusicTab(工作台音乐生成)", () => {
  it("就绪:展示生成目录(动态拼接)+ 表单", async () => {
    installBridge();
    render(<MusicTab projectId="ma" projectName="道劫" />);
    expect(await screen.findByText(/引擎就绪/)).toBeTruthy();
    expect(await screen.findByText("/projects/ma/music")).toBeTruthy();
    expect(await screen.findByRole("button", { name: /生成整曲/ })).toBeTruthy();
  });

  it("权重未就绪:fail-closed 引导去设置,不出表单", async () => {
    installBridge({
      status: () => ({ ...readyStatus(), mlxServ: { ...readyStatus().mlxServ!, weightsReady: false, weightsReason: "未指定权重目录" } }),
    });
    render(<MusicTab projectId="ma" projectName="道劫" />);
    expect(await screen.findByText(/去设置/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /生成整曲/ })).toBeNull();
  });

  it("生成:payload 带 __PROJECT_MUSIC__ 哨兵 + projectId(渲染层不持绝对路径)", async () => {
    const generate = vi.fn(async () => ({ status: "accepted", outputPath: "/projects/ma/music/song.wav", durationS: 29.9, engine: "mlx-serve" }));
    installBridge({ generate });
    render(<MusicTab projectId="ma" projectName="道劫" />);
    fireEvent.click(await screen.findByRole("button", { name: /生成整曲/ }));
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      outputDir: "__PROJECT_MUSIC__",
      projectId: "ma",
      engine: "mlxserv",
    }));
    // 产物列表出现
    expect(await screen.findByText(/29\.9s/)).toBeTruthy();
  });
});
