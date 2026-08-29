import { useState } from "react";
import { ChevronDown, ChevronRight, GitBranch } from "lucide-react";
import type {
  ImageWorkflowGraph,
  ImageWorkflowOpenContext,
  StoryboardItem,
  StudioMaterial,
} from "@/types/studio";
import {
  assetTargetLabel,
  isAssetOpenContext,
  splitImageMaterialsByOrigin,
} from "./image-workflow-graph-utils";
import {
  ImageWorkflowPaletteImageButton,
  ImageWorkflowPaletteSection,
} from "./image-workflow-palette";

interface ImageWorkflowSidebarProps {
  activeGraph: ImageWorkflowGraph;
  projectName: string;
  initialAssetContext?: ImageWorkflowOpenContext;
  isScopedWorkflowDetail: boolean;
  sourceLabel: string;
  sourceStageLabel?: string;
  workflowWritebackTargetLabel: string;
  storyboards: StoryboardItem[];
  canUseGlobalWorkflowControls: boolean;
  imageMaterials: StudioMaterial[];
  storyboardImages: StoryboardItem[];
  onAddReferenceFromMaterial: (material: StudioMaterial) => void;
  onAddReferenceFromStoryboard: (storyboard: StoryboardItem) => void;
}

export function ImageWorkflowSidebar({
  activeGraph,
  projectName,
  initialAssetContext,
  isScopedWorkflowDetail,
  sourceLabel,
  sourceStageLabel,
  workflowWritebackTargetLabel,
  canUseGlobalWorkflowControls,
  imageMaterials,
  storyboardImages,
  onAddReferenceFromMaterial,
  onAddReferenceFromStoryboard,
}: ImageWorkflowSidebarProps) {
  // T3 语义分组:材料库按成图回流(gen-/up4x- 前缀)拆「工作流成图」,
  // 其余归「资产设定图」;分组与分镜成图三段并列
  const { assetReferences, workflowOutputs } = splitImageMaterialsByOrigin(imageMaterials);
  return (
    <aside className="flex min-h-0 flex-col border-l border-border bg-card">
      <div className="border-b border-border p-3">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-info" />
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">{activeGraph.name}</h3>
            <p className="text-[11px] text-muted-foreground">{projectName}</p>
          </div>
        </div>
        {isScopedWorkflowDetail ? (
          // 分镜切换已并入工具条合并切换器(2026-08-30 合一裁定),侧栏只留上下文信息
          <div className="mt-3 grid gap-2" data-scoped-image-workflow-summary>
            <div className="rounded-md border border-info/20 bg-info/10 px-3 py-2 text-xs text-info">
              <div className="text-[10px] uppercase tracking-[0.18em] text-info/70">来源</div>
              <div className="mt-1 truncate">
                {sourceStageLabel ? `${sourceStageLabel} / ${sourceLabel}` : sourceLabel}
              </div>
            </div>
            <div className="rounded-md border border-info/20 bg-info/10 px-3 py-2 text-xs text-info">
              <div className="text-[10px] uppercase tracking-[0.18em] text-info/70">回写目标</div>
              <div className="mt-1 truncate">{workflowWritebackTargetLabel}</div>
            </div>
          </div>
        ) : activeGraph.target.kind === "asset" ? (
          <div className="mt-3 rounded-md border border-info/20 bg-info/10 px-3 py-2 text-xs text-info">
            <div className="text-[10px] uppercase tracking-[0.18em] text-info/70">回写目标</div>
            <div className="mt-1 truncate">
              {assetTargetLabel(
                activeGraph.target,
                isAssetOpenContext(initialAssetContext) ? initialAssetContext : undefined,
              )}
            </div>
          </div>
        ) : null}
      </div>
      {canUseGlobalWorkflowControls ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3" data-image-workflow-reference-palette>
          {assetReferences.length === 0 && workflowOutputs.length === 0 ? (
            <div className="mb-4 rounded-md border border-border bg-muted/30 px-3 py-4 text-center text-xs text-muted-foreground">
              当前项目暂无参考图
            </div>
          ) : null}
          <ReferencePaletteGroup title={`资产设定图 · ${assetReferences.length}`} defaultOpen>
            {assetReferences.map((material) => (
              <ImageWorkflowPaletteImageButton
                key={material.id}
                title={material.name}
                imageUrl={material.localPath}
                onClick={() => onAddReferenceFromMaterial(material)}
              />
            ))}
          </ReferencePaletteGroup>
          <ReferencePaletteGroup title={`工作流成图 · ${workflowOutputs.length}`} defaultOpen>
            {workflowOutputs.map((material) => (
              <ImageWorkflowPaletteImageButton
                key={material.id}
                title={material.name}
                imageUrl={material.localPath}
                onClick={() => onAddReferenceFromMaterial(material)}
              />
            ))}
          </ReferencePaletteGroup>
          <ImageWorkflowPaletteSection
            title={`分镜成图 · ${storyboardImages.length}`}
            emptyText="分镜尚未绑定图片"
          >
            {storyboardImages.map((storyboard) => (
              <ImageWorkflowPaletteImageButton
                key={storyboard.id}
                title={`分镜 ${storyboard.index}`}
                imageUrl={storyboard.mediaRef!.path}
                onClick={() => onAddReferenceFromStoryboard(storyboard)}
              />
            ))}
          </ImageWorkflowPaletteSection>
        </div>
      ) : null}
    </aside>
  );
}

/** 参考面板可折叠分组(T3):组多图杂,标题点击收起/展开即组级筛选;空组不渲染。 */
function ReferencePaletteGroup({
  title,
  defaultOpen,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const items = Array.isArray(children) ? children : [children];
  if (items.length === 0) return null;
  return (
    <section className="mb-4">
      <button
        type="button"
        data-image-workflow-palette-group
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="mb-2 flex w-full items-center gap-1 rounded-md px-1 py-0.5 text-xs font-semibold text-card-foreground"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {title}
      </button>
      {open ? <div className="grid grid-cols-2 gap-2">{children}</div> : null}
    </section>
  );
}
