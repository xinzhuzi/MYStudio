import type { ShotGroup } from "@/stores/sclass-store";
import { toast } from "sonner";
import type { BatchGenerationProgress, GroupGenerationResult } from "./sclass-generation-types";

type RunSClassBatchGenerationOptions = {
  groups: ShotGroup[];
  isAborted: () => boolean;
  generateGroup: (
    group: ShotGroup,
    options: { onProgress: (progress: number) => void },
  ) => Promise<GroupGenerationResult>;
  onBatchProgress?: (progress: BatchGenerationProgress) => void;
};

export async function runSClassBatchGeneration({
  groups,
  isAborted,
  generateGroup,
  onBatchProgress,
}: RunSClassBatchGenerationOptions): Promise<GroupGenerationResult[]> {
  if (groups.length === 0) {
    toast.error("没有镜头组");
    return [];
  }

  const groupsToGenerate = groups.filter(
    (group) => group.videoStatus === "idle" || group.videoStatus === "failed",
  );
  if (groupsToGenerate.length === 0) {
    toast.info("所有镜头组已生成或正在生成中");
    return [];
  }

  const results: GroupGenerationResult[] = [];
  toast.info(`开始逐组生成 ${groupsToGenerate.length} 个镜头组视频...`);

  for (let index = 0; index < groupsToGenerate.length; index++) {
    if (isAborted()) {
      toast.warning("已中止批量生成");
      break;
    }

    const group = groupsToGenerate[index];
    const reportProgress = () => onBatchProgress?.({
      total: groupsToGenerate.length,
      completed: index,
      current: group.id,
      results,
    });
    reportProgress();
    const result = await generateGroup(group, { onProgress: reportProgress });
    results.push(result);

    if (result.success) {
      toast.success(`组 ${index + 1}/${groupsToGenerate.length} 「${group.name}」生成完成`);
    } else {
      toast.error(`组 ${index + 1}/${groupsToGenerate.length} 「${group.name}」失败: ${result.error}`);
    }
  }

  onBatchProgress?.({
    total: groupsToGenerate.length,
    completed: groupsToGenerate.length,
    current: null,
    results,
  });
  const successCount = results.filter((result) => result.success).length;
  const failCount = results.filter((result) => !result.success).length;
  if (failCount === 0) {
    toast.success(`全部 ${successCount} 个镜头组生成完成 🎬`);
  } else {
    toast.warning(`生成完毕：${successCount} 成功，${failCount} 失败`);
  }

  return results;
}
