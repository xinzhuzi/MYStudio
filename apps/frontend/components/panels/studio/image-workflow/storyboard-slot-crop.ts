// 把分镜槽位的参考图裁成单人姿势(横图、竖图两种裁法与满幅判定)。2026-11-24 超线文件拆分:从 storyboard-canonical-context.ts 拆出;原文件仍是入口,对外导出不变。

// ── 单姿裁切(1116 第六病理三代修,移植自 2d312474 拼板层 singlePoseCropRect)──
// 命令原文(1115):「只有设定卡时,出图前裁/选正面单姿为参考,禁整卡」。
// 拼板退役时该刀被误删——赵四类无 _人物图_/_正视图_ 单姿资产,主图=横幅
// 多视图卡整卡进 image_1 → 引擎翻拍整卡=转面稿四副本(C1 二发 4/6 污染,
// Win history 实证守卫句在链仍压不住)。算法原样移植:探针列占用分析,
// 最左连续内容块(零桥接)=正面单姿;横幅(宽>高)才裁;场景恒不裁;
// 检测失败=丢槽留痕(宁缺勿染,禁整卡入参考)。
// 2d312474 原语义:竖幅已是单姿→原图保留;横幅裁不出→整图兜底(拼板贴格)。
// 本层取消整图兜底(整卡入参考即病理),但竖幅仍必须原样保留——竖幅被当
// 「裁切失败」丢槽会抽掉主角立绘(image_1),身份参考归零。
export const POSE_PROBE_WIDTH = 512;

export const POSE_BG_COLOR_DISTANCE = 60;

export const POSE_CONTENT_COLUMN_RATIO = 0.12;

export interface StoryboardCropImageSource {
  naturalWidth: number;
  naturalHeight: number;
}

export function singlePoseCropRect(
  image: StoryboardCropImageSource,
): { sx: number; sy: number; sw: number; sh: number } | null {
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
    analysis.drawImage(image as CanvasImageSource, 0, 0, probeWidth, probeHeight);
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
  let first = -1;
  let last = -1;
  for (let x = 0; x < probeWidth; x += 1) {
    if (hasContent[x]) { first = x; break; }
  }
  if (first < 0) return null;
  for (let x = first + 1; x < probeWidth; x += 1) {
    if (!hasContent[x]) break;
    last = x;
  }
  if (last < first + 2) return null;
  const bandRatio = (last - first + 1) / probeWidth;
  if (bandRatio < 0.08 || bandRatio > 0.92) return null;
  const sx = Math.round(first * fullWidth / probeWidth);
  const sw = Math.round((last - first + 1) * fullWidth / probeWidth);
  return { sx, sy: 0, sw, sh: fullHeight };
}

/** 1117 残项③:竖排多视图卡分析(竖幅 3 视图+2 配色形态)——按行带内容
 * 占用探测,最上连续内容块=首格(竖排版式正面);行占用分析复用横向
 * 探针参数,行列互换。 */
export function singlePoseCropRectVertical(
  image: StoryboardCropImageSource,
): { sx: number; sy: number; sw: number; sh: number } | null {
  const fullWidth = image.naturalWidth;
  const fullHeight = image.naturalHeight;
  if (!fullWidth || !fullHeight || fullHeight <= fullWidth) return null;
  const probeHeight = Math.min(POSE_PROBE_WIDTH, fullHeight);
  const probeWidth = Math.max(1, Math.round(fullWidth * probeHeight / fullHeight));
  let analysis: CanvasRenderingContext2D | null = null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = probeWidth;
    canvas.height = probeHeight;
    analysis = canvas.getContext("2d", { willReadFrequently: true });
    if (!analysis || typeof analysis.getImageData !== "function") return null;
    analysis.drawImage(image as CanvasImageSource, 0, 0, probeWidth, probeHeight);
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
  const bandLeft = Math.floor(probeWidth * 0.15);
  const bandRight = Math.max(bandLeft + 1, Math.floor(probeWidth * 0.9));
  const isBackground = (x: number, y: number): boolean => {
    const [r, g, b] = sample(x, y);
    const dr = r - bg[0]!, dg = g - bg[1]!, db = b - bg[2]!;
    return Math.sqrt(dr * dr + dg * dg + db * db) < POSE_BG_COLOR_DISTANCE;
  };
  const hasContent = new Array<boolean>(probeHeight);
  for (let y = 0; y < probeHeight; y += 1) {
    let content = 0;
    for (let x = bandLeft; x < bandRight; x += 1) {
      if (!isBackground(x, y)) content += 1;
    }
    hasContent[y] = content / (bandRight - bandLeft) >= POSE_CONTENT_COLUMN_RATIO;
  }
  let first = -1;
  let last = -1;
  for (let y = 0; y < probeHeight; y += 1) {
    if (hasContent[y]) { first = y; break; }
  }
  if (first < 0) return null;
  for (let y = first + 1; y < probeHeight; y += 1) {
    if (!hasContent[y]) break;
    last = y;
  }
  if (last < first + 2) return null;
  const bandRatio = (last - first + 1) / probeHeight;
  if (bandRatio < 0.08 || bandRatio > 0.92) return null;
  const sy = Math.round(first * fullHeight / probeHeight);
  const sh = Math.round((last - first + 1) * fullHeight / probeHeight);
  return { sx: 0, sy, sw: fullWidth, sh };
}

