// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditableTimecode } from "./editable-timecode";

afterEach(() => {
  cleanup();
});

describe("editable timecode input boundaries", () => {
  it("clamps edits to zero duration and preserves the exact duration boundary", () => {
    const onTimeChange = vi.fn();
    const { unmount } = render(
      <EditableTimecode time={2} duration={0} format="SS" onTimeChange={onTimeChange} />,
    );

    fireEvent.click(screen.getByText("2"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "5" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onTimeChange).toHaveBeenCalledWith(0);

    unmount();
    onTimeChange.mockClear();
    render(
      <EditableTimecode time={2} duration={5} format="SS" onTimeChange={onTimeChange} />,
    );

    fireEvent.click(screen.getByText("2"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "5" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onTimeChange).toHaveBeenCalledWith(5);
  });

  it("does not emit a non-finite value for an invalid duration", () => {
    const onTimeChange = vi.fn();
    render(
      <EditableTimecode
        time={0}
        duration={Number.NaN}
        format="SS"
        onTimeChange={onTimeChange}
      />,
    );

    fireEvent.click(screen.getByText("0"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "5" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onTimeChange).toHaveBeenCalledWith(5);
    expect(Number.isFinite(onTimeChange.mock.calls[0]?.[0])).toBe(true);
  });

  it("keeps the editor open for malformed frame fields", () => {
    const onTimeChange = vi.fn();
    render(
      <EditableTimecode
        time={0}
        format="HH:MM:SS:FF"
        fps={30}
        onTimeChange={onTimeChange}
      />,
    );

    fireEvent.click(screen.getByText("00:00:00:00"));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "00:00:00:1.5" },
    });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    expect(onTimeChange).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });
});
