// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalTtsRuntimeCard } from "./LocalTtsRuntimeCard";
import type { TtsModelCacheInfo, TtsRuntimeStatus } from "@/types/tts";

afterEach(cleanup);

const baseStatus: TtsRuntimeStatus = {
  running: false,
  installed: true,
  managed: true,
  port: 17593,
  baseUrl: "http://127.0.0.1:17593",
  cacheDir: "/tmp/tts-runtime",
  pythonRuntimeDir: "/tmp/python",
  setupStage: "idle",
  defaultModelCacheDir: "/tmp/project-models",
  systemModelCacheDir: "/tmp/hf-models",
};

const baseCache: TtsModelCacheInfo = {
  path: "/tmp/models",
  download_path: "/tmp/models/download",
  scan_paths: ["/tmp/models", "/tmp/hf-models"],
};

function renderCard(overrides: Partial<Parameters<typeof LocalTtsRuntimeCard>[0]> = {}) {
  const onSelectModelCacheDir = vi.fn();
  const onManualRefresh = vi.fn();
  const onStart = vi.fn();
  const onStop = vi.fn();
  const result = render(
    <LocalTtsRuntimeCard
      runtimeStatus={baseStatus}
      modelCacheInfo={baseCache}
      draftModelCacheDir="/tmp/models"
      starting={false}
      refreshing={false}
      applyingModelCacheDir={false}
      onSelectModelCacheDir={onSelectModelCacheDir}
      onManualRefresh={onManualRefresh}
      onStart={onStart}
      onStop={onStop}
      {...overrides}
    />,
  );
  return { ...result, onSelectModelCacheDir, onManualRefresh, onStart, onStop };
}

describe("LocalTtsRuntimeCard", () => {
  it("renders full-width runtime status rows without a port field", () => {
    const { container } = renderCard();

    expect(screen.getByText("本地 TTS")).toBeTruthy();
    expect(container.textContent).toContain("状态：");
    expect(container.textContent).toContain("已安装，未运行");
    expect(container.textContent).toContain("后端：");
    expect(container.textContent).toContain("http://127.0.0.1:17593");
    expect(container.textContent).toContain("扫描路径：");
    expect(container.textContent).toContain("/tmp/models；/tmp/hf-models");
    expect(container.textContent).not.toContain("端口：");
  });

  it("shows residual-process label when running but unmanaged", () => {
    renderCard({
      runtimeStatus: { ...baseStatus, running: true, managed: false },
    });

    expect(screen.getByText("运行中（残留进程）")).toBeTruthy();
    expect(screen.getByRole("button", { name: /停止/ })).toBeTruthy();
  });

  it("wires refresh / start / select-directory callbacks", () => {
    const { onManualRefresh, onStart, onSelectModelCacheDir } = renderCard();

    fireEvent.click(screen.getByRole("button", { name: /刷新/ }));
    fireEvent.click(screen.getByRole("button", { name: /启动/ }));
    fireEvent.click(screen.getByRole("button", { name: /选择模型目录/ }));

    expect(onManualRefresh).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onSelectModelCacheDir).toHaveBeenCalledTimes(1);
  });

  it("disables start while setup is active and disables directory pick while running", () => {
    const { rerender, onStart, onSelectModelCacheDir } = renderCard({
      runtimeStatus: { ...baseStatus, setupStage: "installing-deps", running: false },
      starting: false,
    });

    const startButton = screen.getByRole("button", { name: /启动/ });
    expect((startButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(startButton);
    expect(onStart).not.toHaveBeenCalled();

    rerender(
      <LocalTtsRuntimeCard
        runtimeStatus={{ ...baseStatus, running: true, managed: true }}
        modelCacheInfo={baseCache}
        draftModelCacheDir="/tmp/models"
        starting={false}
        refreshing={false}
        applyingModelCacheDir={false}
        onSelectModelCacheDir={onSelectModelCacheDir}
        onManualRefresh={() => undefined}
        onStart={onStart}
        onStop={() => undefined}
      />,
    );

    expect((screen.getByRole("button", { name: /选择模型目录/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows project and HF path hints when they differ from the draft dir", () => {
    const { container } = renderCard({ draftModelCacheDir: "/tmp/custom" });

    expect(container.textContent).toContain("当前路径：");
    expect(container.textContent).toContain("/tmp/custom");
    expect(container.textContent).toContain("项目路径：");
    expect(container.textContent).toContain("/tmp/project-models");
    expect(container.textContent).toContain("HF 路径：");
    expect(container.textContent).toContain("/tmp/hf-models");
  });
});
