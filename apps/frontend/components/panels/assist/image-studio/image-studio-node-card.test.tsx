// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/local-image", () => ({
  LocalImage: ({ src }: { src: string }) => <img data-testid="local-image" src={src} alt="" />,
}));
vi.mock("@/components/ui/image-resolution-badge", () => ({
  ResolutionBadge: ({ src }: { src?: string }) => <span data-testid="resolution-badge" data-src={src} />,
  probeImagePixelSize: vi.fn(async () => null),
}));
vi.mock("@xyflow/react", () => ({
  Handle: () => <span data-testid="handle" />,
  Position: { Left: "left", Right: "right" },
}));
vi.mock("@/components/panels/assist/ModelSelector", () => ({
  ModelSelector: ({ value }: { value: string }) => (
    <select data-testid="model-selector" value={value} disabled>
      <option value={value}>{value || "默认模型"}</option>
    </select>
  ),
}));
vi.mock("@/lib/upscale/client", () => ({
  UPSCALE_INPUT_MAX_LONG_SIDE: 2048,
}));

import { ImageStudioNodeCard, type ImageStudioReactNode } from "./image-studio-node-card";
import type {
  ImageWorkflowGeneratedNode,
  ImageWorkflowReferenceNode,
} from "@/types/studio";

afterEach(() => cleanup());

function renderCard(node: ImageStudioReactNode["data"]) {
  return render(
    <ImageStudioNodeCard
      id={node.node.id}
      data={node}
      selected={false}
      type={node.node.type}
      dragging={false}
      zIndex={0}
      isConnectable
      positionAbsoluteX={0}
      positionAbsoluteY={0}
      deletable
      selectable
      draggable
      width={420}
      height={320}
    />,
  );
}

function generatedNode(overrides: Partial<ImageWorkflowGeneratedNode> = {}): ImageWorkflowGeneratedNode {
  return {
    id: "gen-1",
    type: "generated",
    title: "生成图",
    prompt: "山门晨雾",
    aspectRatio: "16:9",
    status: "idle",
    position: { x: 0, y: 0 },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

const callbacks = {
  onUpdate: vi.fn(),
  onUpdateExtras: vi.fn(),
  onPickImage: vi.fn(),
  onGenerate: vi.fn(),
  onStop: vi.fn(),
  onUpscale: vi.fn(),
  onSaveToProps: vi.fn(),
  onDelete: vi.fn(),
};

describe("ImageStudioNodeCard 成图卡", () => {
  it("ready 状态展示结果图与中文状态;生成按钮点击回调", () => {
    renderCard({
      node: generatedNode({ status: "ready", resultUrl: "local-image://ai-image/x.png" }),
      selected: false,
      referenceCount: 0,
      ...callbacks,
    });
    expect(screen.getByTestId("local-image").getAttribute("src")).toBe("local-image://ai-image/x.png");
    // 09-03 用户裁定:完成态零状态渲染(孤零零的对号已删)
    expect(screen.queryByLabelText("已完成")).toBeNull();
    expect(screen.getByText(/纯文生图/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /生成/ }));
    expect(callbacks.onGenerate).toHaveBeenCalledWith("gen-1");
  });

  it("failed 状态不再上卡:错误原因走弹窗,占位保持中性文案(09-03 用户裁定)", () => {
    renderCard({
      node: generatedNode({ status: "failed", errorReason: "渠道超时" }),
      selected: false,
      referenceCount: 0,
      ...callbacks,
    });
    expect(screen.queryByText("渠道超时")).toBeNull();
    expect(screen.queryByText("失败")).toBeNull();
    expect(screen.getByText("等待生成")).toBeTruthy();
  });

  it("参考图数超引擎能力时给告警提示", () => {
    renderCard({
      node: generatedNode({ model: "krea2-turbo" }),
      selected: false,
      referenceCount: 2,
      ...callbacks,
    });
    expect(screen.getByText(/已挂 2 张参考图,当前引擎建议不超过 1 张/)).toBeTruthy();
  });

  it("generating 时按钮切换为停止", () => {
    renderCard({
      node: generatedNode({ status: "generating" }),
      selected: false,
      referenceCount: 0,
      ...callbacks,
    });
    fireEvent.click(screen.getByRole("button", { name: /停止/ }));
    expect(callbacks.onStop).toHaveBeenCalledWith("gen-1");
  });
});

describe("ImageStudioNodeCard 参考图卡", () => {
  function referenceNode(imageUrl: string): ImageWorkflowReferenceNode {
    return {
      id: "ref-1",
      type: "reference",
      title: "参考图",
      imageUrl,
      position: { x: 0, y: 0 },
      createdAt: 1,
      updatedAt: 1,
    };
  }

  it("编号标题:referenceIndex 显示「参考图 N」,缺省回落「参考图」(09-03 编号单源)", () => {
    const { unmount } = renderCard({
      node: referenceNode("local-image://upload/a.png"),
      selected: false,
      referenceCount: 0,
      referenceIndex: 2,
      ...callbacks,
    });
    expect(screen.getByText("参考图 2")).toBeTruthy();
    unmount();
    renderCard({
      node: referenceNode("local-image://upload/a.png"),
      selected: false,
      referenceCount: 0,
      ...callbacks,
    });
    expect(screen.getByText("参考图")).toBeTruthy();
  });

  it("有图:展示预览+更换按钮", () => {
    renderCard({
      node: referenceNode("local-image://upload/a.png"),
      selected: false,
      referenceCount: 0,
      ...callbacks,
    });
    expect(screen.getByTestId("local-image").getAttribute("src")).toBe("local-image://upload/a.png");
    fireEvent.click(screen.getByRole("button", { name: /更换/ }));
    expect(callbacks.onPickImage).toHaveBeenCalledWith("ref-1");
  });

  it("无图:上传占位按钮触发 onPickImage", () => {
    renderCard({
      node: referenceNode(""),
      selected: false,
      referenceCount: 0,
      ...callbacks,
    });
    fireEvent.click(screen.getByRole("button", { name: /上传参考图/ }));
    expect(callbacks.onPickImage).toHaveBeenCalledWith("ref-1");
  });
});
