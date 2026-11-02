import type { ImageWorkflowGraph } from "@/types/studio";
import { collapseTransparentNodes } from "@/lib/studio/image-workflow/graph-build";
import type { StoryboardSingleImageTransport } from "@/lib/studio/image-workflow/request";
import { IMAGE_ASPECT_RATIOS, type ImageAspectRatio } from "@/lib/ai/image-size-presets";

// 3×3 上限：每格 768px（640px 图像区 + 128px 标签区），总画布最多 5.31MP。
// 限制解码尺寸和传输体积，逐张解码绘制；任何超限均拒绝，绝不截掉参考。
const MAX_REFERENCES = 9;
const CELL_SIZE = 768;
const IMAGE_HEIGHT = 640;
const MAX_SOURCE_PIXELS = 32 * 1024 * 1024;
const MAX_SOURCE_EDGE = 8192;
const MAX_INPUT_CHARACTERS = 48 * 1024 * 1024;

export async function buildStoryboardReferenceSheet(input: {
  graph: ImageWorkflowGraph;
  targetNodeId: string;
  referenceImages: string[];
  preparedReferenceImages: string[];
  /** 仅分镜传输指定；缺省保留既有拼板尺寸。 */
  aspectRatio?: string;
}): Promise<{ imageUrl: string; prompt: string; mappings: StoryboardSingleImageTransport["mappings"] }> {
  const { referenceImages, preparedReferenceImages } = input;
  if (input.aspectRatio !== undefined && !IMAGE_ASPECT_RATIOS.includes(input.aspectRatio as ImageAspectRatio)) {
    throw new Error("分镜参考画幅不受支持，请使用已配置的图片画幅");
  }
  const minimum = input.aspectRatio === undefined ? 2 : 1;
  if (referenceImages.length < minimum || referenceImages.length > MAX_REFERENCES) {
    throw new Error(`分镜参考拼板仅支持 ${minimum}–${MAX_REFERENCES} 张参考图（每格 768px），请调整参考配置`);
  }
  if (preparedReferenceImages.length !== referenceImages.length) {
    throw new Error("分镜参考拼板准备前后数量不一致，禁止丢弃参考图");
  }
  if (preparedReferenceImages.reduce((sum, url) => sum + url.length, 0) > MAX_INPUT_CHARACTERS) {
    throw new Error("分镜参考拼板输入超过 48Mi 字符传输上限，请缩小参考图后重试");
  }
  const graph = collapseTransparentNodes(input.graph);
  const connected = graph.edges.filter((edge) => edge.target === input.targetNodeId)
    .map((edge) => graph.nodes.find((node) => node.id === edge.source));
  const single = referenceImages.length === 1;
  const labels = (single ? [] : referenceImages).map((url, index) => {
    const matches = connected.filter((node) =>
      (node?.type === "reference" && node.imageUrl === url)
      || (node?.type === "generated" && node.resultUrl === url));
    const descriptions = matches.map((node) => {
      const category = node?.type === "generated" ? "上游成图"
        : node?.type === "reference" && node.source?.kind === "asset" && node.source.assetType
          ? ({ character: "角色", scene: "场景", prop: "道具" }[node.source.assetType])
          : node?.type === "reference" && node.source?.kind === "storyboard" ? "分镜帧" : undefined;
      if (!category || !node?.title.trim()) throw new Error(`图${index + 1}无法精确取得参考资产名/类别`);
      return { name: node.title.trim(), category };
    });
    const label = descriptions[0];
    if (!label || descriptions.some((entry) => entry.name !== label.name || entry.category !== label.category)) {
      throw new Error(`图${index + 1}参考 URL 的节点映射缺失或有歧义`);
    }
    if (Array.from(label.name).length > 80 || /[\r\n]/.test(label.name)) {
      throw new Error(`图${index + 1}资产名超过 80 字或含换行，无法完整标注`);
    }
    return label;
  });
  const columns = Math.ceil(Math.sqrt(referenceImages.length));
  const layoutWidth = columns * CELL_SIZE;
  const layoutHeight = Math.ceil(referenceImages.length / columns) * CELL_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = layoutWidth;
  canvas.height = layoutHeight;
  if (input.aspectRatio !== undefined) {
    // 先经有限契约白名单再取整数比例；尺寸按像素预算缩放，绝不由任意比值扩容。
    const [ratioWidth, ratioHeight] = input.aspectRatio.split(":").map(Number);
    const units = Math.min(
      Math.ceil(Math.max(layoutWidth / ratioWidth, layoutHeight / ratioHeight)),
      Math.floor(Math.sqrt((3 * CELL_SIZE) ** 2 / (ratioWidth * ratioHeight))),
    );
    canvas.width = ratioWidth * units;
    canvas.height = ratioHeight * units;
  }
  const layoutScale = Math.min(canvas.width / layoutWidth, canvas.height / layoutHeight);
  const offsetX = (canvas.width - layoutWidth * layoutScale) / 2;
  const offsetY = (canvas.height - layoutHeight * layoutScale) / 2;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("分镜参考拼板 Canvas 不可用");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < preparedReferenceImages.length; index++) {
    const image = await loadReferenceImage(preparedReferenceImages[index], index + 1);
    if (!image.naturalWidth || !image.naturalHeight
      || image.naturalWidth > MAX_SOURCE_EDGE || image.naturalHeight > MAX_SOURCE_EDGE
      || image.naturalWidth * image.naturalHeight > MAX_SOURCE_PIXELS) {
      throw new Error(`图${index + 1}尺寸无效或超过单边 8192px / 32MP 解码上限`);
    }
    const x = offsetX + (index % columns) * CELL_SIZE * layoutScale;
    const y = offsetY + Math.floor(index / columns) * CELL_SIZE * layoutScale;
    const imageHeight = single ? CELL_SIZE : IMAGE_HEIGHT;
    const scale = Math.min((CELL_SIZE - 32) / image.naturalWidth, (imageHeight - 32) / image.naturalHeight) * layoutScale;
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    context.drawImage(image, x + (CELL_SIZE * layoutScale - width) / 2, y + (imageHeight * layoutScale - height) / 2, width, height);
    if (single) continue;
    context.fillStyle = "#111111";
    context.font = `bold ${24 * layoutScale}px sans-serif`;
    context.textBaseline = "top";
    context.fillText(`图${index + 1}｜${labels[index].category}`, x + 16 * layoutScale, y + (IMAGE_HEIGHT + 8) * layoutScale);
    context.font = `${22 * layoutScale}px sans-serif`;
    let line = "";
    let lineY = y + (IMAGE_HEIGHT + 38) * layoutScale;
    for (const char of Array.from(labels[index].name)) {
      if (line && context.measureText(line + char).width > (CELL_SIZE - 32) * layoutScale) {
        context.fillText(line, x + 16 * layoutScale, lineY);
        lineY += 26 * layoutScale;
        line = "";
      }
      line += char;
    }
    if (lineY + 26 * layoutScale > y + CELL_SIZE * layoutScale) throw new Error(`图${index + 1}资产名无法完整标注`);
    context.fillText(line, x + 16 * layoutScale, lineY);
  }
  let imageUrl: string;
  try { imageUrl = canvas.toDataURL("image/png"); }
  catch { throw new Error("分镜参考拼板导出失败，请检查参考图跨域读取权限"); }
  if (!imageUrl.startsWith("data:image/png;")) throw new Error("分镜参考拼板导出为空");
  return {
    imageUrl,
    mappings: referenceImages.map((imageUrl, index) => ({ order: index + 1, imageUrl })),
    prompt: single ? "图1仅作身份/场景参考，留白仅用于参考布局。输出为一张完整连续的剧情画面，画面内容仅为场景、角色和道具。"
      : "【参考拼板映射】按从左到右、从上到下排列；"
      + labels.map((label, index) => `图${index + 1}对应拼板第${index + 1}格：${label.name}（${label.category}）`).join("；")
      + "。图N对应拼板第N格，仅作身份/场景参考，输出为一张完整连续的剧情画面，画面内容仅为场景、角色和道具。",
  };
}

function loadReferenceImage(url: string, order: number): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timeout = setTimeout(() => reject(new Error(`图${order}参考图解码超时（15秒）`)), 15000);
    image.onload = () => { clearTimeout(timeout); resolve(image); };
    image.onerror = () => { clearTimeout(timeout); reject(new Error(`图${order}参考图无法解码`)); };
    if (/^https?:/i.test(url)) image.crossOrigin = "anonymous";
    image.src = url;
  });
}
