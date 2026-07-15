// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScriptScene, Shot } from "@/types/script";
import { PropertyPanelSceneDetail } from "./property-panel-scene-detail";

afterEach(cleanup);

const scene = {
  id: "scene-1",
  name: "雨夜街口",
  location: "旧镇街口",
  time: "夜",
  atmosphere: "雨",
  status: "completed",
  architectureStyle: "明清街巷",
  visualPrompt: "水墨雨夜街口",
  visualPromptEn: "ink wash rainy street",
  appearanceCount: 2,
  episodeNumbers: [1, 3],
  importance: "main",
  viewpoints: Array.from({ length: 7 }, (_, index) => ({
    id: `view-${index}`,
    name: `视角${index + 1}`,
    nameEn: `view-${index + 1}`,
    shotIds: index === 0 ? ["shot-1", "missing"] : [],
    keyProps: [],
    gridIndex: index,
  })),
} satisfies ScriptScene;

const shots = [{ id: "shot-1", index: 4 } as Shot];

function SceneDetailHarness({ onSave }: { onSave: (data: Record<string, string>) => void }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<Record<string, string>>({});
  return (
    <PropertyPanelSceneDetail
      scene={scene}
      sceneShots={shots}
      promptLanguage="zh+en"
      isEditing={isEditing}
      editData={editData}
      setEditData={setEditData}
      setIsEditing={setIsEditing}
      startEditing={() => {
        setEditData({ name: scene.name || "", location: scene.location, time: scene.time, atmosphere: scene.atmosphere });
        setIsEditing(true);
      }}
      handleSave={() => onSave(editData)}
      handleCopySceneData={vi.fn()}
      copiedScene={false}
      deleteDialogOpen={false}
      setDeleteDialogOpen={vi.fn()}
      handleDelete={vi.fn()}
    />
  );
}

describe("PropertyPanelSceneDetail", () => {
  it("preserves prompt, viewpoint, and appearance projections", () => {
    render(<SceneDetailHarness onSave={vi.fn()} />);

    expect(screen.getByText("水墨雨夜街口")).toBeTruthy();
    expect(screen.getByText("ink wash rainy street")).toBeTruthy();
    expect(screen.getByText("分镜 #04")).toBeTruthy();
    expect(screen.getByText("还有 1 个视角...")).toBeTruthy();
    expect(screen.queryByText("视角7")).toBeNull();
    expect(screen.getByText("主场景")).toBeTruthy();
    expect(screen.getByText("第 1, 3 集")).toBeTruthy();
  });

  it("preserves editing and action callbacks", () => {
    const onSave = vi.fn();
    const onGoToSceneLibrary = vi.fn();
    const onGoToDirectorFromScene = vi.fn();
    const handleCopySceneData = vi.fn();
    const setDeleteDialogOpen = vi.fn();

    const { rerender } = render(<SceneDetailHarness onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑场景" }));
    fireEvent.change(screen.getByDisplayValue("雨夜街口"), { target: { value: "新街口" } });
    fireEvent.click(screen.getByRole("button", { name: "保存场景" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: "新街口" }));

    rerender(
      <PropertyPanelSceneDetail
        scene={scene}
        sceneShots={shots}
        promptLanguage="zh"
        isEditing={false}
        editData={{}}
        setEditData={vi.fn()}
        setIsEditing={vi.fn()}
        startEditing={vi.fn()}
        handleSave={vi.fn()}
        onGoToSceneLibrary={onGoToSceneLibrary}
        handleCopySceneData={handleCopySceneData}
        copiedScene={false}
        onGoToDirectorFromScene={onGoToDirectorFromScene}
        deleteDialogOpen={false}
        setDeleteDialogOpen={setDeleteDialogOpen}
        handleDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("去场景库生成背景"));
    fireEvent.click(screen.getByText("复制场景数据"));
    fireEvent.click(screen.getByText("去AI导演生成视频"));
    fireEvent.click(screen.getByText("删除场景"));
    expect(onGoToSceneLibrary).toHaveBeenCalledWith("scene-1");
    expect(handleCopySceneData).toHaveBeenCalled();
    expect(onGoToDirectorFromScene).toHaveBeenCalledWith("scene-1");
    expect(setDeleteDialogOpen).toHaveBeenCalledWith(true);
  });
});
