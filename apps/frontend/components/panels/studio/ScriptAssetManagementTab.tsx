import { AssetsTab } from "./AssetsTab";
import { ChapterSwitchSelect } from "./ChapterSwitchSelect";
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
  // 资产页生成区章身份口径(10-19-asset-stage-chapter-select):显式改锚「选择器选中章」=
  // 激活章派生 assetChapterId,不再走 props.productionEpisodeId 的「最新草稿优先」回落——
  // 切章后行集合/一键生成落库/批与衍生 store 键/静默重匹配与页头选择器恒一致;空项目
  // novelChapters 为空时兜底现行 prop(行为等价现状)。全局 resolveProductionEpisodeId
  // 口径及其 7+ 消费方不动(独立口径役)。装载 fail-closed 由 store 既有机制兜底:装载
  // 失败不翻转 activeChapterId,此处派生自动保持原章。
  const activeChapterId = useStudioStore((state) => state.activeChapterId);
  const assetChapter =
    novelChapters.find((item) => item.id === activeChapterId) ?? novelChapters[0];
  const assetChapterId = assetChapter?.id ?? productionEpisodeId;

  return (
    <div className="flex min-h-0 flex-col gap-4 pb-5">
      <SectionShell
        title="资产提取"
        description="先从当前剧本提取角色、场景、道具，并同步检查资产库状态。"
      >
        <div className="bg-background/90 p-3">
          {/* 章节切换选择器(10-19 用户裁定:放「资产提取」标题说明布局的后面、
              章节卡列表之前;不再挂页面顶行):全仓唯一一份,覆盖提取+生成两区——
              同页只挂一份(AssetsTab 与生成区同 render 树,两处各挂=同屏 testid 撞车) */}
          <ChapterSwitchSelect chapters={novelChapters} label="章节" />
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
        {/* 口径注释见组件顶部:章身份=选择器选中章派生 assetChapterId(props 名不改,防扩与走廊役交叠面) */}
        <ScriptAssetGenerationTab
          title="资产生成"
          description="承接本阶段已提取的角色、场景、道具，手动推进提示词、图片资产、衍生资产和角色参考音频。"
          emptyExtractStageLabel="本阶段"
          productionEpisodeId={assetChapterId}
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
