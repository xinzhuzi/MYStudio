// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SClassGenerationModeToggle } from "./sclass-generation-mode-toggle";

afterEach(cleanup);

function baseProps() {
  return {
    generationMode: "group" as const,
    groupCount: 2,
    sceneCount: 5,
    isBatchCalibrationDisabled: false,
    onGenerationModeChange: vi.fn(),
    onBatchCalibrate: vi.fn(),
    onRegroup: vi.fn(),
  };
}

describe("SClassGenerationModeToggle", () => {
  it("renders group controls and delegates group, calibration, and regroup actions", () => {
    const props = baseProps();
    render(<SClassGenerationModeToggle {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "单镜生成 (5 镜)" }));
    fireEvent.click(screen.getByRole("button", { name: "批量校准" }));
    fireEvent.click(screen.getByRole("button", { name: "重新分组" }));

    expect(props.onGenerationModeChange).toHaveBeenCalledWith("single");
    expect(props.onBatchCalibrate).toHaveBeenCalledOnce();
    expect(props.onRegroup).toHaveBeenCalledOnce();
  });

  it("keeps the calibration action disabled when the controller requires it", () => {
    const props = baseProps();
    render(<SClassGenerationModeToggle {...props} isBatchCalibrationDisabled />);

    expect((screen.getByRole("button", { name: "批量校准" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("hides group-only controls in single-scene mode", () => {
    const props = baseProps();
    render(<SClassGenerationModeToggle {...props} generationMode="single" />);

    expect(screen.queryByRole("button", { name: "批量校准" })).toBeNull();
    expect(screen.queryByRole("button", { name: "重新分组" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "分组生成 (2 组)" }));
    expect(props.onGenerationModeChange).toHaveBeenCalledWith("group");
  });
});
