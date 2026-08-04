// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddAssetDialog } from "./AddAssetDialog";

const { getStudioAssetsBridge, toastError } = vi.hoisted(() => ({
  getStudioAssetsBridge: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/bridge/studio-assets", () => ({ getStudioAssetsBridge }));
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AddAssetDialog", () => {
  it("selects an audio file and submits it as the asset source path", async () => {
    const selectAudioFile = vi.fn().mockResolvedValue("/音色库/木成-平静.wav");
    const add = vi.fn().mockResolvedValue({ id: "audio-1" });
    getStudioAssetsBridge.mockReturnValue({ selectAudioFile, add });

    render(<AddAssetDialog type="audio" open onOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /点击选择音频文件/ }));
    await waitFor(() => expect(screen.getByText("/音色库/木成-平静.wav")).toBeTruthy());

    fireEvent.change(screen.getAllByRole("textbox")[0], {
      target: { value: "木成·平静·旁白" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^添加$/ }));

    await waitFor(() => expect(add).toHaveBeenCalledWith(expect.objectContaining({
      type: "audio",
      name: "木成·平静·旁白",
      sourceFilePath: "/音色库/木成-平静.wav",
    })));
    expect(selectAudioFile).toHaveBeenCalledTimes(1);
  });

  it("requires an audio file before submitting", async () => {
    const add = vi.fn().mockResolvedValue({ id: "audio-1" });
    getStudioAssetsBridge.mockReturnValue({ add });

    render(<AddAssetDialog type="audio" open onOpenChange={vi.fn()} />);

    fireEvent.change(screen.getAllByRole("textbox")[0], {
      target: { value: "未选择音频" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^添加$/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("请选择音频文件"));
    expect(add).not.toHaveBeenCalled();
  });

  it("clears the selected audio file when the dialog is canceled", async () => {
    const selectAudioFile = vi.fn().mockResolvedValue("/音色库/木成-平静.wav");
    const onOpenChange = vi.fn();
    getStudioAssetsBridge.mockReturnValue({ selectAudioFile });

    const view = render(<AddAssetDialog type="audio" open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: /点击选择音频文件/ }));
    await waitFor(() => expect(screen.getByText("/音色库/木成-平静.wav")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    view.rerender(<AddAssetDialog type="audio" open={false} onOpenChange={onOpenChange} />);
    view.rerender(<AddAssetDialog type="audio" open onOpenChange={onOpenChange} />);
    expect(screen.queryByText("/音色库/木成-平静.wav")).toBeNull();
    expect(screen.getByRole("button", { name: /点击选择音频文件/ })).toBeTruthy();
  });

  it("reports an audio file that becomes unreadable before submission", async () => {
    const selectAudioFile = vi.fn().mockResolvedValue("/音色库/已删除.wav");
    const add = vi.fn().mockRejectedValue(new Error("音频文件不存在或无法读取"));
    getStudioAssetsBridge.mockReturnValue({ selectAudioFile, add });

    render(<AddAssetDialog type="audio" open onOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /点击选择音频文件/ }));
    await waitFor(() => expect(screen.getByText("/音色库/已删除.wav")).toBeTruthy());
    fireEvent.change(screen.getAllByRole("textbox")[0], {
      target: { value: "失效音频" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^添加$/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("添加失败，请确认音频文件仍可读取"));
  });
});
