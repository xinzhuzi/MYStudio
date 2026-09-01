// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SeedVr2ProbeResultV1 } from "@rendering/contracts/seedvr2-restore";
import { SeedVr2SettingsSection, seedVr2PillOf, useSeedVr2Probe } from "./SeedVr2SettingsSection";

const probeResult: SeedVr2ProbeResultV1 = {
  schemaVersion: 1,
  serviceUp: true,
  comfyuiUrl: "http://127.0.0.1:17598",
  modelFile: "/Users/x/Project/ComfyUI/models/SEEDVR2/seedvr2_7b_sharp_fp8_e4m3fn.safetensors",
  modelPresent: true,
  modelBytes: 8240979248,
};

function mountBridge(result: SeedVr2ProbeResultV1) {
  (window as { seedvr2Restore?: unknown }).seedvr2Restore = {
    probe: vi.fn(async () => result),
  };
}

/** Harness:hook 与展示同渲染树,探测完成后自动重渲染(避免快照固化)。 */
function Harness() {
  const state = useSeedVr2Probe();
  return <SeedVr2SettingsSection state={state} />;
}

afterEach(() => {
  cleanup();
  delete (window as { seedvr2Restore?: unknown }).seedvr2Restore;
});

describe("SeedVr2SettingsSection(模型可见性铁律)", () => {
  it("模型在+服务跑:展示模型大小/路径/服务状态/使用说明", async () => {
    mountBridge(probeResult);
    render(<Harness />);
    await waitFor(() => expect(screen.getByText(/模型已就绪/)).toBeTruthy());
    expect(screen.getByText(/7\.7 GB/)).toBeTruthy();
    expect(screen.getByText((content, element) =>
      element?.tagName === "SPAN" && content === "ComfyUI 运行中") as HTMLElement).toBeTruthy();
    expect(screen.getByDisplayValue(/seedvr2_7b_sharp_fp8_e4m3fn\.safetensors$/)).toBeTruthy();
    expect(screen.getByText(/SeedVR2 模型修复/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /复制/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /打开/ })).toBeTruthy();
  });

  it("模型缺:展示未找到提示", async () => {
    mountBridge({ ...probeResult, modelPresent: false, modelBytes: null, serviceUp: false });
    render(<Harness />);
    await waitFor(() => expect(screen.getByText(/模型未找到/)).toBeTruthy());
  });

  it("胶囊映射:ready/needs-runtime/model-missing/checking/unsupported", () => {
    expect(seedVr2PillOf(probeResult, true)).toBe("ready");
    expect(seedVr2PillOf({ ...probeResult, serviceUp: false }, true)).toBe("needs-runtime");
    expect(seedVr2PillOf({ ...probeResult, modelPresent: false }, true)).toBe("model-missing");
    expect(seedVr2PillOf(null, true)).toBe("checking");
    expect(seedVr2PillOf(null, false)).toBe("unsupported");
  });
});
