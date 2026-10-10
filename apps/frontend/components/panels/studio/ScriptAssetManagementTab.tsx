import { AssetsTab } from "./AssetsTab";
import { ScriptAssetGenerationTab } from "./ScriptAssetGenerationTab";
import { useStudioStore } from "@/stores/studio/studio-store";
import { AssetDerivationPreview } from "./previews/asset-derivation-preview";

/** 页面级分区壳:三个区块共用同一头部样式,版式一致、高度自适应 */
function SectionShell({
  title,
  description,
  children,
}: {
  /** 缺省=无壳头(内容组件自带头部,如资产生成) */
  title?: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border/70">
      {title ? (
        <div className="border-b border-border/70 bg-panel/80 px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function ScriptAssetManagementTab({
  novelChapters,
  agentWorkData,
  entityExtractions,
  extractAssets,
  updateExtraction,
  productionEpisodeId,
  scriptPlanCount,
  hasSeriesBible,
  derivationNode,
  onOpenAssetImageWorkflow,
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
  productionEpisodeId: string;
  scriptPlanCount: number;
  hasSeriesBible: boolean;
  derivationNode?: import("./workflow-node-model").ProductionFlowNodeModel;
  onOpenAssetImageWorkflow?: (context: import("@/types/studio").ImageWorkflowOpenContext) => void;
}) {
  return (
    <div className="flex min-h-0 flex-col gap-4 pb-5">
      <SectionShell
        title="资产提取"
        description="先从当前剧本提取角色、场景、道具，并同步检查资产库状态。"
      >
        <div className="bg-background/90 p-3">
          <AssetsTab
            novelChapters={novelChapters}
            agentWorkData={agentWorkData}
            entityExtractions={entityExtractions}
            extractAssets={extractAssets}
            updateExtraction={updateExtraction}
          />
        </div>
      </SectionShell>

      <SectionShell>
        <ScriptAssetGenerationTab
          title="资产生成"
          description="承接本阶段已提取的角色、场景、道具，手动推进提示词、图片资产、衍生资产和角色参考音频。"
          emptyExtractStageLabel="本阶段"
          productionEpisodeId={productionEpisodeId}
          scriptPlanCount={scriptPlanCount}
          hasSeriesBible={hasSeriesBible}
        />
      </SectionShell>

      {derivationNode?.assetGroups?.length ? (
        <SectionShell
          title="衍生资产链"
          description="源资产 → AI 生成变体;点击衍生卡进入图像工作流精修(指针卡裁定后从画布移入此面板)。"
        >
          <div className="max-h-[800px] overflow-y-auto bg-background/90 p-4">
            <AssetDerivationPreview
              node={derivationNode}
              onOpenAssetImageWorkflow={onOpenAssetImageWorkflow}
              sourceStage="assets"
              sourceStageLabel="剧本资产管理"
            />
          </div>
        </SectionShell>
      ) : null}
    </div>
  );
}
