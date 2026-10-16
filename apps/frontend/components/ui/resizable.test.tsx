// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "./resizable";

afterEach(cleanup);

describe("ResizableHandle separator orientation", () => {
  it.each([
    {
      direction: "horizontal" as const,
      separatorOrientation: "vertical",
      prefix: "",
      utilities: [
        "h-full",
        "w-2",
        "cursor-col-resize",
        "after:inset-y-0",
        "after:left-1/2",
        "after:w-px",
        "after:-translate-x-1/2",
      ],
    },
    {
      direction: "vertical" as const,
      separatorOrientation: "horizontal",
      prefix: "aria-[orientation=horizontal]:",
      utilities: [
        "h-2",
        "w-full",
        "cursor-row-resize",
        "after:inset-y-auto",
        "after:left-0",
        "after:top-1/2",
        "after:h-px",
        "after:w-full",
        "after:-translate-y-1/2",
        "after:translate-x-0",
      ],
    },
  ])(
    "uses a $separatorOrientation separator for a $direction group",
    ({ direction, separatorOrientation, prefix, utilities }) => {
      render(
        <ResizablePanelGroup direction={direction}>
          <ResizablePanel id="sidebar" defaultSize={25} minSize={10}>
            Sidebar
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel id="content" defaultSize={75}>
            Content
          </ResizablePanel>
        </ResizablePanelGroup>,
      );

      const separator = screen.getByRole("separator");
      expect(separator.getAttribute("aria-orientation")).toBe(separatorOrientation);
      for (const utility of utilities) {
        expect(separator.classList.contains(`${prefix}${utility}`)).toBe(true);
      }
      expect(separator.classList.contains("shrink-0")).toBe(true);
      expect(separator.className).not.toContain("aria-[orientation=vertical]:");
    },
  );

  it("keeps the default horizontal group and forwards handle props", () => {
    const onClick = vi.fn();
    render(
      <ResizablePanelGroup>
        <ResizablePanel id="sidebar" defaultSize={25} />
        <ResizableHandle
          withHandle
          className="custom-handle"
          aria-label="Resize sidebar"
          onClick={onClick}
        />
        <ResizablePanel id="content" defaultSize={75} />
      </ResizablePanelGroup>,
    );

    const separator = screen.getByRole("separator", { name: "Resize sidebar" });
    expect(separator.getAttribute("aria-orientation")).toBe("vertical");
    expect(separator.classList.contains("custom-handle")).toBe(true);
    expect(separator.classList.contains("w-2")).toBe(true);
    expect(separator.hasAttribute("withHandle")).toBe(false);
    fireEvent.click(separator);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("updates the separator orientation when the group direction changes", () => {
    const split = (direction: "horizontal" | "vertical") => (
      <ResizablePanelGroup direction={direction}>
        <ResizablePanel id="sidebar" defaultSize={25} />
        <ResizableHandle />
        <ResizablePanel id="content" defaultSize={75} />
      </ResizablePanelGroup>
    );
    const { rerender } = render(split("horizontal"));
    expect(screen.getByRole("separator").getAttribute("aria-orientation")).toBe("vertical");

    rerender(split("vertical"));
    expect(screen.getByRole("separator").getAttribute("aria-orientation")).toBe("horizontal");

    rerender(split("horizontal"));
    expect(screen.getByRole("separator").getAttribute("aria-orientation")).toBe("vertical");
  });
});
