import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("LocalTtsPanel select controls", () => {
  it("does not mount Radix Select in the standalone TTS page", () => {
    const source = readFileSync(new URL("./LocalTtsPanel.tsx", import.meta.url), "utf8");

    expect(source).toContain("function NativeTtsSelect");
    expect(source).not.toContain("@/components/ui/select");
    expect(source).not.toContain("<Select ");
    expect(source).not.toContain("<SelectContent");
  });

  it("keeps Zustand selectors referentially stable", () => {
    const source = readFileSync(new URL("./LocalTtsPanel.tsx", import.meta.url), "utf8");

    expect(source).not.toContain("Object.values(state.voiceProfiles)");
    expect(source).toContain("Object.values(voiceProfilesById)");
  });

  it("does not offer download actions for already cached models", () => {
    const source = readFileSync(new URL("./LocalTtsPanel.tsx", import.meta.url), "utf8");
    const downloadedCheckIndex = source.indexOf('if (row.downloaded) return "downloaded";');
    const progressErrorIndex = source.indexOf('if (progress?.status === "error") return "failed";');

    expect(source).toContain('state === "missing" || state === "failed"');
    expect(source).toContain("ModelStateLabel");
    expect(source).toContain("PendingScanLabel");
    expect(source).not.toContain("重新下载");
    expect(source).not.toContain("更新");
    expect(downloadedCheckIndex).toBeGreaterThan(-1);
    expect(progressErrorIndex).toBeGreaterThan(-1);
    expect(downloadedCheckIndex).toBeLessThan(progressErrorIndex);
    expect(source).toContain("rows.find((row) => row.modelName === current.modelName)");
  });

  it("renders runtime status as full-width rows without a duplicate port field", () => {
    const source = readFileSync(new URL("./LocalTtsPanel.tsx", import.meta.url), "utf8");

    expect(source).toContain("function RuntimeStatusLine");
    expect(source).toContain("break-all");
    expect(source).toContain("handleManualRefresh");
    expect(source).toContain("已刷新");
    expect(source).toContain("运行中（残留进程）");
    expect(source).toContain("delete next.runtime");
    expect(source).toContain('label="后端"');
    expect(source).toContain('label="扫描路径"');
    expect(source).not.toContain("端口：");
  });

  it("shows the selected model cache location in the details dialog", () => {
    const source = readFileSync(new URL("./LocalTtsPanel.tsx", import.meta.url), "utf8");

    expect(source).toContain("模型位置");
    expect(source).toContain("selectedModel.modelRepoPath");
    expect(source).toContain("selectedModel.modelCacheDir");
  });

  it("separates Python runtime setup progress from model downloads", () => {
    const source = readFileSync(new URL("./LocalTtsPanel.tsx", import.meta.url), "utf8");

    expect(source).toContain("RuntimeSetupProgress");
    expect(source).toContain("正在下载 Python 运行环境");
    expect(source).toContain("正在配置 Python 仓库");
    expect(source).toContain("正在安装 TTS 依赖");
    expect(source).toContain("本地 TTS 后端启动中");
    expect(source).toContain("runtimeSetupActive");
    expect(source).toContain("disabled={starting || runtimeSetupActive || runtimeStatus?.installed === false}");
  });

  it("keeps Python runtime configuration available in settings", () => {
    const settingsSource = readFileSync(new URL("../SettingsPanel.tsx", import.meta.url), "utf8");
    const tabsSource = readFileSync(new URL("../settings/SettingsTabsBar.tsx", import.meta.url), "utf8");
    const pythonSource = readFileSync(new URL("../settings/PythonSettingsTab.tsx", import.meta.url), "utf8");
    const hookSource = readFileSync(new URL("../settings/usePythonRuntimeSettings.ts", import.meta.url), "utf8");

    expect(tabsSource).toContain('value: "python"');
    expect(settingsSource).toContain("PythonSettingsTab");
    expect(pythonSource).toContain("Python 运行环境");
    expect(pythonSource).toContain("开始配置");
    expect(pythonSource).toContain("安装明细");
    expect(pythonSource).toContain("恢复默认下载源");
    expect(hookSource).toContain("pythonRuntimeUrlDraft");
    expect(hookSource).toContain("setTtsRuntimeConfig");
  });
});
