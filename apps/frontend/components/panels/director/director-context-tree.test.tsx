// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Episode, ScriptScene, Shot } from "@/types/script";

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import { DirectorContextTree } from "./director-context-tree";

afterEach(cleanup);

const episodes: Episode[] = [
  {
    id: "ep-1",
    index: 1,
    title: "第一集",
    sceneIds: ["scene-1"],
  },
];

const scenes: ScriptScene[] = [
  {
    id: "scene-1",
    name: "雨夜法坛",
    location: "法坛",
    time: "夜",
    atmosphere: "肃杀",
    status: "in_progress",
  },
];

const shots: Shot[] = [
  {
    id: "shot-1",
    index: 1,
    sceneRefId: "scene-1",
    actionSummary: "赵四举起火把",
    shotSize: "全景",
    characterIds: [],
    characterVariations: {},
    imageStatus: "completed",
    imageProgress: 100,
    videoStatus: "completed",
    videoProgress: 100,
  },
  {
    id: "shot-2",
    index: 2,
    sceneRefId: "scene-1",
    actionSummary: "众人退入阴影",
    characterIds: [],
    characterVariations: {},
    imageStatus: "idle",
    imageProgress: 0,
    videoStatus: "idle",
    videoProgress: 0,
  },
];

describe("DirectorContextTree", () => {
  it("preserves tree navigation, progress, selection, and scene/shot actions", () => {
    const onSendScene = vi.fn();
    const onAddScene = vi.fn();
    const onSendShot = vi.fn();
    const onAddShot = vi.fn();

    function Harness() {
      const [expandedEpisodes, setExpandedEpisodes] = useState(
        new Set(["ep-1"]),
      );
      const [expandedScenes, setExpandedScenes] = useState(new Set<string>());

      return (
        <DirectorContextTree
          episodes={episodes}
          scenes={scenes}
          shots={shots}
          shotsByScene={{ "scene-1": shots }}
          expandedEpisodes={expandedEpisodes}
          expandedScenes={expandedScenes}
          selectedSceneId="scene-1"
          selectedShotId="shot-1"
          onToggleEpisode={(episodeId) => {
            setExpandedEpisodes((current) => {
              const next = new Set(current);
              if (next.has(episodeId)) next.delete(episodeId);
              else next.add(episodeId);
              return next;
            });
          }}
          onToggleScene={(sceneId) => {
            setExpandedScenes((current) => {
              const next = new Set(current);
              if (next.has(sceneId)) next.delete(sceneId);
              else next.add(sceneId);
              return next;
            });
          }}
          onSendScene={onSendScene}
          onAddScene={onAddScene}
          onSendShot={onSendShot}
          onAddShot={onAddShot}
        />
      );
    }

    render(<Harness />);

    expect(screen.getAllByText("1/2")).toHaveLength(2);
    const sceneButton = screen.getByText("雨夜法坛").closest("button");
    expect(sceneButton?.className).toContain("ring-primary/30");
    expect(screen.queryByText(/赵四举起火把/)).toBeNull();

    fireEvent.click(sceneButton!);

    const shotButton = screen.getByText(/赵四举起火把/).closest("button");
    expect(shotButton?.className).toContain("ring-primary/30");

    fireEvent.click(screen.getByTitle("添加所有分镜到分镜编辑"));
    fireEvent.click(screen.getByTitle("发送整个场景到AI导演生成图片"));
    fireEvent.click(shotButton!);
    fireEvent.doubleClick(shotButton!);
    fireEvent.click(screen.getAllByTitle("添加到分镜编辑")[0]);

    expect(onAddScene).toHaveBeenCalledWith(scenes[0]);
    expect(onSendScene).toHaveBeenCalledWith(scenes[0]);
    expect(onSendShot).toHaveBeenCalledWith(shots[0], scenes[0]);
    expect(onAddShot).toHaveBeenCalledTimes(2);
    expect(onAddShot).toHaveBeenNthCalledWith(1, shots[0], scenes[0]);

    fireEvent.click(screen.getByText("第一集").closest("button")!);
    expect(screen.queryByText("雨夜法坛")).toBeNull();
  });
});
