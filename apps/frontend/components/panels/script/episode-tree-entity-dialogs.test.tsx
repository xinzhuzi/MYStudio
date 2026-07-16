// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EpisodeTreeEntityDialogs } from "./episode-tree-entity-dialogs";

afterEach(cleanup);

function createProps(): ComponentProps<typeof EpisodeTreeEntityDialogs> {
  return {
    sceneOpen: false,
    characterOpen: false,
    editingType: null,
    formData: {},
    onFormFieldChange: vi.fn(),
    onSceneOpenChange: vi.fn(),
    onCharacterOpenChange: vi.fn(),
    sceneQuery: "",
    sceneSearching: false,
    sceneResult: null,
    onSceneQueryChange: vi.fn(),
    onSceneSearch: vi.fn(),
    canFindScene: true,
    onSaveScene: vi.fn(),
    onConfirmScene: vi.fn(),
    characterQuery: "",
    characterSearching: false,
    characterResult: null,
    onCharacterQueryChange: vi.fn(),
    onCharacterSearch: vi.fn(),
    canFindCharacter: true,
    onSaveCharacter: vi.fn(),
    onConfirmCharacter: vi.fn(),
  };
}

describe("EpisodeTreeEntityDialogs", () => {
  it("preserves scene AI query, Enter search, result and confirm behavior", () => {
    const props = createProps();
    props.sceneOpen = true;
    props.sceneQuery = "医院走廊";
    props.sceneResult = {
      found: true,
      message: "找到场景",
      scene: { id: "scene-1", name: "医院走廊", location: "住院部", time: "夜", atmosphere: "安静" },
    };
    render(<EpisodeTreeEntityDialogs {...props} />);

    const input = screen.getByDisplayValue("医院走廊");
    fireEvent.change(input, { target: { value: "会议室" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByText("确认添加"));

    expect(props.onSceneQueryChange).toHaveBeenCalledWith("会议室");
    expect(props.onSceneSearch).toHaveBeenCalled();
    expect(screen.getByText("找到场景")).toBeTruthy();
    expect(props.onConfirmScene).toHaveBeenCalled();
  });

  it("preserves character edit field, save and cancel behavior", () => {
    const props = createProps();
    props.characterOpen = true;
    props.editingType = "character";
    props.formData = { name: "王大哥", gender: "男", age: "35", personality: "沉稳" };
    render(<EpisodeTreeEntityDialogs {...props} />);

    fireEvent.change(screen.getByDisplayValue("王大哥"), { target: { value: "王师傅" } });
    fireEvent.click(screen.getByText("保存"));
    fireEvent.click(screen.getByText("取消"));

    expect(props.onFormFieldChange).toHaveBeenCalledWith("name", "王师傅");
    expect(props.onSaveCharacter).toHaveBeenCalled();
    expect(props.onCharacterOpenChange).toHaveBeenCalledWith(false);
  });
});
