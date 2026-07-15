import { readImageAsBase64 } from "@/lib/image-storage";
import { prepareImageWorkflowReferenceImages } from "@/lib/studio/image-workflow-references";

export async function prepareReferenceImages(values: string[]) {
  return prepareImageWorkflowReferenceImages(values, {
    readProjectFileAsBase64: async (url) => window.projectFiles?.readAsBase64(url),
    readLocalImageAsBase64: readImageAsBase64,
  });
}

export function workflowImageRelativePath(workflowId: string, filename: string) {
  return `workflow-images/${safePathSegment(workflowId)}/${safePathSegment(filename)}`;
}

export function createWorkflowFilename(
  prefix: "ref" | "gen",
  id: string,
  sourceName: string,
) {
  const ext = safeExtension(sourceName);
  const base = safePathSegment(sourceName.replace(/\.[^.]+$/, "")) || prefix;
  return `${prefix}-${safePathSegment(id)}-${base}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
}

export function safePathSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "file";
}

export function safeExtension(value: string) {
  const match = value.match(/\.([a-z0-9]{2,8})$/i);
  return match ? `.${match[1].toLowerCase()}` : ".png";
}
