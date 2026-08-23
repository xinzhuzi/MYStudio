import { readImageAsBase64 } from "@/lib/media/image-storage";
import { getProjectFilesBridge } from "@/lib/bridge/project-files";
import { prepareImageWorkflowReferenceImages } from "@/lib/studio/image-workflow-references";
import {
  chapterScopeForWorkflowTarget,
  safePathSegment,
  workflowImageRelativePath,
} from "@/lib/studio/chapter-paths";

// 路径布局与章节作用域的实现在 @/lib/studio/chapter-paths(单一事实源);
// 此处 re-export 维持历史导入路径兼容。

export { chapterScopeForWorkflowTarget, safePathSegment, workflowImageRelativePath };

export async function prepareReferenceImages(values: string[]) {
  return prepareImageWorkflowReferenceImages(values, {
    readProjectFileAsBase64: async (url) => getProjectFilesBridge()?.readAsBase64(url),
    readLocalImageAsBase64: readImageAsBase64,
  });
}

export function createWorkflowFilename(
  prefix: "ref" | "gen" | "up4x",
  id: string,
  sourceName: string,
) {
  const ext = safeExtension(sourceName);
  const base = safePathSegment(sourceName.replace(/\.[^.]+$/, "")) || prefix;
  return `${prefix}-${safePathSegment(id)}-${base}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
}

export function safeExtension(value: string) {
  const match = value.match(/\.([a-z0-9]{2,8})$/i);
  return match ? `.${match[1].toLowerCase()}` : ".png";
}
