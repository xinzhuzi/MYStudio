// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EpisodeTreeCharacterList } from "./episode-tree-character-list";

afterEach(cleanup);

const baseProps = {
  selectedItemId: null,
  selectedItemType: null,
  onSelectItem: vi.fn(),
  onEditCharacter: vi.fn(),
  onDeleteCharacter: vi.fn(),
  onAddCharacter: vi.fn(),
  onOpenFilteredCharacters: vi.fn(),
};

describe("EpisodeTreeCharacterList", () => {
  it("filters staged parents, removes duplicate ids and groups extras", () => {
    render(<EpisodeTreeCharacterList
      {...baseProps}
      characters={[
        { id: "parent", name: "父角色", stageCharacterIds: ["stage"] },
        { id: "hero", name: "阿青", tags: ["protagonist"] },
        { id: "hero", name: "重复阿青", tags: ["protagonist"] },
        { id: "extra", name: "路人", tags: ["extra"] },
      ]}
    />);

    expect(screen.queryByText("父角色")).toBeNull();
    expect(screen.queryByText("重复阿青")).toBeNull();
    expect(screen.getByText("角色 (1)")).toBeTruthy();
    expect(screen.queryByText("路人")).toBeNull();
    fireEvent.click(screen.getByText("群演配角 (1)"));
    expect(screen.getByText("路人")).toBeTruthy();
  });

  it("keeps selection and add callbacks at the component boundary", () => {
    const onSelectItem = vi.fn();
    const onAddCharacter = vi.fn();
    render(<EpisodeTreeCharacterList
      {...baseProps}
      characters={[{ id: "hero", name: "阿青", tags: ["supporting"] }]}
      selectedItemId="hero"
      selectedItemType="character"
      onSelectItem={onSelectItem}
      onAddCharacter={onAddCharacter}
    />);
    fireEvent.click(screen.getByText("阿青"));
    fireEvent.click(screen.getByLabelText("添加角色"));
    expect(onSelectItem).toHaveBeenCalledWith("hero", "character");
    expect(onAddCharacter).toHaveBeenCalledOnce();
    expect(screen.getByText("阿青").className).toContain("bg-primary/10");
  });

  it("hides calibration controls when unsupported and disables them while calibrating", () => {
    const { rerender } = render(<EpisodeTreeCharacterList {...baseProps} characters={[]} />);
    expect(screen.queryByLabelText("角色校准菜单")).toBeNull();

    rerender(<EpisodeTreeCharacterList
      {...baseProps}
      characters={[]}
      onCalibrateCharacters={vi.fn()}
      characterCalibrationStatus="calibrating"
    />);
    expect((screen.getByLabelText("角色校准菜单") as HTMLButtonElement).disabled).toBe(true);
  });
});
