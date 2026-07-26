// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScriptInput } from "./script-input";
import { ScriptInputSettings } from "./script-input-settings";

vi.mock("@/stores/script/script-store", () => ({
  useScriptStore: (selector: (state: unknown) => unknown) => selector({
    activeProjectId: null,
    projects: {},
    setInputDraft: vi.fn(),
  }),
}));

vi.mock("@/components/features/visual-style/style-picker", () => ({
  StylePicker: ({ onChange, disabled }: { onChange: (value: string) => void; disabled?: boolean }) => (
    <button type="button" data-testid="style-picker" disabled={disabled} onClick={() => onChange("watercolor")}>style</button>
  ),
}));

afterEach(() => cleanup());

const baseProps = {
  rawScript: "第1集\n内容",
  language: "zh",
  targetDuration: "auto",
  styleId: "ink",
  parseStatus: "idle" as const,
  chatConfigured: true,
  onRawScriptChange: vi.fn(),
  onLanguageChange: vi.fn(),
  onDurationChange: vi.fn(),
  onStyleChange: vi.fn(),
  onParse: vi.fn(),
};

describe("ScriptInput", () => {
  it("shows the complete first-pass import pipeline while work is active", () => {
    render(<ScriptInput {...baseProps} importStatus="importing" />);

    expect(screen.getByText("正在处理中...")).toBeTruthy();
    expect(screen.getByText("导入剧本")).toBeTruthy();
    expect(screen.getByText("AI 标题校准")).toBeTruthy();
    expect(screen.getByText("AI 大纲生成")).toBeTruthy();
    expect(screen.getByText("AI 分镜校准")).toBeTruthy();
    expect(screen.getByText("AI 角色校准")).toBeTruthy();
    expect(screen.getByText("AI 场景校准")).toBeTruthy();
  });

  it("limits the second-pass progress surface to requested calibration types", () => {
    render(
      <ScriptInput
        {...baseProps}
        characterCalibrationStatus="calibrating"
        secondPassTypes={new Set(["characters"])}
      />,
    );

    expect(screen.getByText("🔄 二次校准中...")).toBeTruthy();
    expect(screen.getByText("AI 角色校准")).toBeTruthy();
    expect(screen.queryByText("AI 校准分镜")).toBeNull();
    expect(screen.queryByText("AI 场景校准")).toBeNull();
  });

  it("disables import input until an asynchronous full import settles", async () => {
    let resolveImport!: () => void;
    const onImportFullScript = vi.fn(() => new Promise<void>((resolve) => {
      resolveImport = resolve;
    }));
    render(<ScriptInput {...baseProps} onImportFullScript={onImportFullScript} />);

    const textarea = screen.getByRole("textbox", { name: "" });
    fireEvent.click(screen.getByRole("button", { name: "导入完整剧本" }));

    expect(onImportFullScript).toHaveBeenCalledWith("第1集\n内容");
    expect(screen.getByRole("button", { name: "导入中..." }).hasAttribute("disabled")).toBe(true);
    expect(textarea.hasAttribute("disabled")).toBe(true);

    await act(async () => resolveImport());
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "导入完整剧本" }).hasAttribute("disabled")).toBe(false);
      expect(textarea.hasAttribute("disabled")).toBe(false);
    });
  });

  it("switches the synchronous settings surface by mode and delegates style changes", () => {
    const onStyleChange = vi.fn();
    const settingsProps = {
      mode: "import" as const,
      language: "zh",
      targetDuration: "auto",
      styleId: "ink",
      parseStatus: "idle" as const,
      onLanguageChange: vi.fn(),
      onDurationChange: vi.fn(),
      onStyleChange,
    };
    const { rerender } = render(<ScriptInputSettings {...settingsProps} />);

    expect(screen.getByText("剧本语言")).toBeTruthy();
    expect(screen.queryByText("时长")).toBeNull();
    fireEvent.click(screen.getByTestId("style-picker"));
    expect(onStyleChange).toHaveBeenCalledWith("watercolor");

    rerender(<ScriptInputSettings {...settingsProps} mode="create" />);
    expect(screen.getByText("时长")).toBeTruthy();
    expect(screen.getByText("语言")).toBeTruthy();
  });

  it("keeps extracted settings controls disabled while parsing", () => {
    render(<ScriptInput {...baseProps} parseStatus="parsing" />);
    expect(screen.getByTestId("style-picker").hasAttribute("disabled")).toBe(true);
    for (const combobox of screen.getAllByRole("combobox")) {
      expect(combobox.hasAttribute("disabled")).toBe(true);
    }
  });
});
