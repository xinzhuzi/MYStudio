// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EpisodeTreeStructure } from "./episode-tree-structure";

afterEach(cleanup);

const episode = { id: "ep1", index: 1, title: "第一集", sceneIds: ["scene1"] } as never;
const scene = { id: "scene1", name: "矿场", location: "矿洞" } as never;
const completedShot = { id: "shot1", index: 1, sceneRefId: "scene1", actionSummary: "阿青抬头", imageStatus: "completed", videoStatus: "completed" } as never;
const pendingShot = { id: "shot2", index: 2, sceneRefId: "scene1", actionSummary: "众人退后", imageStatus: "pending", videoStatus: "pending" } as never;

function renderTree(filter: "all" | "pending" | "completed" = "all") {
  const callbacks = {
    onSelectItem: vi.fn(), onToggleEpisode: vi.fn(), onToggleScene: vi.fn(),
    onAddScene: vi.fn(), onEditEpisode: vi.fn(), onEditScene: vi.fn(), onDeleteItem: vi.fn(),
  };
  const view = render(<EpisodeTreeStructure
    episodes={[episode]}
    scenes={[scene]}
    shots={[completedShot, pendingShot]}
    shotsByScene={{ scene1: [completedShot, pendingShot] }}
    filter={filter}
    expandedEpisodes={new Set(["ep1"])}
    expandedScenes={new Set(["scene1"])}
    selectedItemId={null}
    selectedItemType={null}
    {...callbacks}
  />);
  return { ...view, callbacks };
}

describe("EpisodeTreeStructure", () => {
  it("renders hierarchy and keeps selection separate from expansion", () => {
    const { callbacks } = renderTree();
    expect(screen.getByText("第一集")).toBeTruthy();
    expect(screen.getByText("矿场")).toBeTruthy();
    expect(screen.getByText(/阿青抬头/)).toBeTruthy();

    fireEvent.click(screen.getByText("第一集"));
    fireEvent.click(screen.getByLabelText("切换矿场"));
    expect(callbacks.onSelectItem).toHaveBeenCalledWith("episode_1", "episode");
    expect(callbacks.onToggleEpisode).not.toHaveBeenCalled();
    expect(callbacks.onToggleScene).toHaveBeenCalledWith("scene1");
  });

  it("filters only shot rows while retaining the episode and scene", () => {
    const { rerender, callbacks } = renderTree("completed");
    expect(screen.getByText(/阿青抬头/)).toBeTruthy();
    expect(screen.queryByText(/众人退后/)).toBeNull();

    rerender(<EpisodeTreeStructure
      episodes={[episode]}
      scenes={[scene]}
      shots={[completedShot, pendingShot]}
      shotsByScene={{ scene1: [completedShot, pendingShot] }}
      filter="pending"
      expandedEpisodes={new Set(["ep1"])}
      expandedScenes={new Set(["scene1"])}
      selectedItemId={null}
      selectedItemType={null}
      {...callbacks}
    />);
    expect(screen.queryByText(/阿青抬头/)).toBeNull();
    expect(screen.getByText(/众人退后/)).toBeTruthy();
    expect(screen.getByText("第一集")).toBeTruthy();
    expect(screen.getByText("矿场")).toBeTruthy();
  });

  it("routes shot selection and deletion through parent callbacks", () => {
    const { callbacks } = renderTree();
    fireEvent.click(screen.getByText(/阿青抬头/));
    fireEvent.click(screen.getByLabelText("删除镜头 1"));
    expect(callbacks.onSelectItem).toHaveBeenCalledWith("shot1", "shot");
    expect(callbacks.onDeleteItem).toHaveBeenCalledWith("shot", "shot1", "镜头 1");
  });
});
