// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StoryboardScenesTabs } from "./storyboard-scenes-tabs";

vi.mock("@/components/ui/tabs", () => {
  let onValueChange: ((value: string) => void) | undefined;
  return {
    Tabs: ({ children, onValueChange: handleValueChange }: {
      children: ReactNode;
      onValueChange: (value: string) => void;
    }) => {
      onValueChange = handleValueChange;
      return <div>{children}</div>;
    },
    TabsList: ({ children }: { children: ReactNode }) => <div role="tablist">{children}</div>,
    TabsTrigger: ({ children, value }: { children: ReactNode; value: string }) => (
      <button type="button" role="tab" onClick={() => onValueChange?.(value)}>{children}</button>
    ),
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("StoryboardScenesTabs", () => {
  it("renders editing and trailer tabs with the trailer count", () => {
    render(<StoryboardScenesTabs activeTab="editing" trailerCount={2} onActiveTabChange={vi.fn()} />);

    expect(screen.getByRole("tab", { name: "分镜编辑" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "预告片 (2)" })).toBeTruthy();
  });

  it("hides an empty trailer count and delegates tab changes", () => {
    const onActiveTabChange = vi.fn();
    render(<StoryboardScenesTabs activeTab="editing" trailerCount={0} onActiveTabChange={onActiveTabChange} />);

    fireEvent.click(screen.getByRole("tab", { name: "预告片" }));

    expect(onActiveTabChange).toHaveBeenCalledWith("trailer");
  });
});