/** 整幅单内容判定(裁不出块时的单姿残余语义):中心十字带内容占用 >85%。
 */
export function isSinglePoseFullFrame(image: StoryboardCropImageSource): boolean {
  const fullWidth = image.naturalWidth;
  const fullHeight = image.naturalHeight;
  if (!fullWidth || !fullHeight) return false;
  const w = Math.min(64, fullWidth);
  const h = Math.max(1, Math.round(fullHeight * w / fullWidth));
  try {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(image as CanvasImageSource, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const sample = (x: number, y: number): [number, number, number] => {
      const at = (y * w + x) * 4;
      return [data[at]!, data[at + 1]!, data[at + 2]!];
    };
    const corners = [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3]] as const;
    const bg = corners.reduce(
      (acc, [cx, cy]) => {
        const c = sample(Math.max(0, Math.min(w - 1, cx)), Math.max(0, Math.min(h - 1, cy)));
        return [acc[0] + c[0] / 4, acc[1] + c[1] / 4, acc[2] + c[2] / 4] as [number, number, number];
      },
      [0, 0, 0] as [number, number, number],
    );
    const midX = Math.floor(w / 2);
    const midY = Math.floor(h / 2);
    let occupied = 0;
    let total = 0;
    for (let y = 0; y < h; y += 1) {
      const [r, g, b] = sample(midX, y);
      total += 1;
      const dr = r - bg[0]!, dg = g - bg[1]!, db = b - bg[2]!;
      if (Math.sqrt(dr * dr + dg * dg + db * db) >= POSE_BG_COLOR_DISTANCE) occupied += 1;
    }
    for (let x = 0; x < w; x += 1) {
      const [r, g, b] = sample(x, midY);
      total += 1;
      const dr = r - bg[0]!, dg = g - bg[1]!, db = b - bg[2]!;
      if (Math.sqrt(dr * dr + dg * dg + db * db) >= POSE_BG_COLOR_DISTANCE) occupied += 1;
    }
    return occupied / total > 0.85;
  } catch {
    return false;
  }
}

/** 槽位参考单姿化:character/prop 的横幅多视图卡 → canvas 裁正面单格 dataURL。
 *  竖幅(已是单姿立绘)= 原图保留(2d312474 原语义,禁丢槽);场景/前帧恒不裁;
 *  横幅裁不出=丢槽(留痕,宁缺勿染,禁整卡入参考)。 */
export async function cropSlotReferenceToSinglePose(
  dataUrl: string,
  role: string,
  loadImage: (source: string) => Promise<StoryboardCropImageSource | null> = loadCropSourceImage,
): Promise<string | null> {
  if (role !== "character" && role !== "prop") return dataUrl;
  const image = await loadImage(dataUrl);
  if (!image) return null;
  // 1117 残项③:S10 复发实录——「竖幅=单姿」假设不成立(独孤剑尘资产=
  // 竖幅 3 视图+2 配色,整卡直传→版式复制)。横幅走横向裁(原),竖幅先探
  // 竖排多视图(singlePoseCropRectVertical),两路都无块=整幅单内容判定
  // (占幅 >85%=真单姿保留,否则丢槽宁缺勿染)。
  const rect = image.naturalWidth > image.naturalHeight
    ? singlePoseCropRect(image)
    : singlePoseCropRectVertical(image);
  if (!rect) return isSinglePoseFullFrame(image) ? dataUrl : null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = rect.sw;
    canvas.height = rect.sh;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(image as CanvasImageSource, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, rect.sw, rect.sh);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

export async function loadCropSourceImage(dataUrl: string): Promise<StoryboardCropImageSource | null> {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => resolve(null), 3000); // 解码超时兜底(异常环境不挂链)
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.src = dataUrl;
  });
}
