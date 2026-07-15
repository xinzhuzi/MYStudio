// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EpisodeTreeCharacterEditForm } from "./episode-tree-character-edit-form";

afterEach(cleanup);

describe("EpisodeTreeCharacterEditForm", () => {
  it("delegates controlled field changes", () => {
    const callbacks = {
      onNameChange: vi.fn(),
      onGenderChange: vi.fn(),
      onAgeChange: vi.fn(),
      onPersonalityChange: vi.fn(),
    };

    render(
      <EpisodeTreeCharacterEditForm
        name="旧角色"
        gender="男"
        age="30"
        personality="沉稳"
        {...callbacks}
        onCancel={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("角色名"), { target: { value: "新角色" } });
    fireEvent.change(screen.getByLabelText("性别"), { target: { value: "女" } });
    fireEvent.change(screen.getByLabelText("年龄"), { target: { value: "28" } });
    fireEvent.change(screen.getByLabelText("性格"), { target: { value: "果断" } });

    expect(callbacks.onNameChange).toHaveBeenCalledWith("新角色");
    expect(callbacks.onGenderChange).toHaveBeenCalledWith("女");
    expect(callbacks.onAgeChange).toHaveBeenCalledWith("28");
    expect(callbacks.onPersonalityChange).toHaveBeenCalledWith("果断");
  });

  it("delegates cancel and save", () => {
    const onCancel = vi.fn();
    const onSave = vi.fn();

    render(
      <EpisodeTreeCharacterEditForm
        name=""
        gender=""
        age=""
        personality=""
        onNameChange={vi.fn()}
        onGenderChange={vi.fn()}
        onAgeChange={vi.fn()}
        onPersonalityChange={vi.fn()}
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
