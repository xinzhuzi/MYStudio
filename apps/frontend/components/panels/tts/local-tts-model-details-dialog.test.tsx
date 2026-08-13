// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TtsModelRow } from "@/types/tts";
import { LocalTtsModelDetailsDialog } from "./LocalTtsModelDetailsDialog";

afterEach(cleanup);

const model: TtsModelRow = {
  modelName: "test-model",
  displayName: "测试模型",
  engine: "qwen",
  hfRepoId: "example/test-model",
  sizeMb: 100,
  languages: ["zh"],
  purpose: "presetVoice",
  description: "测试模型",
  downloaded: false,
  downloading: false,
  loaded: false,
};

function renderDialog(selectedState: "missing" | "failed" | "downloading" | "downloaded" | "loaded") {
  return render(
    <LocalTtsModelDetailsDialog
      selectedModel={{
        ...model,
        downloaded: selectedState === "downloaded" || selectedState === "loaded",
        loaded: selectedState === "loaded",
      }}
      selectedState={selectedState}
      runtimeRunning
      onOpenChange={vi.fn()}
      onCancel={vi.fn()}
      onDownload={vi.fn()}
      onUnload={vi.fn()}
      onDelete={vi.fn()}
    />,
  );
}

describe("LocalTtsModelDetailsDialog", () => {
  it("does not show unload or delete actions for a missing model", () => {
    renderDialog("missing");

    expect(screen.getByRole("button", { name: "下载" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "卸载" })).toBeNull();
    expect(screen.queryByRole("button", { name: "删除" })).toBeNull();
  });

  it("shows delete for downloaded data and unload only for a loaded model", () => {
    const { rerender } = renderDialog("downloaded");
    expect(screen.queryByRole("button", { name: "卸载" })).toBeNull();
    expect(screen.getByRole("button", { name: "删除" })).toBeTruthy();

    rerender(
      <LocalTtsModelDetailsDialog
        selectedModel={{ ...model, downloaded: true, loaded: true }}
        selectedState="loaded"
        runtimeRunning
        onOpenChange={vi.fn()}
        onCancel={vi.fn()}
        onDownload={vi.fn()}
        onUnload={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "卸载" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "删除" })).toBeTruthy();
  });
});
