/**
 * 模型族与工作流绑定域(1124 超线文件拆分:自 McpSettingsTab 原样搬出):
 * 产线族切换(写全局默认出图模型)+当前族工作流清单与双类型绑定。逻辑零改动。
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAppSettingsStore } from "@/stores/app/app-settings-store";
import { useWorkflowBindingsStore } from "@/stores/settings/workflow-bindings-store";
import { engineFamilyMeta } from "@/lib/studio/engine-line/family-catalog";
import { comfySidecarRequest } from "@/lib/comfyui/comfy/comfy-sidecar-bridge";

export function useEngineFamilyWorkflows() {
  // ── R2 模型族(1102 控制中心):真源=defaultImageModel;切换即切产线(Q1) ──
  const defaultImageModel = useAppSettingsStore(
    (s) => s.imageGenerationSettings.defaultImageModel,
  );
  const currentFamily = engineFamilyMeta(defaultImageModel);
  const handleFamilySwitch = (value: string) => {
    useAppSettingsStore
      .getState()
      .setImageGenerationSettings({ defaultImageModel: value });
    toast.success(
      `产线已切换:${value === "" ? "自动(本地即 Qwen-Image-2.1)" : value}`,
    );
  };

  // ── R3 工作流(1102):当前族域前缀拉清单(prefix+light),双类型绑定(Q3) ──
  const bindings = useWorkflowBindingsStore();
  const [familyWorkflows, setFamilyWorkflows] = useState<
    { id: string; name: string }[]
  >([]);
  const [workflowsLoading, setWorkflowsLoading] = useState(false);
  const [workflowsError, setWorkflowsError] = useState<string | null>(null);
  useEffect(() => {
    if (!currentFamily.workflowPrefix) {
      setFamilyWorkflows([]);
      return;
    }
    let cancelled = false;
    setWorkflowsLoading(true);
    setWorkflowsError(null);
    comfySidecarRequest<{
      engineOnline: boolean;
      workflows: { id: string; name: string }[];
    }>(
      "GET",
      `/comfy/workflows?prefix=${encodeURIComponent(currentFamily.workflowPrefix)}&light=true`,
    )
      .then((res) => {
        if (!cancelled) setFamilyWorkflows(res.workflows ?? []);
      })
      .catch(() => {
        if (!cancelled)
          setWorkflowsError("清单拉取失败(sidecar 未运行或引擎未启动)");
      })
      .finally(() => {
        if (!cancelled) setWorkflowsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentFamily.workflowPrefix]);
  const t2iCandidates = familyWorkflows.filter((w) =>
    w.id.includes("1_文生图"),
  );
  const i2iCandidates = familyWorkflows.filter((w) =>
    w.id.includes("2_图生图"),
  );

  return {
    defaultImageModel, currentFamily, handleFamilySwitch,
    bindings, familyWorkflows, workflowsLoading, workflowsError,
    t2iCandidates, i2iCandidates,
  };
}
