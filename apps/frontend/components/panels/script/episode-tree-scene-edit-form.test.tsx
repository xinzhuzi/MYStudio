// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EpisodeTreeSceneEditForm } from "./episode-tree-scene-edit-form";

afterEach(cleanup);

describe("EpisodeTreeSceneEditForm", () => {
  it("renders controlled values and delegates field changes", () => {
    const onNameChange = vi.fn();
    const onLocationChange = vi.fn();
    const onTimeChange = vi.fn();
    const onAtmosphereChange = vi.fn();

    render(
      <EpisodeTreeSceneEditForm
        name="旧场景"
        location="旧地点"
        time="白天"
        atmosphere="安静"
        onNameChange={onNameChange}
        onLocationChange={onLocationChange}
        onTimeChange={onTimeChange}
        onAtmosphereChange={onAtmosphereChange}
        onCancel={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("场景名称"), { target: { value: "新场景" } });
    fireEvent.change(screen.getByLabelText("地点"), { target: { value: "新地点" } });
    fireEvent.change(screen.getByLabelText("时间"), { target: { value: "黄昏" } });
    fireEvent.change(screen.getByLabelText("氛围"), { target: { value: "紧张" } });

    expect(onNameChange).toHaveBeenCalledWith("新场景");
    expect(onLocationChange).toHaveBeenCalledWith("新地点");
    expect(onTimeChange).toHaveBeenCalledWith("黄昏");
    expect(onAtmosphereChange).toHaveBeenCalledWith("紧张");
  });

  it("delegates cancel and save", () => {
    const onCancel = vi.fn();
    const onSave = vi.fn();

    render(
      <EpisodeTreeSceneEditForm
        name=""
        location=""
        time=""
        atmosphere=""
        onNameChange={vi.fn()}
        onLocationChange={vi.fn()}
        onTimeChange={vi.fn()}
        onAtmosphereChange={vi.fn()}
        onCancel={onCancel}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledOnce();
  });
});
