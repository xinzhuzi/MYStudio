// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Scene } from "@/stores/library/scene-store";
import { SceneCard } from "./scene-card";

afterEach(() => cleanup());

const scene: Scene = {
  id: "scene-1",
  name: "山门",
  location: "青云山",
  time: "day",
  atmosphere: "peaceful",
  referenceImage: "https://example.test/scene.png",
  createdAt: 1,
  updatedAt: 1,
};

describe("SceneCard", () => {
  it("renders scene metadata and delegates grid selection", () => {
    const onClick = vi.fn();
    render(
      <SceneCard
        scene={scene}
        isSelected
        viewMode="grid"
        onClick={onClick}
      />,
    );

    expect(screen.getByText("山门")).toBeTruthy();
    expect(screen.getByAltText("山门").getAttribute("src")).toBe("https://example.test/scene.png");
    fireEvent.click(screen.getByText("山门"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("uses double click to expand children without opening image preview", () => {
    const onToggleExpand = vi.fn();
    const onImagePreview = vi.fn();
    render(
      <SceneCard
        scene={scene}
        isSelected={false}
        viewMode="grid"
        onClick={vi.fn()}
        hasChildren
        childCount={2}
        onToggleExpand={onToggleExpand}
        onImagePreview={onImagePreview}
      />,
    );

    fireEvent.doubleClick(screen.getByTitle("双击展开子场景"));
    expect(onToggleExpand).toHaveBeenCalledOnce();
    expect(onImagePreview).not.toHaveBeenCalled();
  });

  it("opens a leaf image preview and shows generation progress", () => {
    const onImagePreview = vi.fn();
    render(
      <SceneCard
        scene={scene}
        isSelected={false}
        viewMode="grid"
        onClick={vi.fn()}
        onImagePreview={onImagePreview}
        generatingTask={{ status: "generating", progress: 42, message: "拆分中" }}
      />,
    );

    expect(screen.getByText("拆分中")).toBeTruthy();
    fireEvent.doubleClick(screen.getByTitle("双击查看大图"));
    expect(onImagePreview).toHaveBeenCalledWith("https://example.test/scene.png");
  });

  it("renders the list-specific location and active task message", () => {
    const { rerender } = render(
      <SceneCard scene={scene} isSelected={false} viewMode="list" onClick={vi.fn()} />,
    );
    expect(screen.getByText("📍 青云山")).toBeTruthy();

    rerender(
      <SceneCard
        scene={scene}
        isSelected={false}
        viewMode="list"
        onClick={vi.fn()}
        generatingTask={{ status: "splitting", progress: 70, message: "保存视角" }}
      />,
    );
    expect(screen.getByText("保存视角")).toBeTruthy();
  });
});
