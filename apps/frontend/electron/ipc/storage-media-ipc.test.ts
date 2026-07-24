import { beforeEach, describe, expect, it, vi } from "vitest";

const registrations = vi.hoisted(() => ({
  local: vi.fn(),
  image: vi.fn(),
  file: vi.fn(),
}));

vi.mock("./local-media-ipc", () => ({ registerLocalMediaIpcHandlers: registrations.local }));
vi.mock("./image-host-ipc", () => ({ registerImageHostIpcHandlers: registrations.image }));
vi.mock("./file-storage-ipc", () => ({ registerFileStorageIpcHandlers: registrations.file }));

import { registerStorageMediaIpcHandlers } from "./storage-media-ipc";

describe("registerStorageMediaIpcHandlers", () => {
  beforeEach(() => {
    registrations.local.mockReset();
    registrations.image.mockReset();
    registrations.file.mockReset();
  });

  it("delegates the established storage/media registrations with injected dependencies", () => {
    const context = {
      getDataDir: vi.fn(() => "/data"),
      getMediaRoot: vi.fn(() => "/media"),
      createOperationId: vi.fn((prefix: string) => `${prefix}-1`),
      writeDiagnosticsLog: vi.fn(),
      readImageSource: vi.fn(),
    };

    registerStorageMediaIpcHandlers(context);

    expect(registrations.local).toHaveBeenCalledWith({ getMediaRoot: context.getMediaRoot });
    expect(registrations.image).toHaveBeenCalledWith({
      createOperationId: expect.any(Function),
      writeDiagnosticsLog: context.writeDiagnosticsLog,
      readImageSource: context.readImageSource,
    });
    expect(registrations.image.mock.calls[0][0].createOperationId()).toBe("image-host-1");
    expect(registrations.file).toHaveBeenCalledWith({ getDataDir: context.getDataDir });
  });
});
