import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import type { ReactFlowInstance } from "@xyflow/react";
import type { Edge } from "@xyflow/react";
import type { ImageWorkflowNodePosition } from "@/types/studio";

/**
 * 拖拽图片文件到画布(09-02 对账缺口#1,交互形态参考 infinite-canvas,实现从零):
 * 桌面/文件夹拖 PNG/JPG 到画布 → dataUrl → 建参考图节点(落=松手位置)。
 * 走项目作用域落盘(projectFiles.saveImage,对齐 09-02 生成治理通道),
 * 绝不写 userData;拖入中给轻提示条反馈。
 */
export function useImageDrop({
  projectId,
  flowApi,
  addReferenceNode,
}: {
  projectId: string | undefined;
  flowApi: ReactFlowInstance<never, Edge> | { screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number } };
  addReferenceNode: (input: { imageUrl: string; title?: string; position?: ImageWorkflowNodePosition }) => string;
}) {
  const [dragOver, setDragOver] = useState(false);
  const counterRef = useRef(0);

  const readAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("图片读取失败"));
      reader.readAsDataURL(file);
    });

  const persistToProject = useCallback(async (dataUrl: string, filename: string): Promise<string> => {
    const bridge = (window as unknown as {
      projectFiles?: {
        saveImage: (payload: { projectId: string; relativePath: string; source: string }) =>
          Promise<{ success: boolean; url?: string; error?: string }>;
      };
    }).projectFiles;
    if (!projectId || !bridge?.saveImage) {
      throw new Error(projectId ? "项目文件桥不可用" : "请先选择项目");
    }
    const month = new Date().toISOString().slice(0, 7);
    const saved = await bridge.saveImage({
      projectId,
      relativePath: `media/ai-image/${month}/${filename}`,
      source: dataUrl,
    });
    if (!saved.success || !saved.url) throw new Error(saved.error || "项目内落盘失败");
    return saved.url;
  }, [projectId]);

  const handlers = {
    onDragEnter: useCallback((event: React.DragEvent) => {
      if (!event.dataTransfer?.types?.includes("Files")) return;
      event.preventDefault();
      counterRef.current += 1;
      setDragOver(true);
    }, []),
    onDragOver: useCallback((event: React.DragEvent) => {
      if (!event.dataTransfer?.types?.includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }, []),
    onDragLeave: useCallback(() => {
      counterRef.current = Math.max(0, counterRef.current - 1);
      if (counterRef.current === 0) setDragOver(false);
    }, []),
    onDrop: useCallback(
      (event: React.DragEvent) => {
        if (!event.dataTransfer?.types?.includes("Files")) return;
        event.preventDefault();
        counterRef.current = 0;
        setDragOver(false);
        const files = [...(event.dataTransfer.files ?? [])].filter((file) => /^image\//.test(file.type));
        if (files.length === 0) return;
        const world = flowApi.screenToFlowPosition({ x: event.clientX, y: event.clientY });
        void (async () => {
          for (const [index, file] of files.entries()) {
            try {
              const dataUrl = await readAsDataUrl(file);
              const stable = await persistToProject(
                dataUrl,
                `drop_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${file.type.split("/")[1] ?? "png"}`,
              );
              addReferenceNode({
                imageUrl: stable,
                title: file.name.replace(/\.[^.]+$/, ""),
                position: { x: world.x + index * 40, y: world.y + index * 40 },
              });
            } catch (error) {
              toast.error(`${file.name}:${error instanceof Error ? error.message : "拖入失败"}`);
            }
          }
          if (files.length > 0) toast.success(`已放入 ${files.length} 张参考图`);
        })();
      },
      [addReferenceNode, flowApi, persistToProject],
    ),
  };

  return { handlers, dragOver };
}
