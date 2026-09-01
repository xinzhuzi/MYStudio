import { selectionBoundingBox, type ImageDataLike, type NormRect } from "./extraction-pixels";

/**
 * 蒙版导出(09-01-extraction-mask):
 * 本仓生图走 chat 多模态通道(image_url 数组,非 images/edits multipart),
 * 蒙版方案=「底图+半透明蒙版」叠加图作参考图 + 提示词蒙版指引(引擎零改动)。
 * 交互形态参考 infinite-canvas 蒙版对话框(研究档§三),实现从零(AGPL)。
 */

/** 蒙版重绘的提示词蒙版指引(追加在用户修改要求前) */
export function buildInpaintPrompt(userRequest: string): string {
  return `参考图中有半透明高亮蒙版区域。只重绘蒙版覆盖的区域:${userRequest}。蒙版外的其余画面必须保持原样不变。`;
}

export interface MaskExportResult {
  /** 底图+蒙版叠加(dataUrl,直接作生图参考图) */
  overlayDataUrl: string;
  /** 涂抹区归一化包围盒(血缘 region) */
  region: NormRect;
}

/**
 * 合成叠加图与包围盒。
 * @param baseImage 底图(解码后的 ImageData)
 * @param mask 涂抹蒙版(原分辨率,alpha>0=涂)
 * @param encode ImageData→dataUrl(注入,测试可替)
 */
export function exportMaskOverlay(
  baseImage: ImageDataLike,
  mask: ImageDataLike,
  encode: (image: ImageDataLike) => string,
): MaskExportResult | null {
  const region = selectionBoundingBox(mask);
  if (!region) return null;
  const overlay = new Uint8ClampedArray(baseImage.data);
  // 蒙版高亮:accent 金 hsl(42 92% 60%) ≈ rgb(246,197,71),半透明 45% 叠加
  for (let i = 0; i < overlay.length; i += 4) {
    if (mask.data[i + 3] > 0) {
      overlay[i] = Math.round(overlay[i] * 0.55 + 246 * 0.45);
      overlay[i + 1] = Math.round(overlay[i + 1] * 0.55 + 197 * 0.45);
      overlay[i + 2] = Math.round(overlay[i + 2] * 0.55 + 71 * 0.45);
    }
  }
  return {
    overlayDataUrl: encode({ width: baseImage.width, height: baseImage.height, data: overlay }),
    region,
  };
}
