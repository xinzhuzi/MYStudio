// 产物中心「章节整理」执行器:目录移动(同盘 rename)→ store 引用深改写 → 抽样验证。
// 失败自动回滚已移动项;扫描基于持久化 URL,重复执行自动跳过已整理项(幂等)。
import { useCallback } from "react";
import { getProjectFilesBridge } from "@/lib/bridge/project-files";
import {
  collectLegacyStoryboardFlowPlans,
  rewriteChapterArtifactReferences,
  type ChapterMigrationPlanItem,
} from "@/lib/studio/chapter-artifact-migration";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { ImageWorkflowGraph } from "@/types/studio";

export type ChapterMigrationRunResult =
  | { status: "clean" }
  | { status: "done"; moved: number; refsReplaced: number }
  | { status: "failed"; error: string; rolledBack: number };

/** 取每个计划目录的一个代表性 URL(旧布局),用于迁移后抽样验证 */
function sampleLegacyUrl(graphs: ReadonlyArray<ImageWorkflowGraph>, plan: ChapterMigrationPlanItem): string | null {
  for (const graph of graphs) {
    for (const node of graph.nodes) {
      const imageUrl = (node as { imageUrl?: unknown }).imageUrl;
      if (typeof imageUrl === "string" && imageUrl.includes(`/${plan.flowDir}/`)) return imageUrl;
    }
  }
  return null;
}

function rewriteUrl(url: string, plans: ReadonlyArray<ChapterMigrationPlanItem>): string {
  let next = url;
  for (const plan of plans) {
    next = next.split(`${plan.flowDir}/`).join(`${plan.toDir}/`);
  }
  return next;
}

export function useChapterArtifactMigration(projectId: string | null | undefined) {
  const scan = useCallback((): { plans: ChapterMigrationPlanItem[]; graphs: ReadonlyArray<ImageWorkflowGraph> } => {
    const graphs = useStudioStore.getState().imageWorkflows;
    return { plans: collectLegacyStoryboardFlowPlans(graphs), graphs };
  }, []);

  const run = useCallback(async (): Promise<ChapterMigrationRunResult> => {
    const bridge = getProjectFilesBridge();
    if (!projectId) return { status: "failed", error: "请先选择项目", rolledBack: 0 };
    if (!bridge?.move || !bridge?.getAbsolutePath) {
      return { status: "failed", error: "当前环境不支持项目内文件移动", rolledBack: 0 };
    }
    const { plans, graphs } = scan();
    if (plans.length === 0) return { status: "clean" };

    const moved: ChapterMigrationPlanItem[] = [];
    try {
      for (const plan of plans) {
        const result = await bridge.move({
          projectId,
          fromRelative: plan.flowDir,
          toRelative: plan.toDir,
        });
        if (!result.success) throw new Error(`${plan.flowDir}: ${result.error ?? "移动失败"}`);
        moved.push(plan);
      }
    } catch (error) {
      // 回滚:已移动目录逐个移回原位;回滚本身失败仅记录,不掩盖主错误
      let rolledBack = 0;
      for (const plan of [...moved].reverse()) {
        try {
          const undo = await bridge.move({ projectId, fromRelative: plan.toDir, toRelative: plan.flowDir });
          if (undo.success) rolledBack += 1;
        } catch { /* 尽力回滚 */ }
      }
      return {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        rolledBack,
      };
    }

    // 全部移动成功 → 改写 store 引用(分镜/素材库/任务台账/工作流图同一次深改写)
    let refsReplaced = 0;
    useStudioStore.setState((state) => {
      const { value, replacedCount } = rewriteChapterArtifactReferences(state, plans);
      refsReplaced = replacedCount;
      return value;
    });

    // 抽样验证:每个目录的代表性 URL 经改写后应能解析到真实文件
    let verified = 0;
    for (const plan of plans) {
      const legacyUrl = sampleLegacyUrl(graphs, plan);
      if (!legacyUrl) continue;
      const newPath = await bridge.getAbsolutePath(rewriteUrl(legacyUrl, plans));
      if (newPath) verified += 1;
    }
    if (verified === 0) {
      return {
        status: "failed",
        error: "迁移后验证失败:未发现任何可解析的新引用(请勿重复操作,联系支持)",
        rolledBack: 0,
      };
    }

    return { status: "done", moved: plans.length, refsReplaced };
  }, [projectId, scan]);

  return { scan, run };
}
