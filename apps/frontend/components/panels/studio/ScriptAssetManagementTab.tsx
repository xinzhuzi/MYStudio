import type { ReactNode } from "react";
import { AssetsTab } from "./AssetsTab";
import { ScriptAssetGenerationTab } from "./ScriptAssetGenerationTab";
import { useStudioStore } from "@/stores/studio-store";

export function ScriptAssetManagementTab({
  novelChapters,
  agentWorkData,
  entityExtractions,
  extractAssets,
  updateExtraction,
  setHeaderActions,
  productionEpisodeId,
  scriptPlanCount,
  hasSeriesBible,
}: {
  novelChapters: ReturnType<typeof useStudioStore.getState>["novelChapters"];
  agentWorkData: ReturnType<typeof useStudioStore.getState>["agentWorkData"];
  entityExtractions: ReturnType<
    typeof useStudioStore.getState
  >["entityExtractions"];
  extractAssets: (episodeId: string) => Promise<void> | void;
  updateExtraction: (
    batch: ReturnType<
      typeof useStudioStore.getState
    >["entityExtractions"][number],
  ) => void;
  setHeaderActions: (actions: ReactNode) => void;
  productionEpisodeId: string;
  scriptPlanCount: number;
  hasSeriesBible: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-col gap-4 pb-5">
      <section className="min-h-0">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">资产提取</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              先从当前剧本提取角色、场景、道具，并同步检查资产库状态。
            </p>
          </div>
        </div>
        <AssetsTab
          novelChapters={novelChapters}
          agentWorkData={agentWorkData}
          entityExtractions={entityExtractions}
          extractAssets={extractAssets}
          updateExtraction={updateExtraction}
          setHeaderActions={setHeaderActions}
        />
      </section>

      <section className="min-h-[520px] overflow-hidden rounded-lg border border-border/70">
        <ScriptAssetGenerationTab
          title="资产生成"
          description="承接本阶段已提取的角色、场景、道具，手动推进提示词、图片资产、衍生资产和角色音频样本。"
          emptyExtractStageLabel="本阶段"
          productionEpisodeId={productionEpisodeId}
          scriptPlanCount={scriptPlanCount}
          hasSeriesBible={hasSeriesBible}
        />
      </section>
    </div>
  );
}
