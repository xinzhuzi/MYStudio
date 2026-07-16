import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  API_MANAGER_SECTIONS,
  API_SERVICE_SUMMARY_FIELDS,
  DEFAULT_SETTINGS_TAB,
  SETTINGS_TABS,
  buildProviderAdapterTemplate,
  filterModelsByFuzzyQuery,
  getPythonExecutableDisplayPath,
} from "./SettingsPanel";

describe("SettingsPanel navigation", () => {
  it("keeps the dashboard-style brand chrome available for standalone settings", () => {
    const settingsSource = readFileSync(
      fileURLToPath(new URL("./SettingsPanel.tsx", import.meta.url)),
      "utf8",
    );
    const layoutSource = readFileSync(
      fileURLToPath(new URL("../Layout.tsx", import.meta.url)),
      "utf8",
    );

    expect(settingsSource).toContain("showHomeChrome");
    expect(settingsSource).toContain("dashboard-topbar");
    expect(settingsSource).toContain("漫影工作室");
    expect(settingsSource).toContain("影像制片工作台");
    expect(layoutSource).toContain("showHomeChrome");
  });

  it("opens settings on the appearance tab by default", () => {
    expect(DEFAULT_SETTINGS_TAB).toBe("appearance");
    expect(SETTINGS_TABS[0]?.value).toBe("appearance");
  });

  it("keeps workflow configuration inside API management instead of a top-level tab", () => {
    const labels = SETTINGS_TABS.map((tab) => tab.label);
    expect(labels).not.toContain("工作流配置");
    expect(labels).not.toContain("本地 TTS");
    expect(labels).toEqual(expect.arrayContaining([
      "API 管理",
      "图片规格",
      "高级选项",
      "图床配置",
      "存储",
      "开发",
    ]));
  });

  it("uses Toonflow-style API manager sections", () => {
    expect(API_MANAGER_SECTIONS.map((section) => section.label)).toEqual([
      "模型服务",
      "模型映射",
      "Agent 配置",
    ]);
  });

  it("fuzzy-filters provider models by case-insensitive partial tokens", () => {
    const models = [
      "gpt-5.4",
      "gpt-image-2",
      "claude-opus-4-6-thinking",
      "stepfun-ai/step-3.7-flash",
    ];

    expect(filterModelsByFuzzyQuery(models, "GPT 5")).toEqual(["gpt-5.4"]);
    expect(filterModelsByFuzzyQuery(models, "step flash")).toEqual(["stepfun-ai/step-3.7-flash"]);
    expect(filterModelsByFuzzyQuery(models, "image")).toEqual(["gpt-image-2"]);
    expect(filterModelsByFuzzyQuery(models, "  ")).toEqual(models);
  });

  it("renders the provider model search input and filtered count", () => {
    const serviceSource = readFileSync(
      fileURLToPath(new URL("./settings/ApiServiceSettingsSection.tsx", import.meta.url)),
      "utf8",
    );

    expect(serviceSource).toContain('placeholder="模糊搜索模型名称，例如 gpt 5"');
    expect(serviceSource).toContain("filteredModels.length");
    expect(serviceSource).toContain("没有找到匹配");
  });


  it("shows the Python executable path from the runtime install details", () => {
    expect(getPythonExecutableDisplayPath({
      pythonRuntimeDir: "/project-storage/python",
      installedItems: [
        { label: "Python 运行环境", detail: "/project-storage/python/bin/python3", status: "installed" },
      ],
    })).toBe("/project-storage/python/bin/python3");

    expect(getPythonExecutableDisplayPath({
      pythonRuntimeDir: "/project-storage/python",
      installedItems: [],
    })).toBe("/project-storage/python/bin/python3");

    expect(getPythonExecutableDisplayPath({
      pythonRuntimeDir: "/project-storage/python",
      installedItems: [
        { label: "Python 运行环境", detail: "/project-storage/runtime/python/python/bin/python3", status: "installed" },
      ],
    })).toBe("/project-storage/python/bin/python3");
  });

  it("delegates Python runtime effects to the dedicated settings module", () => {
    const settingsSource = readFileSync(
      fileURLToPath(new URL("./SettingsPanel.tsx", import.meta.url)),
      "utf8",
    );
    const pythonSource = readFileSync(
      fileURLToPath(new URL("./settings/PythonSettingsTab.tsx", import.meta.url)),
      "utf8",
    );
    const hookSource = readFileSync(
      fileURLToPath(new URL("./settings/usePythonRuntimeSettings.ts", import.meta.url)),
      "utf8",
    );

    expect(settingsSource).toContain("<PythonSettingsTab />");
    expect(settingsSource).not.toContain("setupTtsRuntime");
    expect(pythonSource).toContain("usePythonRuntimeSettings");
    expect(hookSource).toContain("stopSetupPolling");
    expect(hookSource).toContain("window.clearInterval");
  });

  it("delegates storage and update effects to the dedicated settings module", () => {
    const settingsSource = readFileSync(
      fileURLToPath(new URL("./SettingsPanel.tsx", import.meta.url)),
      "utf8",
    );
    const storageSource = readFileSync(
      fileURLToPath(new URL("./settings/StorageSettingsTab.tsx", import.meta.url)),
      "utf8",
    );
    const hookSource = readFileSync(
      fileURLToPath(new URL("./settings/useStorageSettings.ts", import.meta.url)),
      "utf8",
    );

    expect(settingsSource).toContain("<StorageSettingsTab />");
    expect(settingsSource).not.toContain("window.storageManager");
    expect(storageSource).toContain("useStorageSettings");
    expect(hookSource).toContain("clearPersistedRendererCaches");
    expect(hookSource).toContain("checkForUpdates");
  });

  it("delegates image-host state and upload effects to the dedicated container", () => {
    const settingsSource = readFileSync(
      fileURLToPath(new URL("./SettingsPanel.tsx", import.meta.url)),
      "utf8",
    );
    const imageHostSource = readFileSync(
      fileURLToPath(new URL("./settings/ImageHostSettingsContainer.tsx", import.meta.url)),
      "utf8",
    );

    expect(settingsSource).toContain("<ImageHostSettingsContainer />");
    expect(settingsSource).not.toContain("uploadToImageHost");
    expect(settingsSource).not.toContain("testingImageHostId");
    expect(imageHostSource).toContain("uploadToImageHost");
    expect(imageHostSource).toContain("ImageHostSettingsTab");
    expect(imageHostSource).toContain("AddImageHostDialog");
    expect(imageHostSource).toContain("EditImageHostDialog");
  });

  it("keeps low-level provider internals out of the service workspace", () => {
    expect(API_SERVICE_SUMMARY_FIELDS).toEqual(["Base URL", "接口协议", "API Key"]);
    expect(API_SERVICE_SUMMARY_FIELDS).not.toContain("供应商 ID");
  });

  it("uses a single horizontal API manager notice bar", () => {
    const apiSource = readFileSync(
      fileURLToPath(new URL("./settings/ApiSettingsTab.tsx", import.meta.url)),
      "utf8",
    );

    expect(apiSource).toContain("api-manager-notice-bar");
    expect(apiSource).toContain("提示");
    expect(apiSource).toContain("添加供应商");
    expect(apiSource).not.toContain("安全说明");
  });

  it("keeps diagnostics log controls in the development settings tab", () => {
    const settingsSource = readFileSync(
      fileURLToPath(new URL("./SettingsPanel.tsx", import.meta.url)),
      "utf8",
    );
    const developmentSource = readFileSync(
      fileURLToPath(new URL("./settings/DevelopmentSettingsTab.tsx", import.meta.url)),
      "utf8",
    );
    const hookSource = readFileSync(
      fileURLToPath(new URL("./settings/useDevelopmentSettings.ts", import.meta.url)),
      "utf8",
    );

    expect(settingsSource).toContain("DevelopmentSettingsContainer");
    expect(developmentSource).toContain("诊断日志");
    expect(developmentSource).toContain("打开文件夹");
    expect(developmentSource).toContain("导出诊断包");
    expect(developmentSource).toContain("清理日志");
    expect(settingsSource).not.toContain("window.diagnosticsLog");
    expect(hookSource).toContain("window.diagnosticsLog.getInfo");
    expect(developmentSource).toContain("日志只保存在本机");
  });

  it("shows a dedicated image size settings tab with gpt-image presets", () => {
    const settingsSource = readFileSync(
      fileURLToPath(new URL("./SettingsPanel.tsx", import.meta.url)),
      "utf8",
    );
    const imageSizeSource = readFileSync(
      fileURLToPath(new URL("./settings/ImageSizeSettingsTab.tsx", import.meta.url)),
      "utf8",
    );

    expect(SETTINGS_TABS.map((tab) => tab.label)).toContain("图片规格");
    expect(settingsSource).toContain('TabsContent value="imageSize"');
    expect(settingsSource).toContain("ImageSizeSettingsTab");
    expect(imageSizeSource).toContain("GPT Image 规格矩阵");
    expect(imageSizeSource).toContain("GPT_IMAGE_SIZE_MAP");
    expect(imageSizeSource).toContain("getImageSizeLabel");
    expect(imageSizeSource).toContain("compatibilityRetryEnabled");
  });

  it("logs API model test clicks with an operation id before invoking IPC", () => {
    const settingsSource = readFileSync(
      fileURLToPath(new URL("./settings/ApiSettingsContainer.tsx", import.meta.url)),
      "utf8",
    );

    expect(settingsSource).toContain('createOperationId("model-test")');
    expect(settingsSource).toContain('message: "API model test clicked"');
    expect(settingsSource).toContain("operationId,");
    expect(settingsSource).toContain("window.electronAPI.testModel");
  });

  it("generates Toonflow-style safe provider adapter templates without promotional copy", () => {
    const code = buildProviderAdapterTemplate({
      id: "provider-1",
      platform: "openai-compatible",
      name: "OpenAI 兼容中转站",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      model: ["gpt-4o-mini", "gpt-image-1.5", "veo-test", "tts-test"],
    });

    expect(code).toContain("const vendor");
    expect(code).toContain("exports.vendor = vendor");
    expect(code).toContain("mystudio-vendor-json");
    expect(code).toContain('"baseUrl": "https://api.example.com/v1"');
    expect(code).toContain('"modelName": "gpt-image-1.5"');
    expect(code).toContain('"type": "image"');
    expect(code).toContain('"type": "video"');
    expect(code).toContain('"type": "tts"');
    expect(code).not.toMatch(/memefast|漫影API|赞助|广告|推广|推荐/i);
  });
});
