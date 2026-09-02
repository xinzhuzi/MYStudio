// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// @vitest-environment jsdom
import { fireEvent, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/panels/assist/ModelSelector", () => ({
  ModelSelector: ({ value }: { value: string }) => (
    <select data-testid="model-selector" value={value} disabled>
      <option value={value}>{value || "默认模型"}</option>
    </select>
  ),
}));

import { ImageStudio } from "./ImageStudio";
import { useFreedomStore } from "@/stores/assist/freedom-store";
import { useImageStudioStore } from "@/stores/assist/image-studio-store";

(globalThis as any).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
(globalThis as any).matchMedia ??= () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});

const initialFreedomState = useFreedomStore.getState();
const initialStudioState = useImageStudioStore.getState();

afterEach(() => {
  cleanup();
  useFreedomStore.setState(initialFreedomState, true);
  useImageStudioStore.setState(initialStudioState, true);
  localStorage.clear();
});

describe("ImageStudio(画布宿主)", () => {
  it("08-31 画布化:首帧装载后呈现工具栏与默认画布", async () => {
    render(<ImageStudio />);
    // rAF 首帧门闸:装载文案先出现,随后画布接管
    await waitFor(
      () => {
        expect(screen.getByRole("button", { name: /添加节点/ })).toBeTruthy();
      },
      { timeout: 3000 },
    );
    fireEvent.keyDown(screen.getByRole("button", { name: /添加节点/ }), { key: "Enter" });
    await waitFor(
      () => {
        expect(screen.getByRole("menuitem", { name: /^文生图/ })).toBeTruthy();
      },
      { timeout: 3000 },
    );
    await waitFor(() => {
      expect(useImageStudioStore.getState().workflows.length).toBeGreaterThanOrEqual(1);
    });
  });
});
