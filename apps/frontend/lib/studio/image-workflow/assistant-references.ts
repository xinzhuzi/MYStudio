import { prepareReferenceImageForTransfer } from "@/lib/ai/image-transfer";
import { toPreviewSrc } from "@/lib/media/preview-src";
import type { ImageWorkflowGraph } from "@/types/studio";

/**
 * 画布助手引用组装(09-02-canvas-assistant,纯函数):
 * 选中节点及其上游 → {图片集(已缩略), 文本集};无选中=空引用纯文本对话。
 * 交互形态参考 infinite-canvas 画布助手,实现从零(AGPL)。
 */

export interface AssistantContextInput {
  graph: ImageWorkflowGraph | undefined;
  selectedNodeId: string | null;
}

export interface AssistantReferencePack {
  images: string[]; // dataUrl(已过缩略铁律)
  texts: Array<{ title: string; body: string }>;
  /** 引用摘要(面板头部展示) */
  summaryZh: string;
}

export async function buildAssistantReferences({
  graph,
  selectedNodeId,
}: AssistantContextInput): Promise<AssistantReferencePack> {
  if (!graph || !selectedNodeId) {
    return { images: [], texts: [], summaryZh: "" };
  }
  const selected = graph.nodes.find((node) => node.id === selectedNodeId);
  if (!selected) {
    return { images: [], texts: [], summaryZh: "" };
  }

  // 上游集合:指向选中节点的所有边(一度,成图场景上游=参考图+提示词)
  const upstreamIds = new Set(
    graph.edges
      .filter((edge) => edge.target === selectedNodeId)
      .map((edge) => edge.source),
  );
  const upstreamNodes = graph.nodes.filter((node) => upstreamIds.has(node.id));

  // 选中节点自身的图(成图/参考图)也作视觉引用
  const selfImage =
    selected.type === "reference"
      ? selected.imageUrl || null
      : selected.type === "generated"
        ? selected.resultUrl || null
        : null;

  const imageUrls: string[] = [];
  if (selfImage) imageUrls.push(selfImage);
  for (const node of upstreamNodes) {
    if (node.type === "reference" && node.imageUrl) imageUrls.push(node.imageUrl);
    else if (node.type === "generated" && node.resultUrl) imageUrls.push(node.resultUrl);
  }

  const texts: AssistantReferencePack["texts"] = [];
  if (selected.type === "prompt" && selected.prompt.trim()) {
    texts.push({ title: selected.title, body: selected.prompt.trim() });
  }
  for (const node of upstreamNodes) {
    if (node.type === "prompt" && node.prompt.trim()) {
      texts.push({ title: node.title, body: node.prompt.trim() });
    }
  }

  // 缩略铁律:入 messages 前统一传输管线(data: 校验+768 约束)
  const images: string[] = [];
  for (const url of imageUrls) {
    try {
      images.push(await prepareReferenceImageForTransfer(toPreviewSrc(url)));
    } catch {
      // 单张缩略失败跳过,不阻断对话
    }
  }

  const parts: string[] = [];
  if (images.length > 0) parts.push(`${images.length} 张图`);
  if (texts.length > 0) parts.push(`${texts.length} 段提示词`);
  const summaryZh = parts.length > 0 ? `引用:${parts.join("、")}` : "";

  return { images, texts, summaryZh };
}
