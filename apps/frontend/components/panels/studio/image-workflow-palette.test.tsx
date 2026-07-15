// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ImageWorkflowPaletteImageButton,
  ImageWorkflowPaletteSection,
} from "./image-workflow-palette";

afterEach(cleanup);

describe("image workflow palette", () => {
  it("renders the empty state when the section has no items", () => {
    render(
      <ImageWorkflowPaletteSection title="项目参考图" emptyText="当前项目暂无参考图">
        {[]}
      </ImageWorkflowPaletteSection>,
    );

    expect(screen.getByText("项目参考图")).toBeTruthy();
    expect(screen.getByText("当前项目暂无参考图")).toBeTruthy();
  });

  it("renders an image action and forwards clicks", () => {
    const onClick = vi.fn();
    render(
      <ImageWorkflowPaletteSection title="分镜成图" emptyText="分镜尚未绑定图片">
        <ImageWorkflowPaletteImageButton
          title="分镜 1"
          imageUrl="project-file://demo/storyboard.png"
          onClick={onClick}
        />
      </ImageWorkflowPaletteSection>,
    );

    fireEvent.click(screen.getByRole("button", { name: /分镜 1/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("分镜尚未绑定图片")).toBeNull();
  });
});
