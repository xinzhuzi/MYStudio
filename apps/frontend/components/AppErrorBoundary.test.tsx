// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "./AppErrorBoundary";

function BrokenPanel() {
  throw new Error("panel render failed");
  return null;
}

describe("AppErrorBoundary", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders a dark recovery panel instead of leaving a blank screen", () => {
    render(
      <AppErrorBoundary>
        <BrokenPanel />
      </AppErrorBoundary>,
    );

    expect(screen.getByText("界面加载异常")).toBeTruthy();
    expect(screen.getByText("panel render failed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重新加载" })).toBeTruthy();
  });
});
