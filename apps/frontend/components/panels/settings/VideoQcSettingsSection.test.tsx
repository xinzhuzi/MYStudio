// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoQcSettingsSection } from "./VideoQcSettingsSection";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const INVENTORY = {
  cacheDir: "/storage/comfyui/models/videoqc",
  models: [
    { name: "dover-mobile", label: "DOVER-Mobile 观感评分", downloaded: true, sizeMb: 41, pinned: false },
    { name: "yunet-face", label: "YuNet 人脸检测", downloaded: false, sizeMb: 1, pinned: false },
  ],
};

const readyStatus = {
  state: "ready",
  setupStage: "ready",
  modelReady: true,
  downloadStatus: "idle",
  downloadProgress: 0,
  downloadError: undefined,
  modelCacheDir: INVENTORY.cacheDir,
} as const;

function makeBridge(status: Record<string, unknown> = { ...readyStatus }) {
  const bridge = {
    probe: vi.fn().mockResolvedValue(status),
    status: vi.fn().mockResolvedValue(status),
    setup: vi.fn().mockResolvedValue(status),
    refresh: vi.fn().mockResolvedValue(status),
    scanModel: vi.fn().mockResolvedValue(INVENTORY),
    downloadModel: vi.fn().mockResolvedValue({ accepted: false, message: "下载已在进行中" }),
    downloadProgress: vi.fn().mockResolvedValue({ status: "idle", progress: 0, current: 0, total: 0 }),
    getConfig: vi.fn().mockResolvedValue({ modelCacheDir: INVENTORY.cacheDir }),
    setModelCacheDir: vi.fn(),
    deleteModel: vi.fn().mockResolvedValue({ success: true }),
  };
  Object.defineProperty(window, "videoQcRuntime", { configurable: true, value: bridge });
  return bridge;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "videoQcRuntime", { configurable: true, value: undefined });
});

describe("VideoQcSettingsSection 逐模型行(1102 YuNet 接入)", () => {
  it("清单以 Python 侧为真源:YuNet 单独一行,DOVER 不在行里重复", async () => {
    makeBridge();
    render(<VideoQcSettingsSection embedded />);

    await waitFor(() => expect(screen.getByText("YuNet 人脸检测")).toBeTruthy());
    expect(screen.getByText("未下载")).toBeTruthy();
    // DOVER 由主状态条 + 主按钮承载;extraModels 过滤掉 dover-mobile,免得同一个模型出现两套控件
    expect(screen.queryByText("DOVER-Mobile 观感评分")).toBeNull();
    expect(screen.getAllByRole("button", { name: "已下载" })).toHaveLength(1);
  });

  it("点 YuNet 行的下载按钮 → 模型名原样进桥(不是硬编码 dover-mobile)", async () => {
    const bridge = makeBridge();
    render(<VideoQcSettingsSection embedded />);
    await waitFor(() => expect(screen.getByText("YuNet 人脸检测")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "下载 YuNet 人脸检测" }));

    await waitFor(() => expect(bridge.downloadModel).toHaveBeenCalledWith("yunet-face"));
    // 主按钮那条路仍走 dover-mobile,两者互不串
    expect(bridge.downloadModel).not.toHaveBeenCalledWith("dover-mobile");
  });

  it("运行时未就绪 → YuNet 下载按钮禁用(下载政策仍要求显式动作,但不许在坏运行时上发起)", async () => {
    makeBridge({ ...readyStatus, state: "needs-runtime", modelReady: false });
    render(<VideoQcSettingsSection embedded />);
    await waitFor(() => expect(screen.getByText("YuNet 人脸检测")).toBeTruthy());

    expect((screen.getByRole("button", { name: "下载 YuNet 人脸检测" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("已下载 → 出删除按钮,删除后重扫清单", async () => {
    const bridge = makeBridge();
    bridge.scanModel.mockResolvedValue({
      ...INVENTORY,
      models: INVENTORY.models.map((model) => (model.name === "yunet-face" ? { ...model, downloaded: true } : model)),
    });
    render(<VideoQcSettingsSection embedded />);
    await waitFor(() => expect(screen.getByText("YuNet 人脸检测")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "删除 YuNet 人脸检测" }));

    await waitFor(() => expect(bridge.deleteModel).toHaveBeenCalledWith("yunet-face"));
    await waitFor(() => expect(bridge.scanModel.mock.calls.length).toBeGreaterThan(1));
    expect(screen.getByText("已下载 1MB")).toBeTruthy();
  });
});
