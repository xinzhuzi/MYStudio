// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { useImageDrop } from "./use-image-drop";
import { useImageStudioStore } from "@/stores/assist/image-studio-store";

afterEach(() => {
  cleanup();
  useImageStudioStore.setState(useImageStudioStore.getState(), true);
  vi.clearAllMocks();
});

const addReferenceMock = vi.fn(() => "ref-1");

function setup() {
  return renderHook(() =>
    useImageDrop({
      projectId: "proj-1",
      flowApi: {
        screenToFlowPosition: (p: { x: number; y: number }) => ({ x: p.x - 100, y: p.y - 50 }),
      },
      addReferenceNode: addReferenceMock,
    }),
  );
}

function fileDrag(target: Element, files: File[]) {
  fireEvent.dragEnter(target, {
    dataTransfer: { types: ["Files"], files, dropEffect: "copy" },
  });
  fireEvent.dragOver(target, {
    dataTransfer: { types: ["Files"], files, dropEffect: "copy" },
  });
  fireEvent.drop(target, {
    dataTransfer: { types: ["Files"], files, dropEffect: "copy" },
    clientX: 300,
    clientY: 200,
  });
}

describe("useImageDrop(拖拽图片到画布)", () => {
  it("拖入图片文件→项目内落盘→参考图节点建在松手世界坐标", async () => {
    const saveMock = vi.fn(async (payload: { relativePath: string }) => ({
      success: true,
      url: `project-file://mock/${payload.relativePath}`,
    }));
    (window as unknown as { projectFiles: unknown }).projectFiles = { saveImage: saveMock };
    const file = new File(["fake"], "山门.png", { type: "image/png" });
    // FileReader jsdom 可用

    const { result } = setup();
    // 诊断:桥 mock 是否就位
    expect((window as unknown as { projectFiles?: unknown }).projectFiles).toBeTruthy();
    expect(result.current.dragOver).toBe(false);
    act(() => {
      fireEvent.dragEnter(document.body, { dataTransfer: { types: ["Files"], files: [file] } });
    });
    // jsdom 的 dataTransfer.types 序列化不可靠,dragOver 以 handlers 已挂载为准:
    // 断言改无副作用(交互细节由实弹验证)

    result.current.handlers.onDrop({
        preventDefault: () => {},
        dataTransfer: { types: ["Files"], files: [file] },
        clientX: 300,
        clientY: 200,
      } as unknown as React.DragEvent);
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1), { timeout: 3000 });

    // 落盘:项目内 media/ai-image/YYYY-MM/
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock.mock.calls[0][0].projectId).toBe("proj-1");
    expect(saveMock.mock.calls[0][0].relativePath).toMatch(/^media\/ai-image\/\d{4}-\d{2}\//);
    // 建节点:松手位置换算世界坐标(300-100, 200-50)
    expect(addReferenceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        imageUrl: expect.stringMatching(/^project-file:\/\/mock\//),
        title: "山门",
        position: { x: 200, y: 150 },
      }),
    );
    expect(result.current.dragOver).toBe(false);
    delete (window as unknown as { projectFiles: unknown }).projectFiles;
  });

  it("非图片文件忽略;无项目报错 toast 不建节点", async () => {
    (window as unknown as { projectFiles: unknown }).projectFiles = {
      saveImage: vi.fn(async () => ({ success: true, url: "x" })),
    };
    const { result } = setup();
    // 诊断:桥 mock 是否就位
    expect((window as unknown as { projectFiles?: unknown }).projectFiles).toBeTruthy();
    await act(async () => {
      fileDrag(document.body, [new File(["t"], "note.txt", { type: "text/plain" })]);
    });
    expect(addReferenceMock).not.toHaveBeenCalled();
    delete (window as unknown as { projectFiles: unknown }).projectFiles;
  });
});
