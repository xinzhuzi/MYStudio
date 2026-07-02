import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  API_MANAGER_SECTIONS,
  API_SERVICE_SUMMARY_FIELDS,
  DEFAULT_SETTINGS_TAB,
  SETTINGS_TABS,
  buildProviderAdapterTemplate,
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

  it("keeps low-level provider internals out of the service workspace", () => {
    expect(API_SERVICE_SUMMARY_FIELDS).toEqual(["Base URL", "接口协议", "API Key"]);
    expect(API_SERVICE_SUMMARY_FIELDS).not.toContain("供应商 ID");
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
