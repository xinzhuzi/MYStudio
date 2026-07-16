// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/style-picker", () => ({
  StylePicker: ({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled: boolean }) => (
    <button type="button" disabled={disabled} onClick={() => onChange("new-style")}>风格:{value}</button>
  ),
}));

import { SceneGenerationForm } from "./scene-generation-form";

afterEach(cleanup);

function createProps() {
  return {
    name: "旧场景",
    location: "旧地点",
    time: "day",
    atmosphere: "peaceful",
    styleId: "ink",
    referenceImages: ["one.png"],
    isGenerating: false,
    onNameChange: vi.fn(),
    onLocationChange: vi.fn(),
    onTimeChange: vi.fn(),
    onAtmosphereChange: vi.fn(),
    onStyleChange: vi.fn(),
    onReferenceImagesChange: vi.fn(),
    onRemoveReferenceImage: vi.fn(),
  };
}

describe("SceneGenerationForm", () => {
  it("delegates controlled text, style, upload, and removal actions", () => {
    const props = createProps();
    render(<SceneGenerationForm {...props} />);

    fireEvent.change(screen.getByLabelText("场景名称"), { target: { value: "新场景" } });
    fireEvent.change(screen.getByLabelText("地点描述"), { target: { value: "新地点" } });
    fireEvent.click(screen.getByRole("button", { name: "风格:ink" }));
    fireEvent.click(screen.getByRole("button", { name: "删除参考图 1" }));
    fireEvent.change(screen.getByLabelText("上传参考图片"), { target: { files: [] } });

    expect(props.onNameChange).toHaveBeenCalledWith("新场景");
    expect(props.onLocationChange).toHaveBeenCalledWith("新地点");
    expect(props.onStyleChange).toHaveBeenCalledWith("new-style");
    expect(props.onRemoveReferenceImage).toHaveBeenCalledWith(0);
    expect(props.onReferenceImagesChange).toHaveBeenCalledOnce();
    expect(screen.getByText("1/3")).toBeTruthy();
  });

  it("disables editable controls and hides upload at three references", () => {
    const props = createProps();
    render(
      <SceneGenerationForm
        {...props}
        isGenerating
        referenceImages={["one.png", "two.png", "three.png"]}
      />,
    );

    expect((screen.getByLabelText("场景名称") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("地点描述") as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "风格:ink" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByLabelText("上传参考图片")).toBeNull();
    expect(screen.getByText("3/3")).toBeTruthy();
  });
});
