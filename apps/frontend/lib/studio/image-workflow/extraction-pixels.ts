/**
 * 取材像素管线(09-01-extraction-infra,零 canvas 依赖的核心):
 * 核心函数操作 ImageDataLike(纯类型数组数学),canvas 胶水(解码/编码)
 * 经注入提供——与 image-transfer.ts 的 loadRaster 注入同构,jsdom 可测。
 * 命名从零(AGPL 零抄写,见任务 Key Decisions)。
 */

/** 与 ImageData 同形的最小结构(测试可自造) */
export interface ImageDataLike {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export interface NormRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** 归一化区域 → 整像素窗口(与显示框取整同式:round 起点并向内收缩终点) */
export function normRectToPixelWindow(
  rect: NormRect,
  image: { width: number; height: number },
): { left: number; top: number; width: number; height: number } {
  const left = Math.round(clamp01(rect.x) * image.width);
  const top = Math.round(clamp01(rect.y) * image.height);
  const right = Math.round(clamp01(rect.x + rect.width) * image.width);
  const bottom = Math.round(clamp01(rect.y + rect.height) * image.height);
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

function newImageData(width: number, height: number): ImageDataLike {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/** 裁剪:source ImageData + 归一化框 → 裁剪结果(逐行拷贝,零插值) */
export function cropImageData(source: ImageDataLike, rect: NormRect): ImageDataLike {
  const win = normRectToPixelWindow(rect, source);
  const out = newImageData(win.width, win.height);
  for (let row = 0; row < win.height; row += 1) {
    const srcStart = ((win.top + row) * source.width + win.left) * 4;
    const dstStart = row * win.width * 4;
    out.data.set(source.data.subarray(srcStart, srcStart + win.width * 4), dstStart);
  }
  return out;
}

/** 行列切分:rows×cols 均分(余数格给靠右/靠下格,窗口含边界),返回行优先 N 份 */
export function splitImageData(
  source: ImageDataLike,
  rows: number,
  cols: number,
): ImageDataLike[] {
  const safeRows = Math.max(1, Math.min(4, Math.round(rows)));
  const safeCols = Math.max(1, Math.min(4, Math.round(cols)));
  const pieces: ImageDataLike[] = [];
  for (let row = 0; row < safeRows; row += 1) {
    for (let col = 0; col < safeCols; col += 1) {
      pieces.push(cropImageData(source, cellRect(safeRows, safeCols, row, col)));
    }
  }
  return pieces;
}

/** 第 row 行第 col 列(0 起)的归一化格框;余数分给靠右/靠下格保证无缝覆盖 */
export function cellRect(rows: number, cols: number, row: number, col: number): NormRect {
  const x0 = col / cols;
  const x1 = (col + 1) / cols;
  const y0 = row / rows;
  const y1 = (row + 1) / rows;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** split 每格的 derivedFrom.region(与 cellRect 同源,供血缘) */
export function cellRegion(rows: number, cols: number, row: number, col: number): NormRect {
  return cellRect(rows, cols, row, col);
}

/** 涂抹选区(ImageData,alpha>0 为涂)的归一化包围盒;空选区返回 null */
export function selectionBoundingBox(
  mask: ImageDataLike,
): { x: number; y: number; width: number; height: number } | null {
  let minX = mask.width;
  let minY = mask.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      if (mask.data[(y * mask.width + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return {
    x: minX / mask.width,
    y: minY / mask.height,
    width: (maxX - minX + 1) / mask.width,
    height: (maxY - minY + 1) / mask.height,
  };
}

/** 画布胶水:浏览器实现(测试注入替身) */
export interface ExtractionCanvasCodec {
  decode(source: string): Promise<ImageDataLike>;
  encode(image: ImageDataLike): string;
}

/** 浏览器 canvas 实现:URL/bitmap → ImageData;ImageData → PNG dataUrl */
export function createBrowserCanvasCodec(): ExtractionCanvasCodec {
  return {
    async decode(source) {
      const image = await loadImageElement(source);
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("画布 2D 上下文不可用");
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, canvas.width, canvas.height);
    },
    encode(image) {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("画布 2D 上下文不可用");
      context.putImageData(
        new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
        0,
        0,
      );
      return canvas.toDataURL("image/png");
    },
  };
}

function loadImageElement(source: string, timeoutMs = 10_000): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    // 挂起防护(实弹教训:协议图偶发既不 onload 也不 onerror → 确认链无声卡死)
    const timer = window.setTimeout(() => reject(new Error("图片加载超时")), timeoutMs);
    image.onload = () => {
      window.clearTimeout(timer);
      resolve(image);
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("图片加载失败"));
    };
    image.src = source;
  });
}
