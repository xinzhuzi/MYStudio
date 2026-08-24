import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { useMediaPanelStore } from "@/stores/navigation/media-panel-store";
import {
  getUpscaleRuntimeBridge,
} from "@/lib/bridge/upscale-runtime";
import { runUpscaleImage } from "@/lib/upscale/client";
import { checkUpscaleModelReady } from "@/lib/upscale/upscale-model-precheck";
import {
  mediaRefRequestPath,
  parseUpscaleMediaRef,
  siblingOutputRef,
  type UpscaleMediaRef,
} from "@/lib/upscale/project-file-url";
import { setGeneratedImageResult, setGeneratedImageStatus } from "@/lib/studio/image-workflow";
import { useProjectStore } from "@/stores/project/project-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { ImageWorkflowGraph } from "@/types/studio";
import type { UpscaleArtifact } from "@/types/upscale";
import { createWorkflowFilename } from "./image-workflow-file-utils";

export interface UpscaleImageSuccess {
  outputUrl: string;
  outputRelativePath: string;
  artifact: UpscaleArtifact;
}

export interface UpscaleBatchFailure {
  nodeId: string;
  title: string;
  message: string;
}

export interface UpscaleBatchState {
  running: boolean;
  total: number;
  completed: number;
  failed: number;
  currentNodeTitle: string | undefined;
  failures: UpscaleBatchFailure[];
}

const IDLE_BATCH: UpscaleBatchState = {
  running: false,
  total: 0,
  completed: 0,
  failed: 0,
  currentNodeTitle: undefined,
  failures: [],
};

/** Surface the missing-model toast with the 去设置 deep-link (depth pattern). */
export function notifyUpscaleModelMissing(): void {
  toast.error(
    "超分模型未下载，无法进行 4K 放大。请前往 设置 → 本地配置 → 图片超分 下载模型（默认动漫插画 6B，约 18 MB）",
    {
      action: {
        label: "去设置",
        onClick: () => {
          const nav = useMediaPanelStore.getState();
          nav.requestSettingsTab("plugins");
          nav.setActiveTab("settings");
        },
      },
    },
  );
}

/** Returns false when the upscale action should be aborted (toast already shown). */
export async function guardUpscaleReadiness(): Promise<boolean> {
  const readiness = await checkUpscaleModelReady();
  if (readiness === "missing") {
    notifyUpscaleModelMissing();
    return false;
  }
  if (readiness === "unknown") {
    toast.error("图片超分仅在桌面应用中可用");
    return false;
  }
  return true;
}

/**
 * Super-resolve one project image (any project-file:// URL) with the active
 * model. The output lands next to the source with an `up4x-` filename.
 */
export async function upscaleProjectImage(input: {
  imageUrl: string;
  title: string;
  shotId?: string;
  idForFilename: string;
  activeModel: string;
}): Promise<UpscaleImageSuccess> {
  const ref = parseUpscaleMediaRef(input.imageUrl);
  if (!ref) {
    throw new Error("图片不在应用存储内，无法超分");
  }
  const filename = createWorkflowFilename("up4x", input.idForFilename, `${input.title}.png`);
  const outputUrl = siblingOutputRef(ref, filename);
  if (!outputUrl) {
    throw new Error("无法确定超分输出路径");
  }
  // 请求载荷携带与输入同形态的引用:project-file → 项目相对路径,
  // local-image → URL,asset-file → 虚拟 URL。主进程按各自根域解析。
  const outputRequestRef: UpscaleMediaRef = ref.kind === "project-file"
    ? { kind: "project-file", projectId: ref.projectId, relativePath: siblingProjectPathForReport(ref.relativePath, filename) }
    : ref.kind === "asset-file"
      ? { kind: "asset-file", relativePath: siblingProjectPathForReport(ref.relativePath, filename) }
      : { kind: "local-image", category: ref.category, filename };
  const outputRelativePath: string = outputRequestRef.kind === "project-file" ? outputRequestRef.relativePath : filename;
  const artifact = await runUpscaleImage({
    schemaVersion: 1,
    projectId: ref.kind === "project-file" ? ref.projectId : "local-media",
    ...(input.shotId ? { shotId: input.shotId } : {}),
    model: input.activeModel,
    inputImagePath: mediaRefRequestPath(ref),
    outputImagePath: mediaRefRequestPath(outputRequestRef),
  });
  if (artifact.status !== "accepted") {
    throw new Error(artifact.message || `超分失败 (${artifact.code ?? "unknown"})`);
  }
  return {
    outputUrl,
    outputRelativePath,
    artifact,
  };
}

function siblingProjectPathForReport(relativePath: string, filename: string): string {
  const segments = relativePath.split("/");
  segments[segments.length - 1] = filename;
  return segments.join("/");
}

export async function fetchActiveModel(): Promise<string> {
  const bridge = getUpscaleRuntimeBridge();
  if (!bridge) throw new Error("图片超分仅在桌面应用中可用");
  const status = await bridge.status();
  return status.activeModel || "realesrgan-x4plus-anime-6b";
}

type UseImageWorkflowUpscaleOptions = {
  workflowId?: string;
  saveGraph: (graph: ImageWorkflowGraph) => void;
  addMaterial: (input: { name: string; localPath: string; size: number }) => string;
};

/**
 * Upscale actions for the image workflow canvas — single node ("超分 4K") and
 * the sequential multi-select batch queue with progress + cancel.
 */
