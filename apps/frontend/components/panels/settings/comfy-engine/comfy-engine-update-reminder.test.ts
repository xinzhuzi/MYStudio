// ComfyUI 启动更新提醒链测试(09-08 集成,Q10 裁定):静默检查、
// 未安装不打扰、有新版 toast+直达设置分区、失败静默。

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  REVEAL_SETTINGS_SECTION_EVENT,
  consumePendingRevealSection,
  openSettingsSection,
  remindComfyEngineUpdateOnce,
} from "./comfy-engine-update-reminder";
import type { ComfyEngineClient } from "./comfy-engine-contract";
import { useMediaPanelStore } from "@/stores/navigation/media-panel-store";

const toasts = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

function fakeClient(overrides: Partial<ComfyEngineClient> = {}): ComfyEngineClient {
  return {
    getEngineStatus: vi.fn().mockResolvedValue({
      installed: true,
      version: "v0.34.0",
      latest: null,
      state: "ready",
      port: 17600,
      modelsDir: null,
      defaultModelsDir: null,
      serviceRunning: false,
      pluginCount: 0,
      updateAvailable: false,
      message: null,
      installDir: null,
    }),
    checkUpdate: vi.fn().mockResolvedValue({
      current: "v0.34.0",
      latest: "v0.34.5",
      updateAvailable: true,
    }),
    ...overrides,
  } as ComfyEngineClient;
}

beforeEach(() => {
  useMediaPanelStore.getState().clearSettingsTabRequest();
  toasts.info.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as { comfyEngine?: unknown }).comfyEngine;
});

describe("remindComfyEngineUpdateOnce", () => {
  it("引擎已装且有新版 → toast 提醒(带当前/最新版描述)", async () => {
    (window as { comfyEngine?: unknown }).comfyEngine = fakeClient();
    await remindComfyEngineUpdateOnce();
    expect(toasts.info).toHaveBeenCalledWith(
      "ComfyUI 引擎有新版本",
      expect.objectContaining({ description: expect.stringContaining("v0.34.5") }),
    );
  });

  it("未安装引擎 → 不提醒不查更新", async () => {
    const client = fakeClient();
    (window as { comfyEngine?: unknown }).comfyEngine = client;
    vi.mocked(client.getEngineStatus).mockResolvedValue({
      ...(await client.getEngineStatus()),
      installed: false,
    });
    await remindComfyEngineUpdateOnce();
    expect(toasts.info).not.toHaveBeenCalled();
    expect(client.checkUpdate).not.toHaveBeenCalled();
  });

  it("status 已带 updateAvailable → 不再重复 checkUpdate", async () => {
    const client = fakeClient();
    (window as { comfyEngine?: unknown }).comfyEngine = client;
    vi.mocked(client.getEngineStatus).mockResolvedValue({
      ...(await client.getEngineStatus()),
      updateAvailable: true,
      latest: "v0.35.0",
    });
    await remindComfyEngineUpdateOnce();
    expect(client.checkUpdate).not.toHaveBeenCalled();
    expect(toasts.info).toHaveBeenCalled();
  });

  it("检查失败 → 静默(无 toast、异常不上抛)", async () => {
    (window as { comfyEngine?: unknown }).comfyEngine = fakeClient({
      getEngineStatus: vi.fn().mockRejectedValue(new Error("无法连接本地生图服务")),
    });
    await expect(remindComfyEngineUpdateOnce()).resolves.toBeUndefined();
    expect(toasts.info).not.toHaveBeenCalled();
  });

  it("无桥(网页/jsdom)→ 直接罢手", async () => {
    await expect(remindComfyEngineUpdateOnce()).resolves.toBeUndefined();
    expect(toasts.info).not.toHaveBeenCalled();
  });
});

describe("openSettingsSection(直达设置分区)", () => {
  it("切设置页 + 请求 plugins 分页 + 广播/挂起展开 comfy-engine 分区", () => {
    openSettingsSection("comfy-engine");
    const state = useMediaPanelStore.getState();
    expect(state.activeTab).toBe("settings");
    expect(state.settingsTabRequest).toBe("plugins");
    expect(consumePendingRevealSection()).toEqual({ sectionId: "comfy-engine" });
    expect(consumePendingRevealSection()).toBeNull(); // 消费一次即清
  });

  it("带 tab 深链(09-09 去更新直落更新页):事件 detail 与挂起值都携带目标页", () => {
    let eventDetail: { sectionId?: string; tab?: string } | null = null;
    const onReveal = (event: Event) => {
      eventDetail = (event as CustomEvent<{ sectionId?: string; tab?: string }>).detail;
    };
    window.addEventListener(REVEAL_SETTINGS_SECTION_EVENT, onReveal);
    try {
      openSettingsSection("comfy-engine", "update");
    } finally {
      window.removeEventListener(REVEAL_SETTINGS_SECTION_EVENT, onReveal);
    }
    expect(eventDetail).toEqual({ sectionId: "comfy-engine", tab: "update" });
    expect(consumePendingRevealSection()).toEqual({ sectionId: "comfy-engine", tab: "update" });
  });
});
