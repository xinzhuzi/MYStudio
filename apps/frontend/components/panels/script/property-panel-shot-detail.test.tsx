// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Shot } from "@/types/script";
import { PropertyPanelShotDetail } from "./property-panel-shot-detail";

afterEach(cleanup);

const shot = {
  id: "shot-1",
  index: 4,
  sceneRefId: "scene-1",
  actionSummary: "角色推门进入",
  visualDescription: "雨夜中的旧门",
  shotSize: "MS",
  cameraMovement: "dolly_in",
  specialTechnique: "none",
  duration: 5,
  ambientSound: "雨声",
  soundEffect: "门轴声",
  dialogue: "有人吗？",
  characterNames: ["阿宁"],
  characterIds: [],
  characterVariations: {},
  emotionTags: ["tense"],
  imageStatus: "completed",
  imageProgress: 100,
  videoStatus: "generating",
  videoProgress: 40,
} as Shot;

function Harness({ onSave }: { onSave: (data: Record<string, string>) => void }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<Record<string, string>>({});
  return (
    <PropertyPanelShotDetail
      shot={shot}
      isEditing={isEditing}
      editData={editData}
      setEditData={setEditData}
      setIsEditing={setIsEditing}
      startEditing={() => {
        setEditData({ actionSummary: shot.actionSummary, dialogue: shot.dialogue || "", shotSize: shot.shotSize || "" });
        setIsEditing(true);
      }}
      handleSave={() => onSave(editData)}
      handleCopyShotTriPrompts={vi.fn()}
      copiedShotPrompts={false}
      deleteDialogOpen={false}
      setDeleteDialogOpen={vi.fn()}
      handleDelete={vi.fn()}
    />
  );
}

describe("PropertyPanelShotDetail", () => {
  it("preserves shot metadata, audio, characters, emotion and generation states", () => {
    render(<Harness onSave={vi.fn()} />);
    expect(screen.getByText("分镜 04")).toBeTruthy();
    expect(screen.getByText("雨夜中的旧门")).toBeTruthy();
    expect(screen.getByText("雨声")).toBeTruthy();
    expect(screen.getByText("门轴声")).toBeTruthy();
    expect(screen.getByText("阿宁")).toBeTruthy();
    expect(screen.getByText("紧张")).toBeTruthy();
    expect(screen.getAllByText("已完成").length).toBeGreaterThan(0);
    expect(screen.getAllByText("进行中").length).toBeGreaterThan(0);
  });

  it("preserves editing and primary action callbacks", () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑分镜" }));
    fireEvent.change(screen.getByDisplayValue("角色推门进入"), { target: { value: "角色冲入房间" } });
    fireEvent.click(screen.getByRole("button", { name: "保存分镜" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ actionSummary: "角色冲入房间" }));
  });
});
