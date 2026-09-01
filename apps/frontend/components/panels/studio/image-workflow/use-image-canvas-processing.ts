/**
 * 图片画布图像处理钩子——裁剪确认/取景抽取/拆分确认/蒙版确认/反推提示词。
 * Canvas 二期拆出,体逐字保留;组件 state 经 ctx 注入。
 */
import { useCallback } from "react";
import type { NormRect } from "@/lib/studio/image-workflow/crop-geometry";
import type { ImageWorkflowNode } from "@/types/studio";
import { createBrowserCanvasCodec, cropImageData, splitImageData, cellRect } from "@/lib/studio/image-workflow/extraction-pixels";
import { nextNodePosition, resolveGenerationTargetNodeId } from "./image-workflow-graph-utils";
import { exportMaskOverlay, buildInpaintPrompt } from "@/lib/studio/image-workflow/mask-export";
import { reversePromptFromImage } from "@/lib/studio/image-workflow/reverse-prompt";
import { addPromptImageNode, addGeneratedImageNode, connectImageWorkflowNodes } from "@/lib/studio/image-workflow/graph-build";
import { toPreviewSrc } from "@/lib/media/preview-src";
import { toast } from "sonner";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useImageCanvasProcessing(ctx: any) {
  const { cropTarget, setCropTarget, splitTarget, setSplitTarget, maskTarget, setMaskTarget, reverseState, setReverseState, activeGraph, saveGraph, landDerived, assertLanded, generateNode } = ctx;

  const handleCropConfirm = useCallback(
    async (rect: NormRect) => {
      const target = cropTarget;
      if (!target) return;
      setCropTarget(null);
      try {
        const codec = createBrowserCanvasCodec();
        const sourcePixels = await codec.decode(target.imageUrl);
        const cropped = cropImageData(sourcePixels, rect);
        const dataUrl = codec.encode(cropped);
        assertLanded(
          await landDerived([
            {
              sourceNodeId: target.nodeId,
              pixels: { dataUrl, width: cropped.width, height: cropped.height },
              title: `${target.title}·裁剪`,
              derivation: { kind: "crop", sourceNodeId: target.nodeId, region: rect },
            },
          ]),
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "裁剪取材失败");
      }
    },
    [cropTarget, landDerived],
  );

  const extractImageUrl = (node: ImageWorkflowNode | undefined): string => {
    if (!node) return "";
    if (node.type === "reference") return node.imageUrl || "";
    if (node.type === "generated") return node.resultUrl || "";
    return "";
  };

  const handleExtractEntry = useCallback(
    (nodeId: string, tool: "crop" | "split" | "reverse" | "mask") => {
      if (!activeGraph) return;
      const node = activeGraph.nodes.find((item) => item.id === nodeId);
      const rawUrl = extractImageUrl(node);
      if (!node || !rawUrl) return;
      const target = { nodeId, imageUrl: toPreviewSrc(rawUrl), title: node.title };
      if (tool === "crop") setCropTarget(target);
      else if (tool === "split") setSplitTarget(target);
      else if (tool === "mask") setMaskTarget(target);
      else setReverseState({ ...target, running: false });
    },
    [activeGraph],
  );

  const handleSplitConfirm = useCallback(
    async (rows: number, cols: number) => {
      const target = splitTarget;
      if (!target) return;
      setSplitTarget(null);
      try {
        const codec = createBrowserCanvasCodec();
        const sourcePixels = await codec.decode(target.imageUrl);
        const pieces = splitImageData(sourcePixels, rows, cols);
        assertLanded(
          await landDerived(
            pieces.map((piece, index) => {
            const row = Math.floor(index / cols);
            const col = index % cols;
            return {
              sourceNodeId: target.nodeId,
              pixels: { dataUrl: codec.encode(piece), width: piece.width, height: piece.height },
              title: `${target.title}·${row + 1}-${col + 1}`,
              derivation: {
                kind: "split" as const,
                sourceNodeId: target.nodeId,
                cell: { row, col },
                region: cellRect(rows, cols, row, col),
              },
            };
          }),
          ),
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "切图取材失败");
      }
    },
    [landDerived, splitTarget],
  );

  const handleMaskConfirm = useCallback(
    async (payload: { request: string; maskData: { data: Uint8ClampedArray; width: number; height: number } }) => {
      const target = maskTarget;
      if (!target || !activeGraph) return;
      setMaskTarget(null);
      try {
        const codec = createBrowserCanvasCodec();
        const basePixels = await codec.decode(target.imageUrl);
        const exportResult = exportMaskOverlay(basePixels, payload.maskData, (image) => codec.encode(image));
        if (!exportResult) throw new Error("蒙版为空");
        // 新成图节点经 appendGraph 与落图合并为一次 saveGraph(单步撤销,
        // 09-01 mask 深审修复);生成链从 store 读最新图
        const genId = `gen-${Date.now()}`;
        assertLanded(
          await landDerived(
            [
              {
                sourceNodeId: target.nodeId,
                pixels: {
                  dataUrl: exportResult.overlayDataUrl,
                  width: payload.maskData.width,
                  height: payload.maskData.height,
                },
                title: `${target.title}·重绘区`,
                derivation: {
                  kind: "mask-inpaint",
                  sourceNodeId: target.nodeId,
                  region: exportResult.region,
                },
              },
            ],
            {
              appendGraph: (graph, landedIds) => {
                const refId = landedIds[0];
                const withGen = addGeneratedImageNode(graph, {
                  id: genId,
                  title: `${target.title}·局部重绘`,
                  prompt: buildInpaintPrompt(payload.request),
                  position: nextNodePosition(graph, "generated"),
                });
                return refId
                  ? connectImageWorkflowNodes(withGen, { source: refId, target: genId })
                  : withGen;
              },
            },
          ),
        );
        void generateNode(genId);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "局部重绘失败");
      }
    },
    [activeGraph, generateNode, landDerived, maskTarget],
  );

  const runReversePrompt = useCallback(async () => {
    const target = reverseState;
    if (!target || target.running) return;
    setReverseState({ ...target, running: true });
    try {
      const prompt = await reversePromptFromImage(target.imageUrl);
      if (!activeGraph) return;
      const generatedTarget = resolveGenerationTargetNodeId(activeGraph, target.nodeId);
      saveGraph(
        addPromptImageNode(activeGraph, {
          title: `${target.title}·反推`,
          prompt,
          position: nextNodePosition(activeGraph, "prompt"),
          ...(generatedTarget ? { targetNodeId: generatedTarget } : {}),
        }),
      );
      setReverseState(null);
      toast.success("反推提示词已建节点");
    } catch (error) {
      setReverseState(null);
      toast.error(error instanceof Error ? error.message : "反推提示词失败");
    }
  }, [activeGraph, reverseState, saveGraph]);


  return { handleCropConfirm, handleExtractEntry, handleSplitConfirm, handleMaskConfirm, runReversePrompt };
}
