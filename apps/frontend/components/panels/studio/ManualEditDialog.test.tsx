// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StudioSkillsBridge } from "@/lib/bridge/studio-skills";
import type { StudioManualPreset } from "@/types/studio";
import { ManualEditDialog } from "./ManualEditDialog";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

(globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Reflect.deleteProperty(window, "studioSkills");
});

describe("ManualEditDialog", () => {
  it("reports the missing optional bridge without closing the dialog", async () => {
    const manual = makeManual();
    const onOpenChange = vi.fn();

    render(
      <ManualEditDialog
        open
        kind="visual"
        manual={manual}
        onOpenChange={onOpenChange}
      />,
    );
    fireEvent.change(
      screen.getByPlaceholderText("该文档暂无内容，可在此编辑"),
      { target: { value: "after" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "当前环境不支持编辑手册，请在桌面版中打开",
      );
    });
    expect(manual.modules.README).toBe("before");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("keeps the dialog open and reports a rejected bridge result", async () => {
    const writeText = vi.fn(async () => ({
      success: false,
      error: "write failed",
    }));
    const bridge: StudioSkillsBridge = {
      list: async () => [],
      readText: async () => ({ success: true }),
      writeText,
      createText: async () => ({ success: true }),
      deleteText: async () => ({ success: true }),
      restoreText: async () => ({ success: true }),
    };
    Object.defineProperty(window, "studioSkills", {
      configurable: true,
      value: bridge,
    });
    const manual = makeManual();
    const onOpenChange = vi.fn();

    render(
      <ManualEditDialog
        open
        kind="visual"
        manual={manual}
        onOpenChange={onOpenChange}
      />,
    );
    fireEvent.change(
      screen.getByPlaceholderText("该文档暂无内容，可在此编辑"),
      { target: { value: "after" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        "art_skills/ink/README.md",
        "after",
      );
      expect(toast.error).toHaveBeenCalledWith("write failed");
    });
    expect(manual.modules.README).toBe("before");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

function makeManual(): StudioManualPreset {
  return {
    id: "ink",
    kind: "visual",
    name: "水墨国风",
    modules: { README: "before" },
    images: [],
    builtin: false,
    source: "stored-copy",
    completenessScore: 1,
    moduleCount: 1,
    imageCount: 0,
  };
}
