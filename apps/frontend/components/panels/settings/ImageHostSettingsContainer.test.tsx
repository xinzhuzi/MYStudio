// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImageHostProvider } from "@/stores/api-config-store";
import { useImageHostSettings } from "./ImageHostSettingsContainer";

const mocks = vi.hoisted(() => ({
  provider: { id: "host-1", name: "Host One" },
  upload: vi.fn(),
  add: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/image-host", () => ({ uploadToImageHost: mocks.upload }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock("@/stores/api-config-store", () => ({
  isVisibleImageHostProvider: () => true,
  useAPIConfigStore: () => ({
    imageHostProviders: [mocks.provider],
    addImageHostProvider: mocks.add,
    updateImageHostProvider: mocks.update,
    removeImageHostProvider: mocks.remove,
  }),
}));

const provider = mocks.provider as unknown as ImageHostProvider;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useImageHostSettings", () => {
  it("reports a successful connection and always clears testing state", async () => {
    mocks.upload.mockResolvedValue({ success: true, url: "https://image.test/1" });
    const { result } = renderHook(() => useImageHostSettings());

    await act(async () => result.current.testProvider(provider));

    expect(mocks.upload).toHaveBeenCalledWith(expect.stringContaining("data:image/gif;base64"), {
      expiration: 60,
      providerId: "host-1",
    });
    expect(mocks.success).toHaveBeenCalledWith("图床 Host One 连接测试成功");
    expect(result.current.testingProviderId).toBeNull();
  });

  it("reports provider and transport failures without leaving testing state", async () => {
    mocks.upload.mockResolvedValueOnce({ success: false, error: "denied" });
    const { result } = renderHook(() => useImageHostSettings());
    await act(async () => result.current.testProvider(provider));
    expect(mocks.error).toHaveBeenCalledWith("测试失败: denied");

    mocks.upload.mockRejectedValueOnce(new Error("offline"));
    await act(async () => result.current.testProvider(provider));
    expect(mocks.error).toHaveBeenCalledWith("连接测试失败，请检查网络");
    expect(result.current.testingProviderId).toBeNull();
  });

  it("keeps edit and delete actions owned by the image-host controller", () => {
    const { result } = renderHook(() => useImageHostSettings());
    act(() => result.current.editProvider(provider));
    expect(result.current.editingProvider).toBe(provider);
    expect(result.current.editOpen).toBe(true);

    act(() => result.current.deleteProvider("host-1"));
    expect(mocks.remove).toHaveBeenCalledWith("host-1");
    expect(mocks.success).toHaveBeenCalledWith("已删除图床");
  });
});