export function useImageWorkflowUpscale({
  workflowId,
  saveGraph,
  addMaterial,
}: UseImageWorkflowUpscaleOptions) {
  const [isUpscaling, setIsUpscaling] = useState(false);
  const [batch, setBatch] = useState<UpscaleBatchState>(IDLE_BATCH);
  const cancelRef = useRef(false);

  const registerMaterial = useCallback((title: string, outputUrl: string, size: number) => {
    addMaterial({
      name: `${title}.png`,
      localPath: outputUrl,
      size: size > 0 ? size : 0,
    });
  }, [addMaterial]);

  const upscaleNode = useCallback(async (nodeId: string) => {
    const graph = useStudioStore.getState().imageWorkflows.find((item) => item.id === workflowId);
    if (!graph) return;
    const node = graph.nodes.find((item) => item.id === nodeId);
    if (!node || node.type !== "generated" || !node.resultUrl) {
      toast.error("该节点还没有成图，无法超分");
      return;
    }
    if (!(await guardUpscaleReadiness())) return;

    const projectId = useProjectStore.getState().activeProjectId;
    if (!projectId) {
      toast.error("请先选择项目");
      return;
    }

    setIsUpscaling(true);
    saveGraph(setGeneratedImageStatus(graph, nodeId, "generating"));
    try {
      const activeModel = await fetchActiveModel();
      const title = node.title || "workflow-image";
      const result = await upscaleProjectImage({
        imageUrl: node.resultUrl,
        title,
        idForFilename: nodeId,
        activeModel,
      });
      const filename = result.outputRelativePath.split("/").pop() ?? `${title}.png`;
      registerMaterial(filename.replace(/\.[^.]+$/, ""), result.outputUrl, result.artifact.outputBytes ?? 0);
      const latest = useStudioStore.getState().imageWorkflows.find((item) => item.id === graph.id) ?? graph;
      saveGraph(setGeneratedImageResult(latest, nodeId, {
        imageUrl: result.outputUrl,
      }));
      toast.success(
        `超分完成：${result.artifact.width}×${result.artifact.height}(×${result.artifact.scale}，${result.artifact.elapsedSeconds ?? "?"}s)`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "超分失败";
      const latest = useStudioStore.getState().imageWorkflows.find((item) => item.id === graph.id) ?? graph;
      saveGraph(setGeneratedImageStatus(latest, nodeId, "failed", message));
      toast.error(message);
    } finally {
      setIsUpscaling(false);
    }
  }, [registerMaterial, saveGraph, workflowId]);

  const cancelBatch = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const upscaleBatch = useCallback(async (entries: Array<{ nodeId: string; title: string; resultUrl: string }>) => {
    if (entries.length === 0) return;
    if (!(await guardUpscaleReadiness())) return;
    const projectId = useProjectStore.getState().activeProjectId;
    if (!projectId) {
      toast.error("请先选择项目");
      return;
    }

    cancelRef.current = false;
    const failures: UpscaleBatchFailure[] = [];
    let completed = 0;
    setBatch({
      running: true,
      total: entries.length,
      completed: 0,
      failed: 0,
      currentNodeTitle: entries[0]?.title,
      failures: [],
    });

    try {
      const activeModel = await fetchActiveModel();
      for (const entry of entries) {
        if (cancelRef.current) break;
        setBatch((previous) => ({ ...previous, currentNodeTitle: entry.title }));
        const graph = useStudioStore.getState().imageWorkflows.find((item) => item.id === workflowId);
        if (!graph) break;
        saveGraph(setGeneratedImageStatus(graph, entry.nodeId, "generating"));
        try {
          const result = await upscaleProjectImage({
            imageUrl: entry.resultUrl,
            title: entry.title || "workflow-image",
            idForFilename: entry.nodeId,
            activeModel,
          });
          const filename = result.outputRelativePath.split("/").pop() ?? `${entry.title}.png`;
          registerMaterial(filename.replace(/\.[^.]+$/, ""), result.outputUrl, result.artifact.outputBytes ?? 0);
          const latest = useStudioStore.getState().imageWorkflows.find((item) => item.id === graph.id) ?? graph;
          saveGraph(setGeneratedImageResult(latest, entry.nodeId, {
            imageUrl: result.outputUrl,
          }));
          completed += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : "超分失败";
          failures.push({ nodeId: entry.nodeId, title: entry.title, message });
          const latest = useStudioStore.getState().imageWorkflows.find((item) => item.id === graph.id) ?? graph;
          saveGraph(setGeneratedImageStatus(latest, entry.nodeId, "failed", message));
        }
        setBatch((previous) => ({
          ...previous,
          completed,
          failed: failures.length,
          failures: [...failures],
        }));
      }
    } finally {
      setBatch((previous) => ({ ...previous, running: false, currentNodeTitle: undefined }));
      if (cancelRef.current) {
        toast.info("批量超分已取消");
      } else if (failures.length > 0) {
        toast.error(`批量超分完成：成功 ${completed}，失败 ${failures.length}`);
      } else {
        toast.success(`批量超分完成：${completed} 张已放大`);
      }
    }
  }, [registerMaterial, saveGraph, workflowId]);

  return {
    isUpscaling,
    batch,
    upscaleNode,
    upscaleBatch,
    cancelBatch,
  };
}
