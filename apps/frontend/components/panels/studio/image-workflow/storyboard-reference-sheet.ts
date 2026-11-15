import type { ImageWorkflowGraph } from "@/types/studio";
import { collapseTransparentNodes } from "@/lib/studio/image-workflow/graph-build";
import type { StoryboardSingleImageTransport } from "@/lib/studio/image-workflow/request";
import { IMAGE_ASPECT_RATIOS, type ImageAspectRatio } from "@/lib/ai/image-size-presets";

// 3×3 上限：每格 768px（640px 图像区 + 128px 预留区），总画布最多 5.31MP。
// 限制解码尺寸和传输体积，逐张解码绘制；任何超限均拒绝，绝不截掉参考。
// 1115 第六病理修(参考图种类错配,主会话处置令):①标签区不再画字——「图N｜角色」
// 烧进参考图会被模型抄进成图(分镜-11 实证),映射改由 prompt 句承担;②角色/道具
// 参考为横幅多视图设定卡时,按底色列占用裁最左单姿(转面卡正面居左约定),禁整卡
// 入格(分镜-1 赵四五视图卡实证=同角色多副本);场景参考合法横幅恒不裁。
const MAX_REFERENCES = 9;
const CELL_SIZE = 768;
const IMAGE_HEIGHT = 640;
const MAX_SOURCE_PIXELS = 32 * 1024 * 1024;
const MAX_SOURCE_EDGE = 8192;
const MAX_INPUT_CHARACTERS = 48 * 1024 * 1024;
/** 单姿裁切探针宽(px):列占用分析降采样上限,分析失败恒退整图不阻断生图。 */
const POSE_PROBE_WIDTH = 512;
/** 底色判定色距阈值(RGB 欧氏距离):奶油底/白底设定卡与人物内容的分界。 */
const POSE_BG_COLOR_DISTANCE = 60;
/** 判定为「内容列」的阈值:采样带内非底色像素占比高于该值。 */
const POSE_CONTENT_COLUMN_RATIO = 0.08;
/** 裁切结果合理性带:内容块宽占全宽比例低于/高于该带=检测不可信,退整图。 */
const POSE_BLOCK_MIN_RATIO = 0.08;
const POSE_BLOCK_MAX_RATIO = 0.92;

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
  // 每格参考的资产型(单视图裁切只对角色/道具;场景合法横幅恒不裁)。单参考
  // 形态无映射校验(既有宽容语义),裁切决策同样需要型信息,故独立于 labels 计算。
  const cellKinds = referenceImages.map((url) => {
    const node = connected.find((item) =>
      (item?.type === "reference" && item.imageUrl === url)
      || (item?.type === "generated" && item.resultUrl === url));
    return node?.type === "reference" && node.source?.kind === "asset"
      ? node.source.assetType
      : undefined;
  });
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
    // 1115 第六病理修:角色/道具横幅设定卡 → 最左单姿源矩形(检测失败=null=整图)
    const crop = singlePoseCropRect(image, cellKinds[index]);
    const sourceWidth = crop ? crop.sw : image.naturalWidth;
    const sourceHeight = crop ? crop.sh : image.naturalHeight;
    const scale = Math.min((CELL_SIZE - 32) / sourceWidth, (imageHeight - 32) / sourceHeight) * layoutScale;
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    const dx = x + (CELL_SIZE * layoutScale - width) / 2;
    const dy = y + (imageHeight * layoutScale - height) / 2;
    if (crop) {
      context.drawImage(image, crop.sx, crop.sy, crop.sw, crop.sh, dx, dy, width, height);
    } else {
      context.drawImage(image, dx, dy, width, height);
    }
    // 标签烧字废除(1115 第六病理):格内只画参考图本体——「图N｜角色」画进参考图
    // 会被模型当画面文字抄进成图(分镜-11 实证);图N↔格位映射由下方 prompt 句承担。
  }
  let imageUrl: string;
  try { imageUrl = canvas.toDataURL("image/png"); }
  catch { throw new Error("分镜参考拼板导出失败，请检查参考图跨域读取权限"); }
  if (!imageUrl.startsWith("data:image/png;")) throw new Error("分镜参考拼板导出为空");
  return {
    imageUrl,
    mappings: referenceImages.map((imageUrl, index) => ({ order: index + 1, imageUrl })),
    // 1115 第六病理修:尾段守卫句(主会话处置令原文语义)——参考图仅示身份与服装、
    // 同名角色仅出现一次、不重现参考图版式/多视角/背景/文字标注(已过 _gongbi_gate
    // negation_only 门,negation_only=True 口径实测零违规)。
    prompt: single ? "图1仅作身份/场景参考，留白仅用于参考布局。输出为一张完整连续的剧情画面，画面内容仅为场景、角色和道具；参考图仅示身份与服装，同名角色在画面中仅出现一次，画面以全新构图呈现；不重现参考图的版式、多视角、背景与任何文字标注。"
      : "【参考拼板映射】按从左到右、从上到下排列；"
      + labels.map((label, index) => `图${index + 1}对应拼板第${index + 1}格：${label.name}（${label.category}）`).join("；")
      + "。图N对应拼板第N格，仅作身份/场景参考，输出为一张完整连续的剧情画面，画面内容仅为场景、角色和道具；参考图仅示身份与服装，同名角色在画面中仅出现一次，画面以全新构图呈现；不重现参考图的版式、多视角、背景与任何文字标注。",
  };
}

