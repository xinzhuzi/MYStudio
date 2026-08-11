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
  cacheDir: "/tmp/TTS/runtime",
  pythonRuntimeDir: "/tmp/python",
  setupStage: "idle",
  defaultModelCacheDir: "/tmp/project-models",
  hfHubCacheDir: "/tmp/hf-models",
};

const baseCache: TtsModelCacheInfo = {
  path: "/tmp/models",
  download_path: "/tmp/models/download",
  scan_paths: ["/tmp/models", "/tmp/hf-models"],
};

function renderCard(overrides: Partial<Parameters<typeof LocalTtsRuntimeCard>[0]> = {}) {
  const onModelCacheDirChange = vi.fn();
  const onApplyModelCacheDir = vi.fn();
  const onSelectModelCacheDir = vi.fn();
  const onOpenModelCacheDir = vi.fn();
  const onResetModelCacheDir = vi.fn();
  const onManualRefresh = vi.fn();
  const onMigrateStorage = vi.fn();
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
      modelCacheDirty={false}
      migratingStorage={false}
      onModelCacheDirChange={onModelCacheDirChange}
      onApplyModelCacheDir={onApplyModelCacheDir}
      onSelectModelCacheDir={onSelectModelCacheDir}
      onOpenModelCacheDir={onOpenModelCacheDir}
      onResetModelCacheDir={onResetModelCacheDir}
      onMigrateStorage={onMigrateStorage}
      onManualRefresh={onManualRefresh}
      onStart={onStart}
      onStop={onStop}
      {...overrides}
    />,
  );
  return {
    ...result,
    onModelCacheDirChange,
    onApplyModelCacheDir,
    onSelectModelCacheDir,
    onOpenModelCacheDir,
    onResetModelCacheDir,
    onManualRefresh,
    onMigrateStorage,
    onStart,
    onStop,
  };
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

    fireEvent.click(screen.getByRole("button", { name: "刷新 TTS 状态" }));
    fireEvent.click(screen.getByRole("button", { name: "启动 TTS 后端服务" }));
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

    const startButton = screen.getByRole("button", { name: "启动 TTS 后端服务" });
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
        modelCacheDirty={false}
        migratingStorage={false}
        onModelCacheDirChange={() => undefined}
        onApplyModelCacheDir={() => undefined}
        onSelectModelCacheDir={onSelectModelCacheDir}
        onOpenModelCacheDir={() => undefined}
        onResetModelCacheDir={() => undefined}
        onMigrateStorage={() => undefined}
        onManualRefresh={() => undefined}
        onStart={onStart}
        onStop={() => undefined}
      />,
    );

    expect((screen.getByRole("button", { name: /选择模型目录/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("textbox", { name: "模型缓存安装路径" }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "恢复默认" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders the model installation path with save, open, and reset actions", () => {
    const {
      container,
      onModelCacheDirChange,
      onApplyModelCacheDir,
    } = renderCard({ draftModelCacheDir: "/tmp/custom", modelCacheDirty: true });

    const input = screen.getByRole("textbox", { name: "模型缓存安装路径" });
    expect((input as HTMLInputElement).value).toBe("/tmp/custom");
    expect(input.parentElement?.parentElement?.className).toContain("minmax(50%,1fr)");
    fireEvent.change(input, { target: { value: "/tmp/another-models" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(onModelCacheDirChange).toHaveBeenCalledWith("/tmp/another-models");
    expect(onApplyModelCacheDir).toHaveBeenCalledTimes(2);
    expect((screen.getByRole("button", { name: "打开" }) as HTMLButtonElement).disabled).toBe(true);
    expect(container.textContent).toContain("HF 缓存：");
    expect(container.textContent).toContain("/tmp/hf-models");
  });

  it("opens and restores the saved model cache path", () => {
    const { onOpenModelCacheDir, onResetModelCacheDir } = renderCard();

    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    fireEvent.click(screen.getByRole("button", { name: "恢复默认" }));

    expect(onOpenModelCacheDir).toHaveBeenCalledOnce();
    expect(onResetModelCacheDir).toHaveBeenCalledOnce();
  });

  it("renders the fixed TTS folder layout and wires the migration action", () => {
    const { onMigrateStorage } = renderCard({
      runtimeStatus: {
        ...baseStatus,
        storageLayout: {
          rootDir: "/data/TTS",
          runtimeDir: "/data/TTS/runtime",
          modelsDir: "/data/TTS/model",
          legacyRuntimeDir: "/data/tts-runtime",
          legacyModelsDir: "/data/tts-models",
          legacyDefaultModelsDir: "/data/TTS/models",
          legacyHuggingFaceHubDir: "/Users/test/.cache/huggingface/hub",
          legacyRuntimeExists: true,
          legacyModelsExists: true,
          legacyDefaultModelsExists: false,
          legacyHuggingFaceHubExists: true,
          migrationState: "ready",
          migrationMessage: "检测到旧版 TTS 数据，可迁移到 TTS 文件夹。",
        },
      },
    });

    expect(screen.getByText("TTS 文件夹")).toBeTruthy();
    expect(screen.getByText("/data/TTS/runtime")).toBeTruthy();
    expect(screen.getByText("/data/TTS/model")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "迁移到 TTS 文件夹" }));
    expect(onMigrateStorage).toHaveBeenCalledOnce();
  });
});
