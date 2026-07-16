import type { PersistResult } from "@/lib/utils/image-persist";
import type { MergedFrameTask } from "./storyboard-merged-grid-utils";

interface MediaWritebackInput {
  url: string;
  name: string;
  type: "image";
  source: "ai-image";
  folderId: string;
  projectId?: string;
}

interface WriteStoryboardMergedImagesOptions {
  tasks: MergedFrameTask[];
  images: string[];
  signal?: AbortSignal;
  folderId: string;
  projectId?: string;
  persistImage: (image: string, sceneId: number, frameType: "first" | "end") => Promise<PersistResult>;
  updateFirstFrame: (
    sceneId: number,
    localPath: string,
    width?: number,
    height?: number,
    httpUrl?: string,
  ) => void;
  updateEndFrame: (
    sceneId: number,
    localPath: string,
    source: "ai-generated",
    httpUrl?: string,
  ) => void;
  addMedia: (input: MediaWritebackInput) => unknown;
}

export async function writeStoryboardMergedImages({
  tasks,
  images,
  folderId,
  projectId,
  persistImage,
  updateFirstFrame,
  updateEndFrame,
  addMedia,
  signal,
}: WriteStoryboardMergedImagesOptions): Promise<void> {
  for (let index = 0; index < tasks.length; index += 1) {
    signal?.throwIfAborted();
    const task = tasks[index];
    const image = images[index];
    if (!image) continue;
    const frameType = task.type === "end" ? "end" : "first";
    const result = await persistImage(image, task.scene.id, frameType);
    signal?.throwIfAborted();
    const httpUrl = result.httpUrl || undefined;

    if (httpUrl) {
      console.log(`[MergedGen] 分镜 ${task.scene.id + 1} ${task.type === "end" ? "尾帧" : "首帧"} 已上传到图床:`, httpUrl.substring(0, 60));
    }

    if (task.type === "end") {
      updateEndFrame(task.scene.id, result.localPath, "ai-generated", httpUrl);
      addMedia({
        url: result.localPath,
        name: `分镜 ${task.scene.id + 1} - 尾帧`,
        type: "image",
        source: "ai-image",
        folderId,
        projectId,
      });
    } else {
      updateFirstFrame(task.scene.id, result.localPath, task.scene.width, task.scene.height, httpUrl);
      addMedia({
        url: result.localPath,
        name: `分镜 ${task.scene.id + 1} - 首帧`,
        type: "image",
        source: "ai-image",
        folderId,
        projectId,
      });
    }
  }
}
