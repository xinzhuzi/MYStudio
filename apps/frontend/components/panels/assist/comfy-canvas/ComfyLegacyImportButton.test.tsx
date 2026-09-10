// @vitest-environment jsdom
// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const migrateMock = vi.fn(() => Promise.resolve({ total: 3, imported: 3, failed: 0 }));
vi.mock("@/lib/assist/image-studio/workflow-migrate-batch", () => ({
  migrateWorkflowsToLibraryWithToast: () => migrateMock(),
}));

let legacyFlows: unknown[] = [];
vi.mock("@/stores/studio/studio-store", () => ({
  useStudioStore: (selector: (state: { imageWorkflows: unknown[] }) => unknown) =>
    selector({ imageWorkflows: legacyFlows }),
}));

import { ComfyLegacyImportButton } from "./ComfyLegacyImportButton";

describe("ComfyLegacyImportButton(共享存量迁移入口)", () => {
  beforeEach(() => {
    legacyFlows = [];
    migrateMock.mockClear();
    migrateMock.mockResolvedValue({ total: 3, imported: 3, failed: 0 });
  });
  afterEach(cleanup);

  it("有存量流:点击跑迁移批并复位", async () => {
    legacyFlows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    render(<ComfyLegacyImportButton />);
    fireEvent.click(document.querySelector("[data-comfy-swap-migrate]")!);
    expect(migrateMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.querySelector("[data-comfy-swap-migrate]")!.textContent).toContain("导入存量画布(3)"));
  });

  it("零存量流:不渲染", () => {
    const { container } = render(<ComfyLegacyImportButton />);
    expect(container.querySelector("[data-comfy-swap-migrate]")).toBeNull();
  });
});
