export type StoryboardGridTargetAspect = "16:9" | "9:16";

export async function sliceStoryboardMergedGridImage(
  gridImageUrl: string,
  actualCount: number,
  columns: number,
  rows: number,
  targetAspect: StoryboardGridTargetAspect,
): Promise<string[]> {
  const targetAspectWidth = targetAspect === "16:9" ? 16 : 9;
  const targetAspectHeight = targetAspect === "16:9" ? 9 : 16;
  const targetRatio = targetAspectWidth / targetAspectHeight;

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      const rawTileWidth = Math.floor(image.width / columns);
      const rawTileHeight = Math.floor(image.height / rows);
      const rawRatio = rawTileWidth / rawTileHeight;
      let outputWidth: number;
      let outputHeight: number;
      let cropX = 0;
      let cropY = 0;
      let cropWidth = rawTileWidth;
      let cropHeight = rawTileHeight;

      if (Math.abs(rawRatio - targetRatio) < 0.01) {
        outputWidth = rawTileWidth;
        outputHeight = rawTileHeight;
      } else if (rawRatio > targetRatio) {
        cropWidth = Math.floor(rawTileHeight * targetRatio);
        cropX = Math.floor((rawTileWidth - cropWidth) / 2);
        outputWidth = cropWidth;
        outputHeight = rawTileHeight;
      } else {
        cropHeight = Math.floor(rawTileWidth / targetRatio);
        cropY = Math.floor((rawTileHeight - cropHeight) / 2);
        outputWidth = rawTileWidth;
        outputHeight = cropHeight;
      }

      const safetyMargin = 0.005;
      const marginWidth = Math.floor(cropWidth * safetyMargin);
      const marginHeight = Math.floor(cropHeight * safetyMargin);

      if (targetAspect === "16:9") {
        outputHeight = Math.round(outputWidth * 9 / 16);
      } else {
        outputWidth = Math.round(outputHeight * 9 / 16);
      }

      console.log(`[MergedGen] Slice: raw ${rawTileWidth}×${rawTileHeight} → crop ${cropWidth}×${cropHeight} (margin ${marginWidth}px) → output ${outputWidth}×${outputHeight} (Strict ${targetAspect})`);

      const results: string[] = [];
      for (let index = 0; index < actualCount; index += 1) {
        const tileRow = Math.floor(index / columns);
        const tileColumn = index % columns;
        const canvas = document.createElement("canvas");
        canvas.width = outputWidth;
        canvas.height = outputHeight;
        const context = canvas.getContext("2d")!;
        const sourceX = tileColumn * rawTileWidth + cropX + marginWidth;
        const sourceY = tileRow * rawTileHeight + cropY + marginHeight;
        const sourceWidth = cropWidth - marginWidth * 2;
        const sourceHeight = cropHeight - marginHeight * 2;

        context.drawImage(
          image,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          0,
          0,
          outputWidth,
          outputHeight,
        );
        results.push(canvas.toDataURL("image/png"));
      }
      resolve(results);
    };
    image.onerror = () => reject(new Error("加载九宫格图片失败"));
    image.src = gridImageUrl;
  });
}
