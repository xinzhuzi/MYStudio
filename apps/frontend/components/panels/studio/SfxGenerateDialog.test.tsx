// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { SfxGenerateDialog } from "./SfxGenerateDialog";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

type StatusFn = () => Promise<unknown>;
type GenerateFn = (payload: { prompt: string; seed?: number; seconds?: number; outputDir: string }) => Promise<unknown>;

function installBridge(status: StatusFn, generate: GenerateFn) {
  Object.defineProperty(window, "sfxGenRuntime", {
    value: { status, generate },
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "sfxGenRuntime");
  vi.restoreAllMocks();
});

function readyStatus() {
  return Promise.resolve({
    setupStage: "ready",
    setupMessage: undefined,
    models: [{ modelName: "sfx-musicgen-small", label: "音效生成", downloaded: true, sizeMb: 2000, repoId: "facebook/musicgen-small", enabled: true }],
    downloadStatus: "idle",
    downloadProgress: 0,
    downloadError: undefined,
  });
}

describe("SfxGenerateDialog", () => {
  it("生成成功 → 以 prompt+seed+时长调用 generate 并把产物路径交给绑定回调", async () => {
    const generate = vi.fn(async () => ({ status: "accepted", outputPath: "/exports/sfx-1.wav" }));
    installBridge(readyStatus, generate as never);
    const onGenerated = vi.fn(async () => undefined);
    const onOpenChange = vi.fn();

    render(<SfxGenerateDialog open shotLabel="#3" onOpenChange={onOpenChange} onGenerated={onGenerated} />);
    fireEvent.change(screen.getByLabelText("音效描述"), { target: { value: "金属撞击声,清脆短促" } });
    fireEvent.change(screen.getByLabelText("种子"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: /生成并绑定/ }));

    await waitFor(() => expect(onGenerated).toHaveBeenCalledWith("/exports/sfx-1.wav"));
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "金属撞击声,清脆短促",
      seed: 7,
      outputDir: "__APP_EXPORTS__",
    }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("模型未下载 → fail-closed,不调 generate、不绑定,弹去设置 toast", async () => {
    const missingStatus = () => Promise.resolve({
      setupStage: "ready",
      setupMessage: undefined,
      models: [{ modelName: "sfx-musicgen-small", label: "音效生成", downloaded: false, sizeMb: null, repoId: "facebook/musicgen-small", enabled: true }],
      downloadStatus: "idle",
      downloadProgress: 0,
      downloadError: undefined,
    });
    const generate = vi.fn();
    installBridge(missingStatus as never, generate as never);
    const onGenerated = vi.fn();

    render(<SfxGenerateDialog open shotLabel="#1" onOpenChange={vi.fn()} onGenerated={onGenerated} />);
    fireEvent.click(screen.getByRole("button", { name: /生成并绑定/ }));

    await waitFor(() => expect(vi.mocked(toast.error).mock.calls.some((call) => String(call[0]).includes("音效模型未下载"))).toBe(true));
    expect(generate).not.toHaveBeenCalled();
    expect(onGenerated).not.toHaveBeenCalled();
  });

  it("时长钳制:超上限按 5s 下发", async () => {
    const generate = vi.fn(async () => ({ status: "accepted", outputPath: "/exports/sfx-2.wav" }));
    installBridge(readyStatus, generate as never);

    render(<SfxGenerateDialog open shotLabel="#2" onOpenChange={vi.fn()} onGenerated={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("秒数"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: /生成并绑定/ }));

    await waitFor(() => expect(generate).toHaveBeenCalledWith(expect.objectContaining({ seconds: 5 })));
  });

  it("种子非法 → 前端拦截不发起生成", async () => {
    const generate = vi.fn();
    installBridge(readyStatus, generate as never);

    render(<SfxGenerateDialog open shotLabel="#4" onOpenChange={vi.fn()} onGenerated={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("种子"), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: /生成并绑定/ }));

    await waitFor(() => expect(vi.mocked(toast.error).mock.calls.some((call) => String(call[0]).includes("种子必须是整数"))).toBe(true));
    expect(generate).not.toHaveBeenCalled();
  });
});
