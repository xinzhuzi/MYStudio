import { aiManager } from "@/lib/ai/ai-manager";
import { pollImageTaskUrl } from "@/lib/storyboard/image-task-transport";

interface StoryboardGridLayout {
  columns: number;
  rows: number;
  actualCount: number;
}

type ImageGridRequest = Parameters<typeof aiManager.imageGrid>[0];
type SliceGridImage = (imageUrl: string, layout: StoryboardGridLayout) => Promise<string[]>;

interface ExecuteStoryboardGridGenerationOptions {
  request: ImageGridRequest;
  poll: { apiKey: string; baseUrl: string };
  layout: StoryboardGridLayout;
  signal?: AbortSignal;
  sliceImage?: SliceGridImage;
}

export async function sliceStoryboardGridImage(
  imageUrl: string,
  { columns, rows, actualCount }: StoryboardGridLayout,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      const tileWidth = Math.floor(image.width / columns);
      const tileHeight = Math.floor(image.height / rows);
      const results: string[] = [];
      for (let index = 0; index < actualCount; index += 1) {
        const row = Math.floor(index / columns);
        const column = index % columns;
        const canvas = document.createElement("canvas");
        canvas.width = tileWidth;
        canvas.height = tileHeight;
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("无法创建四宫格画布"));
          return;
        }
        context.drawImage(
          image,
          column * tileWidth,
          row * tileHeight,
          tileWidth,
          tileHeight,
          0,
          0,
          tileWidth,
          tileHeight,
        );
        results.push(canvas.toDataURL("image/png"));
      }
      resolve(results);
    };
    image.onerror = () => reject(new Error("加载四宫格图片失败"));
    image.src = imageUrl;
  });
}

export async function executeStoryboardGridGeneration({
  request,
  poll,
  layout,
  signal,
  sliceImage = sliceStoryboardGridImage,
}: ExecuteStoryboardGridGenerationOptions): Promise<{ gridImageUrl: string; slicedImages: string[] }> {
  signal?.throwIfAborted();
  const result = await aiManager.imageGrid(request);
  let gridImageUrl = result.imageUrl;
  if (!gridImageUrl && result.taskId) {
    gridImageUrl = await pollImageTaskUrl({
      taskId: result.taskId,
      apiKey: poll.apiKey,
      baseUrl: poll.baseUrl,
      signal,
    });
  }
  signal?.throwIfAborted();
  if (!gridImageUrl) throw new Error("未获取到四宫格图片 URL");
  const slicedImages = await sliceImage(gridImageUrl, layout);
  signal?.throwIfAborted();
  return { gridImageUrl, slicedImages };
}