/**
 * 单视图源矩形(1115 第六病理修,主会话处置令「只有设定卡时,出图前裁/选正面
 * 单姿为参考,禁整卡」):对角色/道具且横置(w>h)的参考图,以四角底色估计做列占用
 * 分析,取采样带内**最左连续内容块**(转面卡正面居左约定,零跨隙桥接——1116
 * 实测赵四/独孤剑尘/小杂役/铁山/妇人甲五卡:桥接会把相邻视图并块)为正面单姿;
 * 竖幅/方幅/场景/检测失败(含测试替身无 getImageData)一律返回 null=维持整图,
 * 绝不因裁切失败阻断生图。采样带跳过顶部 15%/底部 10%(卡面标题/角标/底注的
 * 常驻位),块宽落 [8%, 92%] 合理带外=检测不可信同样退整图(守卫句仍在线)。
 */
function singlePoseCropRect(
  image: HTMLImageElement,
  assetType: string | undefined,
): { sx: number; sy: number; sw: number; sh: number } | null {
  if (assetType !== "character" && assetType !== "prop") return null;
  const fullWidth = image.naturalWidth;
  const fullHeight = image.naturalHeight;
  if (!fullWidth || !fullHeight || fullWidth <= fullHeight) return null;
  const probeWidth = Math.min(POSE_PROBE_WIDTH, fullWidth);
  const probeHeight = Math.max(1, Math.round(fullHeight * probeWidth / fullWidth));
  let analysis: CanvasRenderingContext2D | null = null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = probeWidth;
    canvas.height = probeHeight;
    analysis = canvas.getContext("2d", { willReadFrequently: true });
    if (!analysis || typeof analysis.getImageData !== "function" || typeof analysis.drawImage !== "function") return null;
    analysis.drawImage(image, 0, 0, probeWidth, probeHeight);
  } catch {
    return null;
  }
  let pixels: Uint8ClampedArray;
  try {
    pixels = analysis.getImageData(0, 0, probeWidth, probeHeight).data;
  } catch {
    return null;
  }
  const sample = (x: number, y: number): [number, number, number] => {
    const at = (y * probeWidth + x) * 4;
    return [pixels[at]!, pixels[at + 1]!, pixels[at + 2]!];
  };
  const corners: Array<[number, number, number]> = [];
  for (const [cx, cy] of [[2, 2], [probeWidth - 3, 2], [2, probeHeight - 3], [probeWidth - 3, probeHeight - 3]] as const) {
    corners.push(sample(Math.max(0, Math.min(probeWidth - 1, cx)), Math.max(0, Math.min(probeHeight - 1, cy))));
  }
  const bg = corners.reduce(
    (acc, c) => [acc[0] + c[0] / 4, acc[1] + c[1] / 4, acc[2] + c[2] / 4] as [number, number, number],
    [0, 0, 0] as [number, number, number],
  );
  const bandTop = Math.floor(probeHeight * 0.15);
  const bandBottom = Math.max(bandTop + 1, Math.floor(probeHeight * 0.9));
  const isBackground = (x: number, y: number): boolean => {
    const [r, g, b] = sample(x, y);
    const dr = r - bg[0]!, dg = g - bg[1]!, db = b - bg[2]!;
    return Math.sqrt(dr * dr + dg * dg + db * db) < POSE_BG_COLOR_DISTANCE;
  };
  const hasContent = new Array<boolean>(probeWidth);
  for (let x = 0; x < probeWidth; x += 1) {
    let content = 0;
    for (let y = bandTop; y < bandBottom; y += 1) {
      if (!isBackground(x, y)) content += 1;
    }
    hasContent[x] = content / (bandBottom - bandTop) >= POSE_CONTENT_COLUMN_RATIO;
  }
  // 最左连续内容块(≥3 探针列起算,零桥接:块间断隙即视图边界)
  let first = -1;
  let last = -1;
  for (let x = 0; x < probeWidth; x += 1) {
    if (hasContent[x]) { first = x; break; }
  }
  if (first < 0) return null;
  for (let x = first; x < probeWidth && hasContent[x]; x += 1) last = x;
  if (last - first + 1 < 3) return null;
  const blockWidth = last - first + 1;
  if (blockWidth < probeWidth * POSE_BLOCK_MIN_RATIO || blockWidth > probeWidth * POSE_BLOCK_MAX_RATIO) return null;
  const margin = Math.round(probeWidth * 0.02);
  const sx = Math.max(0, Math.round(((first - margin) / probeWidth) * fullWidth));
  const sxEnd = Math.min(fullWidth, Math.round(((last + 1 + margin) / probeWidth) * fullWidth));
  return { sx, sy: 0, sw: Math.max(1, sxEnd - sx), sh: fullHeight };
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
